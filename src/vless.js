import { Duplex } from 'node:stream';
import tls from 'node:tls';
import { once } from 'node:events';

export function parseVlessUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('VLESS_URL is required');

  const url = new URL(value);
  if (url.protocol !== 'vless:') throw new Error('VLESS_URL must start with vless://');
  if ((url.searchParams.get('type') || '').toLowerCase() !== 'ws') throw new Error('only VLESS over WebSocket is supported');
  if ((url.searchParams.get('security') || 'none').toLowerCase() !== 'none') throw new Error('only security=none is supported');
  if ((url.searchParams.get('encryption') || 'none').toLowerCase() !== 'none') throw new Error('only encryption=none is supported');

  return {
    uuid: url.username,
    host: url.hostname,
    port: Number(url.port || 80),
    path: url.searchParams.get('path') || '/',
    label: `${url.hostname}:${url.port || 80}`,
    wsUrl: `ws://${url.hostname}:${url.port || 80}${url.searchParams.get('path') || '/'}`
  };
}

export async function requestViaVless(vlessConfig, request) {
  const startedAt = Date.now();
  const target = new URL(request.url);
  if (target.protocol !== 'https:') throw new Error('only HTTPS upstream URLs are supported');

  const tunnel = await openVlessTunnel(vlessConfig, target.hostname, Number(target.port || 443), request.timeoutMs || 15000);
  const socket = tls.connect({ socket: tunnel, servername: target.hostname });
  const timeout = setTimeout(() => socket.destroy(new Error('upstream timeout')), request.timeoutMs || 15000);

  try {
    await once(socket, 'secureConnect');
    socket.write(buildHttpRequest(target, request));
    const responseBytes = await readSocket(socket);
    return {
      ...parseHttpResponse(responseBytes),
      proxy: vlessConfig.label,
      attempts: 1,
      elapsedMs: Date.now() - startedAt,
      bytesUp: tunnel.bytesUp,
      bytesDown: tunnel.bytesDown
    };
  } finally {
    clearTimeout(timeout);
    socket.destroy();
  }
}

async function openVlessTunnel(vlessConfig, targetHost, targetPort, timeoutMs) {
  const ws = new WebSocket(vlessConfig.wsUrl);
  ws.binaryType = 'arraybuffer';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('VLESS WebSocket open timeout')), timeoutMs);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return new VlessWebSocketDuplex(ws, vlessConfig.uuid, targetHost, targetPort);
}

class VlessWebSocketDuplex extends Duplex {
  constructor(ws, uuid, targetHost, targetPort) {
    super();
    this.ws = ws;
    this.header = buildVlessHeader(uuid, targetHost, targetPort);
    this.sentHeader = false;
    this.firstInbound = true;
    this.bytesUp = 0;
    this.bytesDown = 0;

    ws.addEventListener('message', async event => {
      let chunk = await webSocketDataToBuffer(event.data);
      this.bytesDown += chunk.byteLength;
      if (this.firstInbound) {
        this.firstInbound = false;
        chunk = chunk.subarray(2 + (chunk[1] || 0));
      }
      if (chunk.byteLength > 0) this.push(chunk);
    });
    ws.addEventListener('close', () => this.push(null));
    ws.addEventListener('error', error => this.destroy(error));
  }

  _read() {}

  _write(chunk, _encoding, callback) {
    const payload = this.sentHeader ? Buffer.from(chunk) : Buffer.concat([this.header, Buffer.from(chunk)]);
    this.sentHeader = true;
    this.bytesUp += payload.byteLength;
    this.ws.send(payload);
    callback();
  }

  _destroy(error, callback) {
    try {
      this.ws.close();
    } catch {
      // Closing an already closed WebSocket is harmless.
    }
    callback(error);
  }
}

function buildVlessHeader(uuid, targetHost, targetPort) {
  const hostBytes = Buffer.from(targetHost);
  return Buffer.concat([
    Buffer.from([0]),
    uuidToBytes(uuid),
    Buffer.from([0, 1, (targetPort >> 8) & 255, targetPort & 255, 2, hostBytes.length]),
    hostBytes
  ]);
}

function uuidToBytes(uuid) {
  const normalized = String(uuid || '').replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(normalized)) throw new Error('invalid VLESS UUID');
  return Buffer.from(normalized, 'hex');
}

async function webSocketDataToBuffer(data) {
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return Buffer.from(data);
  return Buffer.from(await data.arrayBuffer());
}

function buildHttpRequest(target, request) {
  const method = String(request.method || 'GET').toUpperCase();
  const body = Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body || '');
  const headers = new Map(Object.entries(request.headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
  headers.set('host', target.host);
  headers.set('connection', 'close');
  if (body.byteLength > 0 && !headers.has('content-length')) headers.set('content-length', String(body.byteLength));

  const startLine = `${method} ${target.pathname}${target.search} HTTP/1.1`;
  const headerLines = [...headers.entries()].map(([key, value]) => `${key}: ${value}`);
  return Buffer.concat([Buffer.from(`${startLine}\r\n${headerLines.join('\r\n')}\r\n\r\n`), body]);
}

async function readSocket(socket) {
  const chunks = [];
  socket.on('data', chunk => chunks.push(Buffer.from(chunk)));
  await once(socket, 'end');
  return Buffer.concat(chunks);
}

export function parseHttpResponse(bytes) {
  const separator = bytes.indexOf(Buffer.from('\r\n\r\n'));
  if (separator < 0) throw new Error('upstream response did not include headers');

  const headerText = bytes.subarray(0, separator).toString('latin1');
  const rawBody = bytes.subarray(separator + 4);
  const lines = headerText.split('\r\n');
  const status = Number.parseInt(lines[0]?.split(/\s+/)[1] || '502', 10);
  const headers = {};
  for (const line of lines.slice(1)) {
    const index = line.indexOf(':');
    if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }

  return {
    status: Number.isFinite(status) ? status : 502,
    headers,
    body: decodeTransferBody(rawBody, headers)
  };
}

function decodeTransferBody(body, headers) {
  if ((headers['transfer-encoding'] || '').toLowerCase() !== 'chunked') return body;

  const chunks = [];
  let offset = 0;
  while (offset < body.byteLength) {
    const lineEnd = body.indexOf(Buffer.from('\r\n'), offset);
    if (lineEnd < 0) break;
    const sizeText = body.subarray(offset, lineEnd).toString('ascii').split(';')[0];
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size) || size < 0) break;
    offset = lineEnd + 2;
    if (size === 0) break;
    chunks.push(body.subarray(offset, offset + size));
    offset += size + 2;
  }
  return Buffer.concat(chunks);
}
