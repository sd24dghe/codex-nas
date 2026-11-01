# Security

## Recommended Deployment

- Keep port `8787` on a private LAN or VPN.
- If public access is required, terminate TLS with Caddy, Nginx, Cloudflare Tunnel, or Tailscale.
- Use a long, unique `CODEX_WEB_PASSWORD`.
- Restrict SSH access to keys and keep the NAS operating system updated.
- Back up `data/codex`, then protect the backup because `auth.json` contains an API key.

## Secrets

The project intentionally separates secrets from source code:

- Web password: host `.env`, excluded from Git
- Provider API key: `data/codex/auth.json`, permission `0600`
- Codex login state: `data/codex/auth.json`

The Docker image does not contain `.env` or `data/`.

## Reporting

Do not include API keys, session tokens, conversation contents, or NAS addresses in a public issue. Revoke any exposed key immediately and replace `data/codex/auth.json`.
