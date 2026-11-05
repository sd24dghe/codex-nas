#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn, execFileSync } = require('node:child_process');
const { PassThrough } = require('node:stream');

const HOST = process.env.CODEX_WEB_HOST || '0.0.0.0';
const PORT = Number(process.env.CODEX_WEB_PORT || 8787);
const PASSWORD = process.env.CODEX_WEB_PASSWORD || '';
const RUN_MODE = process.env.CODEX_WEB_RUNNER || 'local';
const CONTAINER = process.env.CODEX_WEB_CONTAINER || 'nas-codex-agent';
const WORKSPACE = path.resolve(process.env.CODEX_WEB_WORKSPACE || '/app');
const CODEX_HOME = path.resolve(process.env.CODEX_HOME || '/root/.codex');
const FAVORITES_FILE = path.join(CODEX_HOME, 'favorites.tsv');
const AGENTS_FILE = path.join(CODEX_HOME, 'AGENTS.md');
const CONFIG_FILE = path.join(CODEX_HOME, 'config.toml');
const AUTH_FILE = path.join(CODEX_HOME, 'auth.json');
const INDEX_FILE = path.join(__dirname, 'index.html');
const MAX_BODY = 64 * 1024;
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;

const tasks = new Map();
const tokens = new Map();
const loginAttempts = new Map();

if (!PASSWORD) {
  console.error('CODEX_WEB_PASSWORD is required. Set it in .env before starting the service.');
  process.exit(1);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function tokenFromRequest(req, url) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;
  return parseCookies(req.headers.cookie || '').nas_codex_session || '';
}

function isAuthenticated(req, url) {
  const token = tokenFromRequest(req, url);
  const expiresAt = tokens.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    if (token) tokens.delete(token);
    return false;
  }
  return true;
}

function issueToken() {
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, Date.now() + TOKEN_TTL);
  return token;
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `nas_codex_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(
      TOKEN_TTL / 1000
    )}`
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function safeCwd(value) {
  const candidate = path.resolve(value || WORKSPACE);
  if (candidate === WORKSPACE || candidate.startsWith(`${WORKSPACE}${path.sep}`)) {
    return candidate;
  }
  return WORKSPACE;
}

function cleanText(value, limit = 160) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function readFavorites() {
  try {
    const content = fs.readFileSync(FAVORITES_FILE, 'utf8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [threadId, pinned = '0', ...label] = line.split('\t');
        return {
          threadId,
          pinned: pinned === '1',
          label: label.join('\t') || '',
        };
      });
  } catch {
    return [];
  }
}

function writeFavorites(favorites) {
  fs.mkdirSync(CODEX_HOME, { recursive: true });
  const content = favorites
    .filter((favorite) => favorite.threadId)
    .map((favorite) => {
      const label = cleanText(favorite.label, 120).replace(/\t/g, ' ');
      return `${favorite.threadId}\t${favorite.pinned ? '1' : '0'}\t${label}`;
    })
    .join('\n');
  fs.writeFileSync(FAVORITES_FILE, content ? `${content}\n` : '', { mode: 0o600 });
}

function queryHistory() {
  const script = String.raw`
import glob, json, os, sqlite3, sys
home = os.environ.get("CODEX_HOME", "/root/.codex")
paths = glob.glob(os.path.join(home, "state_*.sqlite"))
if not paths:
    print("[]")
    sys.exit(0)
path = max(paths, key=os.path.getmtime)
connection = sqlite3.connect("file:" + path + "?mode=ro", uri=True)
connection.row_factory = sqlite3.Row
rows = connection.execute("""
    SELECT id, title, name, first_user_message, preview, archived, cwd,
           COALESCE(recency_at_ms, updated_at_ms, updated_at * 1000) AS sort_time,
           COALESCE(updated_at_ms, updated_at * 1000) AS updated_time
    FROM threads
    ORDER BY sort_time DESC
    LIMIT 200
""").fetchall()
result = []
for row in rows:
    title = row["title"] or row["name"] or row["first_user_message"] or row["preview"] or row["id"]
    result.append({
        "threadId": row["id"],
        "title": " ".join(str(title).split())[:160],
        "archived": bool(row["archived"]),
        "cwd": row["cwd"],
        "updatedAt": row["updated_time"] or row["sort_time"] or 0,
    })
print(json.dumps(result))
`;

  try {
    const output = execFileSync('python3', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, CODEX_HOME },
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(output || '[]');
  } catch {
    return [];
  }
}

function sendEvent(task, event) {
  const normalized = {
    id: crypto.randomUUID(),
    at: Date.now(),
    ...event,
  };
  task.events.push(normalized);
  if (task.events.length > 1000) task.events.shift();
  for (const client of task.clients) {
    try {
      client.write(`event: message\ndata: ${JSON.stringify(normalized)}\n\n`);
    } catch {
      task.clients.delete(client);
    }
  }
}

function taskSummary(task) {
  return {
    id: task.id,
    title: task.title,
    threadId: task.threadId,
    cwd: task.cwd,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function handleCodexEvent(task, payload) {
  if (payload.type === 'thread.started') {
    task.threadId = payload.thread_id;
    task.updatedAt = Date.now();
    sendEvent(task, { type: 'session', threadId: task.threadId });
    return;
  }

  if (payload.type === 'turn.started') {
    task.status = 'running';
    sendEvent(task, { type: 'status', state: 'thinking', text: 'Codex 正在分析' });
    return;
  }

  if (payload.type === 'turn.completed') {
    task.status = 'idle';
    task.updatedAt = Date.now();
    sendEvent(task, { type: 'usage', usage: payload.usage || {} });
    sendEvent(task, { type: 'status', state: 'complete', text: '本轮完成' });
    return;
  }

  const item = payload.item;
  if (!item) return;

  if (item.type === 'agent_message') {
    sendEvent(task, { type: 'message', role: 'assistant', text: item.text || '' });
    return;
  }

  if (item.type === 'error') {
    sendEvent(task, { type: 'notice', level: 'error', text: item.message || 'Codex 返回错误' });
    return;
  }

  if (item.type === 'command_execution') {
    sendEvent(task, {
      type: 'tool',
      itemId: item.id,
      command: item.command || '',
      output: item.aggregated_output || '',
      exitCode: item.exit_code,
      status: item.status || '',
    });
  }
}

function buildCodexArgs(task, prompt, resumeId) {
  const args = ['exec', '--json', '--skip-git-repo-check', '-C', task.cwd];
  if (resumeId) args.push('resume', resumeId, prompt);
  else args.push(prompt);
  return args;
}

function makeMockProcess(task, prompt, resumeId) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const listeners = { close: [] };
  const processHandle = {
    stdin: { end() {} },
    stdout,
    stderr,
    on(event, callback) { if (event === 'close') listeners.close.push(callback); },
    kill() {},
  };

  const emit = (object) => {
    stdout.write(`${JSON.stringify(object)}\n`);
  };

  const threadId = resumeId || crypto.randomUUID();
  setTimeout(() => emit({ type: 'thread.started', thread_id: threadId }), 100);
  setTimeout(() => emit({ type: 'turn.started' }), 260);
  if (/目录|文件|ls|pwd/i.test(prompt)) {
    setTimeout(
      () =>
        emit({
          type: 'item.completed',
          item: {
            id: 'mock-command',
            type: 'command_execution',
            command: "/bin/bash -lc 'pwd && ls -la'",
            aggregated_output: '/app\nmock-server.js\nindex.html\n',
            exit_code: 0,
            status: 'completed',
          },
        }),
      700
    );
  }
  setTimeout(
    () =>
      emit({
        type: 'item.completed',
        item: {
          id: 'mock-message',
          type: 'agent_message',
          text: `已收到：${cleanText(prompt, 90)}。这是模拟流式响应，用于验证界面。`,
        },
      }),
    1200
  );
  setTimeout(
    () =>
      emit({
        type: 'turn.completed',
        usage: { input_tokens: 128, output_tokens: 64, reasoning_output_tokens: 18 },
      }),
    1600
  );
  setTimeout(() => {
    stdout.end();
    stderr.end();
    for (const callback of listeners.close) callback(0);
  }, 1750);

  return processHandle;
}

function startCodex(task, prompt, resumeId = null) {
  if (task.process) {
    throw new Error('任务仍在运行');
  }

  const args = buildCodexArgs(task, prompt, resumeId);
  let child;

  if (RUN_MODE === 'mock') {
    child = makeMockProcess(task, prompt, resumeId);
  } else if (RUN_MODE === 'docker') {
    child = spawn('docker', ['exec', '-i', CONTAINER, 'codex', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
  } else {
    child = spawn('codex', args, {
      cwd: task.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
  }

  task.process = child;
  task.status = 'running';
  task.updatedAt = Date.now();
  sendEvent(task, { type: 'status', state: 'starting', text: resumeId ? '恢复对话' : '启动任务' });

  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    const value = line.trim();
    if (!value) return;
    try {
      handleCodexEvent(task, JSON.parse(value));
    } catch {
      sendEvent(task, { type: 'raw', text: value });
    }
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim();
    if (text) sendEvent(task, { type: 'notice', level: 'warning', text });
  });

  child.on('close', (code) => {
    task.process = null;
    task.updatedAt = Date.now();
    if (task.status !== 'idle') {
      task.status = code === 0 ? 'idle' : 'error';
    }
    if (code !== 0 && code !== null) {
      sendEvent(task, { type: 'status', state: 'error', text: `进程退出：${code}` });
    }
  });

  return child;
}

function createTask({ prompt, cwd, resumeId }) {
  const id = crypto.randomUUID();
  const task = {
    id,
    title: cleanText(prompt || '恢复的对话', 96),
    threadId: resumeId || null,
    cwd: safeCwd(cwd),
    status: 'starting',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [],
    clients: new Set(),
    process: null,
  };
  tasks.set(id, task);
  sendEvent(task, { type: 'message', role: 'user', text: prompt || '继续上一次对话' });
  startCodex(task, prompt || '继续上一次对话', resumeId);
  return task;
}

function updateLanguage(locale) {
  const instructions = {
    'zh-CN': '除非用户明确要求使用其他语言，否则始终使用简体中文回答。代码、命令、路径、标识符和原始输出保持原样。',
    'zh-HK': '除非用戶明確要求使用其他語言，否則始終使用香港繁體中文回答。程式碼、指令、路徑、識別碼和原始輸出保持原樣。',
    en: 'Unless the user explicitly requests another language, always answer in English. Keep code, commands, paths, identifiers, and raw output unchanged.',
  };
  const instruction = instructions[locale];
  if (!instruction) throw new Error('不支持的语言');
  fs.mkdirSync(CODEX_HOME, { recursive: true });
  fs.writeFileSync(AGENTS_FILE, `# User preferences\n\n${instruction}\n`, { mode: 0o600 });
}

function currentLanguage() {
  try {
    const content = fs.readFileSync(AGENTS_FILE, 'utf8');
    if (content.includes('zh-HK')) return 'zh-HK';
    if (content.toLowerCase().includes('english')) return 'en';
  } catch {}
  return 'zh-CN';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readTomlString(text, key) {
  const match = text.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*("(?:\\\\.|[^"])*")`, 'm'));
  if (!match) return '';
  try {
    return JSON.parse(match[1]);
  } catch {
    return '';
  }
}

function readApiKey() {
  try {
    const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    return typeof auth.OPENAI_API_KEY === 'string' ? auth.OPENAI_API_KEY : '';
  } catch {
    return '';
  }
}

function findTomlSection(text, header) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return null;

  let end = start + 1;
  while (end < lines.length && !lines[end].trimStart().startsWith('[')) end += 1;
  return { lines, start, end };
}

function readTomlSection(text, header) {
  const section = findTomlSection(text, header);
  return section ? section.lines.slice(section.start + 1, section.end).join('\n') : '';
}

function readProviderSettings() {
  let config = '';
  try {
    config = fs.readFileSync(CONFIG_FILE, 'utf8');
  } catch {}

  const providerId = readTomlString(config, 'model_provider') || 'custom';
  const section = readTomlSection(config, `[model_providers.${providerId}]`);
  const apiKey = readApiKey();

  return {
    providerId,
    model: readTomlString(config, 'model') || 'deepseek-flash',
    baseUrl: readTomlString(section, 'base_url') || 'https://api.deepseek.com',
    wireApi: readTomlString(section, 'wire_api') || 'responses',
    hasApiKey: Boolean(apiKey),
    apiKeySuffix: apiKey ? apiKey.slice(-4) : '',
  };
}

function setTopLevelTomlValue(text, key, value) {
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*.*$`, 'm');
  const line = `${key} = ${JSON.stringify(value)}`;
  if (pattern.test(text)) return text.replace(pattern, line);
  return `${line}\n${text}`;
}

function replaceTomlSection(text, header, section) {
  const match = findTomlSection(text, header);
  if (!match) return `${text.trimEnd()}\n\n${section.trimEnd()}\n`;

  return [
    ...match.lines.slice(0, match.start),
    ...section.trimEnd().split('\n'),
    '',
    ...match.lines.slice(match.end),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
    .concat('\n');
}

function normalizeBaseUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed.length > 500 || /[\r\n]/.test(trimmed)) {
    throw new Error('API 地址无效');
  }
  const parsed = new URL(trimmed);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('API 地址必须是 HTTP 或 HTTPS URL');
  }
  return parsed.toString().replace(/\/$/, '');
}

function updateProviderSettings(body) {
  const current = readProviderSettings();
  const providerId = current.providerId || 'custom';
  const model = cleanText(body.model, 200);
  if (!model || /["\r\n]/.test(model)) throw new Error('模型名称无效');
  const baseUrl = normalizeBaseUrl(body.baseUrl);
  const wireApi = body.wireApi === 'chat' ? 'chat' : 'responses';

  let config = '';
  try {
    config = fs.readFileSync(CONFIG_FILE, 'utf8');
  } catch {}
  config = setTopLevelTomlValue(config, 'model_provider', providerId);
  config = setTopLevelTomlValue(config, 'model', model);

  const header = `[model_providers.${providerId}]`;
  const section = [
    header,
    'name = "Managed API"',
    `base_url = ${JSON.stringify(baseUrl)}`,
    `wire_api = ${JSON.stringify(wireApi)}`,
    'requires_openai_auth = true',
  ].join('\n');
  config = replaceTomlSection(config, header, section);

  fs.mkdirSync(CODEX_HOME, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, `${config.trimEnd()}\n`, { mode: 0o600 });
  fs.chmodSync(CONFIG_FILE, 0o600);

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (apiKey) {
    if (apiKey.length > 1000 || /[\r\n]/.test(apiKey)) throw new Error('API Key 无效');
    fs.writeFileSync(AUTH_FILE, `${JSON.stringify({ OPENAI_API_KEY: apiKey })}\n`, { mode: 0o600 });
    fs.chmodSync(AUTH_FILE, 0o600);
  }

  return readProviderSettings();
}

async function fetchProviderModels(baseUrl, apiKey) {
  if (!apiKey) throw new Error('尚未配置 API Key');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`模型列表请求失败：HTTP ${response.status}`);
      error.status = response.status;
      error.details = text.slice(0, 300);
      throw error;
    }
    const payload = JSON.parse(text);
    const models = Array.isArray(payload.data)
      ? payload.data.map((item) => item.id).filter((id) => typeof id === 'string' && id)
      : [];
    return { ok: true, status: response.status, models };
  } finally {
    clearTimeout(timeout);
  }
}

async function testProviderConnection(settings) {
  const result = await fetchProviderModels(settings.baseUrl, readApiKey());
  return { ...result, message: `发现 ${result.models.length} 个模型` };
}

function rateLimited(ip) {
  const now = Date.now();
  const attempt = loginAttempts.get(ip) || { count: 0, resetAt: now + 60_000 };
  if (attempt.resetAt < now) {
    attempt.count = 0;
    attempt.resetAt = now + 60_000;
  }
  attempt.count += 1;
  loginAttempts.set(ip, attempt);
  return attempt.count > 12;
}

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (rateLimited(ip)) return json(res, 429, { error: '尝试次数过多，请稍后再试' });
    const body = await readBody(req);
    if (body.password !== PASSWORD) return json(res, 401, { error: '密码不正确' });
    const token = issueToken();
    setSessionCookie(res, token);
    return json(res, 200, { token });
  }

  if (!isAuthenticated(req, url)) {
    return json(res, 401, { error: '未登录' });
  }

  if (req.method === 'GET' && url.pathname === '/api/auth') {
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
    return json(res, 200, {
      tasks: [...tasks.values()].map(taskSummary),
      history: queryHistory(),
      favorites: readFavorites(),
      language: currentLanguage(),
      provider: readProviderSettings(),
      runner: RUN_MODE,
      workspace: WORKSPACE,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/history') {
    return json(res, 200, { history: queryHistory() });
  }

  if (req.method === 'GET' && url.pathname === '/api/favorites') {
    return json(res, 200, { favorites: readFavorites() });
  }

  if (req.method === 'POST' && url.pathname === '/api/favorites') {
    const body = await readBody(req);
    const threadId = cleanText(body.threadId, 80);
    if (!/^[A-Za-z0-9-]+$/.test(threadId)) return json(res, 400, { error: '无效会话 ID' });
    const favorites = readFavorites();
    const index = favorites.findIndex((favorite) => favorite.threadId === threadId);
    if (body.action === 'remove') {
      if (index >= 0) favorites.splice(index, 1);
    } else if (body.action === 'pin' || body.action === 'unpin') {
      const favorite = index >= 0 ? favorites[index] : { threadId, label: body.title || '' };
      favorite.pinned = body.action === 'pin';
      if (index >= 0) favorites[index] = favorite;
      else favorites.unshift(favorite);
    } else if (index >= 0) {
      favorites.splice(index, 1);
    } else {
      favorites.unshift({ threadId, pinned: false, label: cleanText(body.title, 120) });
    }
    writeFavorites(favorites);
    return json(res, 200, { favorites });
  }

  if (req.method === 'POST' && url.pathname === '/api/language') {
    const body = await readBody(req);
    updateLanguage(body.locale);
    return json(res, 200, { language: currentLanguage() });
  }

  if (req.method === 'GET' && url.pathname === '/api/provider') {
    return json(res, 200, { provider: readProviderSettings() });
  }

  if (req.method === 'POST' && url.pathname === '/api/provider') {
    const body = await readBody(req);
    const provider = updateProviderSettings(body);
    return json(res, 200, { provider });
  }

  if (req.method === 'POST' && url.pathname === '/api/provider/models') {
    const body = await readBody(req);
    const baseUrl = normalizeBaseUrl(body.baseUrl || readProviderSettings().baseUrl);
    const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim()
      ? body.apiKey.trim()
      : readApiKey();
    try {
      return json(res, 200, await fetchProviderModels(baseUrl, apiKey));
    } catch (error) {
      return json(res, error.status || 502, {
        error: error.message,
        details: error.details || '',
      });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/provider/test') {
    const result = await testProviderConnection(readProviderSettings());
    return json(res, result.ok ? 200 : 502, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/tasks') {
    const body = await readBody(req);
    const prompt = cleanText(body.prompt, 20_000);
    if (!prompt) return json(res, 400, { error: '请输入任务内容' });
    const task = createTask({
      prompt,
      cwd: safeCwd(body.cwd),
      resumeId: /^[A-Za-z0-9-]+$/.test(body.resumeId || '') ? body.resumeId : null,
    });
    return json(res, 201, { task: taskSummary(task) });
  }

  const inputMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/input$/);
  if (req.method === 'POST' && inputMatch) {
    const task = tasks.get(inputMatch[1]);
    if (!task) return json(res, 404, { error: '任务不存在' });
    if (task.process) return json(res, 409, { error: '任务仍在运行' });
    const body = await readBody(req);
    const prompt = cleanText(body.prompt, 20_000);
    if (!prompt) return json(res, 400, { error: '请输入内容' });
    sendEvent(task, { type: 'message', role: 'user', text: prompt });
    startCodex(task, prompt, task.threadId);
    return json(res, 202, { task: taskSummary(task) });
  }

  const stopMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/stop$/);
  if (req.method === 'POST' && stopMatch) {
    const task = tasks.get(stopMatch[1]);
    if (!task) return json(res, 404, { error: '任务不存在' });
    if (task.process) task.process.kill('SIGTERM');
    return json(res, 200, { ok: true });
  }

  const streamMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/events$/);
  if (req.method === 'GET' && streamMatch) {
    const task = tasks.get(streamMatch[1]);
    if (!task) return json(res, 404, { error: '任务不存在' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ task: taskSummary(task) })}\n\n`);
    for (const event of task.events) {
      res.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
    }
    task.clients.add(res);
    const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      task.clients.delete(res);
    });
    return;
  }

  const threadActionMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/(archive|unarchive|delete)$/);
  if (req.method === 'POST' && threadActionMatch) {
    const [, threadId, action] = threadActionMatch;
    if (!/^[A-Za-z0-9-]+$/.test(threadId)) return json(res, 400, { error: '无效会话 ID' });

    if (action === 'delete') {
      const body = await readBody(req);
      if (body.confirm !== 'DELETE') return json(res, 400, { error: '删除确认不正确' });
    }

    const command = action === 'delete' ? ['delete', '--force', threadId] : [action, threadId];
    const child =
      RUN_MODE === 'docker'
        ? spawn('docker', ['exec', '-i', CONTAINER, 'codex', ...command], {
            stdio: ['ignore', 'pipe', 'pipe'],
          })
        : spawn('codex', command, { stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk) => (output += chunk.toString('utf8')));
    child.on('close', (code) => {
      if (code !== 0) return json(res, 500, { error: output || `命令退出：${code}` });
      if (action === 'delete') {
        writeFavorites(readFavorites().filter((favorite) => favorite.threadId !== threadId));
      }
      json(res, 200, { ok: true, output });
    });
    return;
  }

  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    if (req.method === 'GET' && /\.(jpg|jpeg|png|gif|webp)$/i.test(url.pathname)) {
      const fileName = path.basename(decodeURIComponent(url.pathname));
      const imagePath = path.join(__dirname, fileName);
      const extension = path.extname(imagePath).toLowerCase();
      const contentTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      };

      if (imagePath.startsWith(`${__dirname}${path.sep}`) && fs.existsSync(imagePath)) {
        const image = fs.readFileSync(imagePath);
        res.writeHead(200, {
          'Content-Type': contentTypes[extension] || 'application/octet-stream',
          'Content-Length': image.length,
          'Cache-Control': 'public, max-age=86400',
        });
        res.end(image);
        return;
      }
    }

    if (req.method !== 'GET' || (url.pathname !== '/' && url.pathname !== '/index.html')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const html = fs.readFileSync(INDEX_FILE);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': html.length,
      'Cache-Control': 'no-cache',
      'Content-Security-Policy':
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https: http:; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(html);
  } catch (error) {
    json(res, 500, { error: error.message || '服务器错误' });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`NAS Codex Web listening on http://${HOST}:${PORT} (${RUN_MODE})`);
  });
}

module.exports = { readTomlSection, replaceTomlSection };
