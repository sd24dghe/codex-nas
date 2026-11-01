# Codex NAS Console

**语言：[English](README.en.md) | 简体中文**

在家庭 NAS 上运行 OpenAI Codex CLI，并通过浏览器、手机、平板或 SSH 终端使用。

项目包含轻量 Node.js Web 控制台、Codex CLI、tmux、可选 Shell 菜单，以及用于切换 OpenAI 兼容 API 的本地设置层。无需前端构建、额外数据库或前端框架。

## 功能

- 带密码认证的 Web 控制台
- 使用 Server-Sent Events 实时显示 Codex 状态、工具调用和回答
- 渲染 Markdown 和 LaTeX 公式
- 新建任务、最近对话、历史、收藏、置顶、归档和删除
- 在网页或 Shell 中修改 Base URL、模型、API Key 和请求协议
- 通过 OpenAI 兼容 `/models` 接口自动读取模型列表
- 持久化 Codex 登录状态和对话历史
- 手机友好的 `codex-nas` tmux SSH 菜单
- Docker 自动重启与健康检查
- API Key 保存在绑定挂载文件中，不打进镜像或 Compose 环境变量

## 架构

```text
浏览器 / 手机 / iPad
          |
       SSE + HTTP
          |
   Node.js Web 服务 :8787
          |
       Codex CLI
          |
   工作目录 + ~/.codex
```

Web 服务与 Shell 菜单共用同一套 Codex 配置：

```text
data/codex/config.toml
data/codex/auth.json
data/codex/AGENTS.md
data/codex/favorites.tsv
```

## 环境要求

- Docker Engine 24+ 与 Docker Compose v2
- NAS、Linux 主机或 macOS 主机
- 可访问 OpenAI 兼容 API
- 约 2 GB 可用磁盘空间，用于基础镜像和浏览器依赖

## 快速开始

### 1. 设置网页密码

```bash
cp .env.example .env
```

编辑 `.env`，把 `CODEX_WEB_PASSWORD` 替换成足够长的随机密码：

```bash
openssl rand -base64 32
```

不要提交 `.env`，它已经包含在 `.gitignore` 中。

### 2. 启动容器

```bash
docker compose up -d --build
docker compose ps
```

浏览器打开：

```text
http://NAS局域网IP:8787
```

### 3. 配置 API

使用 `CODEX_WEB_PASSWORD` 登录，然后点击右上角 **API**：

- **API Base URL**：服务商地址，例如 `https://api.deepseek.com`
- **模型**：模型 ID，例如 `deepseek-flash`
- **API Key**：服务商密钥
- **请求协议**：`Responses API` 或 `Chat Completions`

可以使用 **读取模型列表** 查询服务商的 `/models`，或使用 **保存并测试** 验证配置。

API Key 留空时会保留上一次保存的 Key。

## API Key 存储

API Key 只保存在宿主机：

```text
data/codex/auth.json
```

服务端会将该文件权限设置为 `0600`。Key 不会写入 Docker 镜像、Compose 环境变量，也不会通过 API 响应返回。

网页登录密码从 `.env` 读取，并以 `CODEX_WEB_PASSWORD` 传入容器。

发布项目或 Fork 前建议检查：

```bash
git status --ignored
git grep -nE 'sk-|api[_-]?key|password|token'
```

不要提交 `.env` 或 `data/`。

## Shell 菜单

安装宿主机脚本：

```bash
sudo scripts/install-shell.sh
codex-nas
```

脚本会自动识别容器中 `/root/.codex` 对应的宿主机挂载目录。需要手动指定时：

```bash
export CODEX_NAS_DATA_DIR=/path/to/data
```

菜单功能：

1. 新建 Codex 任务
2. 恢复最近一次对话
3. 浏览历史对话
4. 收藏、置顶、归档和删除
5. 连接正在运行的任务
6. 进入容器 Shell
7. 结束运行中的任务
8. 切换回答语言
9. 修改 API 与模型

每个任务在独立 tmux 会话中运行。按 `Ctrl+B` 再按 `D` 脱离，重新执行同名任务即可恢复。

## 手机与平板

使用 Termius、Blink Shell 等 SSH 客户端：

```bash
ssh 你的用户名@NAS地址
codex-nas
```

浏览器端可以把 `http://NAS局域网IP:8787` 添加到主屏幕。移动浏览器断开不会停止 tmux 中的任务。

## 持久化目录

默认情况下，Compose 数据位于 `./data`：

```text
data/app        Codex 工作区
data/codex      Codex 配置、认证、历史、收藏
data/claude     可选 Claude 配置
data/config     通用配置
```

可以在 `.env` 中修改 `CODEX_DATA_DIR`，指定其他 NAS 存储卷。

## 主题定制

- 构建前将本地图片保存为 `app/avatar.jpg`，可替换默认的 `NAS` 头像。
- `app/avatar.jpg` 被 Git 忽略，避免误发布私人或受版权保护素材。
- 如需壁纸，请修改 `app/index.html` 中的 `--wallpaper-image`。默认不会加载第三方壁纸。

## 反向代理

Caddy 示例：

```caddyfile
codex.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Node 服务支持 SSE，并针对事件流禁用代理缓冲。公网访问建议使用 HTTPS，并叠加 Cloudflare Access、Tailscale 或 VPN 等额外访问层。

## 发布到 GitHub

```bash
git init
git add .
git commit -m "Initial Codex NAS console"
gh repo create codex-nas --public --source=. --remote=origin --push
```

推送前检查仓库内容。不要发布真实的 `.env`、`data/`、API Key、私人域名、壁纸或头像素材。

## 更新

```bash
git pull
docker compose up -d --build
```

Codex 对话和 API 设置会保留在 `data/codex`。

## 说明

- Web 服务以子进程方式运行 Codex，并解析 JSONL 事件流。
- 容器中的 Codex 使用 `danger-full-access`。Docker 是隔离边界，Codex 可以修改挂载到 `/app` 的工作区文件。
- 应用不会暴露隐藏的思维链，只展示 Codex 提供的状态、工具调用、输出和最终消息。
- 默认仅支持一个可信管理员账号；如需多用户，请增加独立认证层。
- 公开分发前请自行选择合适的开源许可证。
