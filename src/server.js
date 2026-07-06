import http from 'node:http';
import { parseProxyPool, requestViaVless } from './vless.js';
import { createProxyPool } from './proxy-pool.js';
import { fetchSubscriptionNodes, parseSubscriptionUrls } from './subscriptions.js';

const port = Number(process.env.PORT || 8788);
const auth = String(process.env.GATEWAY_AUTH || '').trim();
const subscriptionUrls = parseSubscriptionUrls(process.env.SUBSCRIPTION_URLS || '');
const refreshIntervalMs = Math.max(60_000, Number(process.env.SUBSCRIPTION_REFRESH_SECONDS || 600) * 1000);
const healthIntervalMs = Math.max(30_000, Number(process.env.PROXY_HEALTH_SECONDS || 300) * 1000);
const healthTargetUrl = process.env.PROXY_HEALTH_URL || 'https://api.ipify.org?format=json';
const initialProxyText = process.env.PROXY_URLS || process.env.VLESS_URLS || process.env.VLESS_URL || '';
const initialPool = parseProxyPool(initialProxyText || 'vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1?encryption=none&security=none&type=tcp');
const proxyPool = createProxyPool(initialPool);

if (!initialProxyText && subscriptionUrls.length) {
  proxyPool.replaceSupported({ supported: [], unsupported: [] });
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === '/health') {
      return json(response, 200, proxyPool.snapshot());
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
    const attempted = [];
    for (let attempt = 1; attempt <= retries; attempt++) {
      const proxy = proxyPool.pickProxy();
      attempted.push(proxy.label);
      try {
        const upstream = await requestViaVless(proxy, { url: targetUrl, method, headers, body, timeoutMs });
        response.writeHead(upstream.status, {
          'Content-Type': upstream.headers['content-type'] || 'application/octet-stream',
          'X-Proxy-Used': upstream.proxy,
          'X-Attempts': String(attempt),
          'X-Proxy-Attempted': attempted.join(','),
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
      'X-Proxy-Used': attempted.at(-1) || '',
      'X-Proxy-Attempted': attempted.join(','),
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

void refreshFromSubscriptions();
void refreshProxyHealth();
if (subscriptionUrls.length) setInterval(() => void refreshFromSubscriptions(), refreshIntervalMs).unref();
setInterval(() => void refreshProxyHealth(), healthIntervalMs).unref();

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

async function refreshFromSubscriptions() {
  if (!subscriptionUrls.length) return;
  try {
    const result = await fetchSubscriptionNodes(subscriptionUrls);
    const rawPool = [...result.nodes, initialProxyText].filter(Boolean).join('\n');
    const parsed = parseProxyPool(rawPool);
    proxyPool.replaceSupported(parsed, result.failures);
    console.log(`subscription refresh loaded ${parsed.supported.length} supported proxies and ${parsed.unsupported.length} unsupported proxies`);
    await refreshProxyHealth();
  } catch (error) {
    console.error('subscription refresh failed', error instanceof Error ? error.message : error);
  }
}

async function refreshProxyHealth() {
  const supported = proxyPool.supported();
  if (!supported.length) {
    proxyPool.replaceActive([], []);
    return;
  }
  const results = await Promise.all(supported.map(proxy => checkProxy(proxy)));
  proxyPool.replaceActive(
    results.filter(result => result.ok).map(result => result.proxy),
    results.filter(result => !result.ok).map(result => ({
      label: result.proxy.label,
      reason: result.reason,
      elapsedMs: result.elapsedMs
    }))
  );
}

async function checkProxy(proxy) {
  const startedAt = Date.now();
  try {
    const result = await requestViaVless(proxy, {
      url: healthTargetUrl,
      method: 'GET',
      headers: {},
      body: '',
      timeoutMs: Math.max(1000, Number(process.env.PROXY_HEALTH_TIMEOUT_SECONDS || 10) * 1000)
    });
    if (result.status >= 200 && result.status < 300) return { ok: true, proxy, elapsedMs: Date.now() - startedAt };
    return { ok: false, proxy, elapsedMs: Date.now() - startedAt, reason: `HTTP ${result.status}` };
  } catch (error) {
    return {
      ok: false,
      proxy,
      elapsedMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}
