# FPCY VLESS Proxy Gateway

Small HTTP gateway for the Worker `PROXY_GATEWAY_BASE_URL` integration. It exposes `/health` and `/fetch`, then forwards HTTPS upstream requests through a VLESS node pool.

Required environment variables:

- `SUBSCRIPTION_URLS`: one or more subscription URLs separated by newlines. The gateway fetches these, extracts proxy nodes, and periodically refreshes the active pool.
- `PROXY_URLS`: one or more proxy URLs separated by newlines. Supported nodes are `vless://` with `security=none` and `type=tcp` or `type=ws`.
- `VLESS_URL` / `VLESS_URLS`: fallback names for compatibility.
- `GATEWAY_AUTH`: optional `user:password` value used by Worker `PROXY_GATEWAY_AUTH`.
- `PORT`: optional, defaults to `8788`.
- `SUBSCRIPTION_REFRESH_SECONDS`: optional, defaults to `600`.
- `PROXY_HEALTH_SECONDS`: optional, defaults to `300`.
- `PROXY_HEALTH_URL`: optional, defaults to `https://api.ipify.org?format=json`.

`security=reality` and `vmess://` nodes are detected and reported by `/health`, but skipped by this native Node gateway.

Run locally:

```powershell
cd proxy-gateway
$env:SUBSCRIPTION_URLS = @"
https://example.com/subscription
"@
$env:PROXY_URLS = @"
vless://...
vless://...
"@
$env:GATEWAY_AUTH = "user:password"
npm start
```

Worker settings after deployment:

```powershell
cd worker
npx wrangler secret put PROXY_GATEWAY_BASE_URL
npx wrangler secret put PROXY_GATEWAY_AUTH
npx wrangler secret put PROXY_FORCE
```

Set `PROXY_FORCE` to `true` if both invoice check and image generation must always use the VLESS gateway.
