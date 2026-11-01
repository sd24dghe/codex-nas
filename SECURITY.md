# Security Policy

## Sensitive Reports

Please use GitHub Private Vulnerability Reporting for security issues:

https://github.com/sd24dghe/codex-nas/security/advisories/new

If that page is unavailable, send a private message through Bilibili:

https://space.bilibili.com/1502095394

Do not publish API keys, login tokens, private NAS addresses, or conversation
contents in a public issue.

## What To Include

- A short description of the issue
- The affected version or commit
- Reproduction steps
- Expected and actual behavior
- Relevant logs with secrets removed
- Whether the issue requires public network access

## Maintenance Expectations

This is a volunteer project maintained by a high-school student. There is no
guaranteed response time or security SLA. Reports will be reviewed on a best-
effort basis, and responsible disclosure is appreciated.

## Compromised Credentials

If an API key or password may have been exposed:

1. Revoke or rotate the credential at the provider.
2. Replace `data/codex/auth.json` or `.env` on the NAS.
3. Review recent Codex and NAS activity.
