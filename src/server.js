import http from 'node:http';
import { parseVlessUrl, requestViaVless } from './vless.js';

const port = Number(process.env.PORT || 8788);
const auth = String(process.env.GATEWAY_AUTH || '').trim();
const vlessConfig = parseVlessUrl(process.env.VLESS_URL);

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === '/health') {
      return json(response, 200, { ok: true, pool_count: 1, proxy: vlessConfig.label });
    }

    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname !== '/fetch') return json(response, 404, { ok: false, error: 'not_found' });
    if (!isAuthorized(request)) return unauthorized(response);

    const targetUrl = url.searchParams.get('url') || '';
    const method = String(url.searchParams.get('method') || 'GET').toUpperCase();
    const timeoutMs = Math.max(1000, Number(url.searchParams.get('timeout') || 15) * 1000);
    const headers = parseHeaders(url.searchParams.get('headers'));
    const body = url.searchParams.get('body') || '';
    const retries = Math.max(1, Number.parseInt(url.searchParams.get('retries') || '1', 10));

    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const upstream = await requestViaVless(vlessConfig, { url: targetUrl, method, headers, body, timeoutMs });
        response.writeHead(upstream.status, {
          'Content-Type': upstream.headers['content-type'] || 'application/octet-stream',
          'X-Proxy-Used': upstream.proxy,
          'X-Attempts': String(attempt),
          'X-Elapsed-Ms': String(upstream.elapsedMs),
          'X-Final-URL': targetUrl,
          'X-Proxy-Bytes-Up': String(upstream.bytesUp),
          'X-Proxy-Bytes-Down': String(upstream.bytesDown)
        });
        response.end(upstream.body);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    response.writeHead(502, {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Gateway-Error': '1',
      'X-Proxy-Used': vlessConfig.label,
      'X-Attempts': String(retries)
    });
    response.end(lastError instanceof Error ? lastError.message : 'proxy gateway failed');
  } catch (error) {
    json(response, 500, { ok: false, error: 'gateway_error', message: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, () => {
  console.log(`fpcy VLESS proxy gateway listening on ${port}`);
});

function isAuthorized(request) {
  if (!auth) return true;
  const expected = `Basic ${Buffer.from(auth).toString('base64')}`;
  return request.headers.authorization === expected;
}

function unauthorized(response) {
  response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fpcy-proxy-gateway"' });
  response.end('unauthorized');
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function parseHeaders(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
