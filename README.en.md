# Codex NAS Console

**Language:** [简体中文](README.md) | English

Run OpenAI Codex CLI on a home NAS and use it from a browser, phone, tablet, or SSH terminal.

This project bundles a lightweight Node.js web console, Codex CLI, tmux, an optional shell menu, and a small local settings layer for switching OpenAI-compatible API providers. It ships without a build step, database server, or frontend framework.

## Features

- Web console with password authentication
- Server-Sent Events for live Codex status, tool calls, and responses
- Markdown and LaTeX rendering
- New tasks, recent conversations, history, favorites, pinning, archive, and delete
- Runtime API settings for base URL, model, API key, and wire protocol
- Model discovery through an OpenAI-compatible `/models` endpoint
- Persistent Codex authentication and conversation history
- Mobile-friendly `codex-nas` tmux menu for SSH clients
- Docker restart policy and health check
- API keys stay in a bind-mounted file, not in the image or Compose environment

## Architecture

```text
Browser / phone / iPad
          |
       SSE + HTTP
          |
   Node.js web server :8787
          |
       Codex CLI
          |
   workspace + ~/.codex
```

The web server and shell menu share the same Codex configuration:

```text
data/codex/config.toml
data/codex/auth.json
data/codex/AGENTS.md
data/codex/favorites.tsv
```

## Requirements

- Docker Engine 24+ with Docker Compose v2
- A NAS, Linux server, or macOS host
- Access to an OpenAI-compatible API
- Approximately 2 GB of free disk space for the base image and browser dependencies

## Quick Start

### 1. Configure the web password

```bash
cp .env.example .env
```

Edit `.env` and replace `CODEX_WEB_PASSWORD` with a long random password.

```bash
openssl rand -base64 32
```

Do not commit `.env`. It is already included in `.gitignore`.

### 2. Start the container

```bash
docker compose up -d --build
docker compose ps
```

Open:

```text
http://NAS-LAN-IP:8787
```

### 3. Configure the API

Sign in with `CODEX_WEB_PASSWORD`, then click **API** in the top-right corner.

- **API Base URL**: provider endpoint, for example `https://api.deepseek.com`
- **Model**: model identifier, for example `deepseek-flash`
- **API Key**: the provider key
- **Protocol**: `Responses API` or `Chat Completions`

Use **读取模型列表** to query the provider's `/models` endpoint, or **保存并测试** to validate the saved settings.

A blank API Key preserves the previously saved key.

## API Key Storage

The API key is stored only on the host:

```text
data/codex/auth.json
```

The server applies mode `0600`. It is not copied into the Docker image, passed in Compose environment variables, or returned by an API response.

The web login password is read from `.env` and passed to the container as `CODEX_WEB_PASSWORD`.

Before publishing a fork:

```bash
git status --ignored
git grep -nE 'sk-|api[_-]?key|password|token'
```

Never commit `.env` or `data/`.

## Shell Menu

Install the host-side helper:

```bash
sudo scripts/install-shell.sh
codex-nas
```

The script automatically detects the host directory mounted at `/root/.codex` in the running container. To override it:

```bash
export CODEX_NAS_DATA_DIR=/path/to/data
```

The menu provides:

1. New Codex task
2. Resume the latest conversation
3. Browse history
4. Favorites, pin, archive, and delete
5. Attach to a running task
6. Container shell
7. Stop running tasks
8. Response language
9. API and model settings

Each named task runs in a tmux session. Detach with `Ctrl+B`, then `D`. Reconnect with the same task name.

## Mobile And Tablet

Use any SSH client, such as Termius or Blink Shell:

```bash
ssh your-user@your-nas
codex-nas
```

For browser use, add `http://NAS-LAN-IP:8787` to the home screen. Connections dropped from a mobile browser do not stop tasks executed inside tmux.

## Persistent Data

By default, Compose stores data under `./data`:

```text
data/app        Codex workspace
data/codex      Codex config, auth, history, favorites
data/claude     Optional Claude config
data/config     General config
```

Change `CODEX_DATA_DIR` in `.env` to use another NAS volume.

## Theme Customization

- Put a local image at `app/avatar.jpg` before building to replace the default `NAS` avatar.
- `app/avatar.jpg` is ignored by Git so private or copyrighted artwork is not published accidentally.
- To use a wallpaper, edit the `--wallpaper-image` value in `app/index.html`. No third-party wallpaper URL is loaded by default.

## Reverse Proxy

Caddy example:

```caddyfile
codex.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

The Node server supports SSE and disables proxy buffering headers for event streams. For public access, put the service behind HTTPS and an additional access layer such as Cloudflare Access, Tailscale, or a VPN.

## GitHub Publishing

```bash
git init
git add .
git commit -m "Initial Codex NAS console"
gh repo create codex-nas --public --source=. --remote=origin --push
```

Review the repository contents before pushing. Do not publish your real `.env`, `data/`, API keys, personal domains, or private wallpaper and avatar assets.

## Updating

```bash
git pull
docker compose up -d --build
```

Codex conversations and provider settings remain in `data/codex`.

## Notes

- The web server runs Codex as a child process and streams JSONL events.
- The container runs Codex with `danger-full-access`. Docker is the isolation boundary; Codex can modify files under the mounted `/app` workspace.
- The application does not expose hidden chain-of-thought. It shows available Codex statuses, tool calls, outputs, and final messages.
- Use only one trusted administrator account unless you add a multi-user authentication layer.
- Add a license before distributing the project if you intend to define reuse terms.
