# Contributing

Thanks for helping improve Codex NAS Console. Bug reports, compatibility
findings, documentation fixes, and implementation ideas are all welcome.

## Before Opening An Issue

- Search existing issues first.
- For a new feature or a large refactor, open an issue before writing a large
  pull request so the approach can be discussed.
- Do not include API keys, passwords, tokens, private NAS addresses, or private
  conversation data.
- Security issues must follow [SECURITY.md](SECURITY.md), not a public issue.

## Bug Reports

Please include:

- NAS model and operating system
- Docker and Compose versions
- Browser and device
- Expected and actual behavior
- Minimal reproduction steps
- Sanitized logs

## Pull Requests

- Keep changes focused.
- Explain the user-facing behavior and any tradeoffs.
- Update the Chinese and English README when behavior changes.
- Preserve the no-build architecture unless the change clearly justifies a
  different approach.
- Never commit `.env`, `data/`, API keys, personal domains, or private images.

Run the lightweight checks before opening a PR:

```bash
node --check app/server.js
python3 -m py_compile app/provider-config.py app/list_threads.py
bash -n scripts/codex-nas
sh -n scripts/install-shell.sh
```

## License

By contributing, you agree that your contribution may be distributed under the
MIT License in [LICENSE](LICENSE).

## Maintenance

The maintainer is a high-school student. Reviews and replies happen on a best-
effort basis. Clear, reproducible reports are especially appreciated.
