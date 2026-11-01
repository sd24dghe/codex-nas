FROM mcr.microsoft.com/playwright:v1.45.0-jammy

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    CODEX_WEB_HOST=0.0.0.0 \
    CODEX_WEB_PORT=8787 \
    CODEX_WEB_WORKSPACE=/app \
    CODEX_HOME=/root/.codex

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fonts-wqy-microhei \
    fonts-wqy-zenhei \
    git \
    python3 \
    tmux \
    xfonts-wqy \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN npm install -g @openai/codex playwright
RUN npx playwright install chromium

COPY app/ /opt/codex-web/
RUN chmod +x /opt/codex-web/provider-config.py

EXPOSE 8787

VOLUME ["/app", "/root/.codex", "/root/.config", "/root/.claude"]

CMD ["sh", "-c", "node /opt/codex-web/server.js & exec tail -f /dev/null"]
