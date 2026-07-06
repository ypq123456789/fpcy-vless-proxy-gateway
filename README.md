# FPCY VLESS Proxy Gateway

Small HTTP gateway for the Worker `PROXY_GATEWAY_BASE_URL` integration. It exposes `/health` and `/fetch`, then forwards HTTPS upstream requests through one VLESS over WebSocket node.

Required environment variables:

- `VLESS_URL`: the full `vless://...` node URL.
- `GATEWAY_AUTH`: optional `user:password` value used by Worker `PROXY_GATEWAY_AUTH`.
- `PORT`: optional, defaults to `8788`.

Run locally:

```powershell
cd proxy-gateway
$env:VLESS_URL = "vless://..."
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
