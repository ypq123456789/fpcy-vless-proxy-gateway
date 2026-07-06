export function parseSubscriptionUrls(raw) {
  return String(raw || '')
    .split(/\r?\n|\s+/)
    .map(value => value.trim())
    .filter(value => /^https?:\/\//i.test(value));
}

export function extractProxyUrls(body) {
  const text = decodeMaybeBase64(String(body || ''));
  const urls = [];
  const pattern = /\b(?:vless|vmess):\/\/[^\s"'<>]+/gi;
  for (const match of text.matchAll(pattern)) {
    urls.push(match[0].replace(/[,)\]}]+$/, ''));
  }
  return [...new Set(urls)];
}

export async function fetchSubscriptionNodes(subscriptionUrls, fetcher = fetch) {
  const nodes = [];
  const failures = [];
  for (const url of subscriptionUrls) {
    try {
      const response = await fetcher(url, {
        headers: { 'User-Agent': 'fpcy-proxy-gateway/1.0' }
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`subscription HTTP ${response.status}`);
      const extracted = extractProxyUrls(body);
      nodes.push(...extracted);
      if (!extracted.length) failures.push({ url: safeSubscriptionUrl(url), reason: 'no proxy nodes found' });
    } catch (error) {
      failures.push({
        url: safeSubscriptionUrl(url),
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { nodes: [...new Set(nodes)], failures };
}

function decodeMaybeBase64(value) {
  const trimmed = value.trim();
  if (!trimmed || /(?:vless|vmess):\/\//i.test(trimmed)) return trimmed;
  const compact = trimmed.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(compact) || compact.length % 4 === 1) return trimmed;
  try {
    const normalized = compact.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    return /(?:vless|vmess):\/\//i.test(decoded) ? decoded : trimmed;
  } catch {
    return trimmed;
  }
}

function safeSubscriptionUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.search) url.search = '?redacted=1';
    return url.toString();
  } catch {
    return 'invalid-subscription-url';
  }
}
