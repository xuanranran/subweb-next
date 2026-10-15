import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, copyFile, rm, readdir, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { parseDocument, LineCounter } from 'yaml';
import { kernelDiagnostics } from './diagnostics.mjs';

const exec = promisify(execFile);
const CONFIG_LIMIT = 4 * 1024 * 1024;
const BODY_LIMIT = CONFIG_LIMIT * 2 + 1024;
const OUTPUT_LIMIT = 64 * 1024;
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const FILE_KEYS = new Set(['certificate', 'private-key', 'ca', 'ca-file', 'client-cert', 'client-key']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

function equalSecret(received, expected) {
  const a = Buffer.from(received || '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function servePanel(req, res, settings, session) {
  if (!settings.staticDir || !['GET', 'HEAD'].includes(req.method)) return false;
  let pathname;
  try { pathname = decodeURIComponent(req.url.split('?')[0]); } catch { return false; }
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') ||
      pathname.split('/').some((part) => part.startsWith('.'))) return false;
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!MIME[path.extname(relative)]) return false;
  let body;
  try {
    const root = await realpath(settings.staticDir);
    const file = await realpath(path.resolve(root, relative));
    if (!file.startsWith(root + path.sep)) return false;
    body = await readFile(file);
  } catch { return false; }
  if (pathname === '/conf/config.js' && settings.appOrigin) {
    // Public deployment addresses only. The API token never enters static JavaScript.
    const overrides = { mihomoValidatorUrl: settings.appOrigin };
    if (settings.localBackendUrl) overrides.localBackendUrl = settings.localBackendUrl;
    body = Buffer.concat([body, Buffer.from(`\nObject.assign(window.config, ${JSON.stringify(overrides)});\n`)]);
  }
  if (relative === 'index.html' && settings.appOrigin) {
    const secure = settings.appOrigin.startsWith('https:') ? '; Secure' : '';
    res.setHeader('Set-Cookie', `subweb_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`);
  }
  res.setHeader('Content-Type', MIME[path.extname(relative)]);
  res.setHeader('Content-Length', body.length);
  res.writeHead(200);
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

function httpError(status, message, details = {}) {
  return Object.assign(new Error(message), { status, ...details });
}

// The HTTP API accepts YAML only, never a shell command, URL to fetch or user-chosen filename.
// File providers and external file references cannot be transported with a single YAML document.
export function inspectConfig(text) {
  if (typeof text !== 'string' || !text.trim()) throw httpError(400, '请提交非空配置文本。');
  if (Buffer.byteLength(text) > CONFIG_LIMIT) throw httpError(413, '配置超过 4 MiB。');
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { uniqueKeys: true, lineCounter, prettyErrors: false });
  if (doc.errors.length) {
    const error = doc.errors[0];
    const position = error.pos?.[0];
    const at = typeof position === 'number' ? lineCounter.linePos(position) : null;
    const hints = { DUPLICATE_KEY: '存在重复字段', BAD_INDENT: '缩进不正确',
      MISSING_CHAR: '缺少必要的引号、括号或分隔符', BLOCK_AS_IMPLICIT_KEY: '请检查缩进与字段冒号' };
    const message = `YAML 语法错误：${hints[error.code] || error.code || '请检查配置格式'}`;
    throw httpError(400, message, { diagnostics: [{ source: 'yaml', severity: 'error', message,
      ...(at ? { line: at.line, column: at.col } : {}) }] });
  }
  let config;
  try { config = doc.toJS({ maxAliasCount: 100 }); }
  catch { throw httpError(400, 'YAML 别名展开超过限制。'); }
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw httpError(400, '需要完整的 Clash / Mihomo YAML 配置。');
  const secrets = [];
  const seen = new WeakSet();
  let nodes = 0;
  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    if (depth > 64 || ++nodes > 100000) throw httpError(400, '配置嵌套或节点数量超过限制。');
    seen.add(value);
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') {
        if (/password|secret|token|uuid|private-key|authorization/i.test(key) && item.length >= 4)
          secrets.push(item);
        if (FILE_KEYS.has(key) && item && !item.includes('-----BEGIN '))
          throw httpError(422, '配置引用了外部本地文件；请使用内联证书及相对资源路径后再校验。');
      }
      visit(item, depth + 1);
    }
  }
  visit(config);
  for (const providers of [config['proxy-providers'], config['rule-providers']]) {
    for (const provider of Object.values(providers || {})) {
      if (provider?.type === 'file') throw httpError(422, '当前校验服务不接收本地 file Provider 文件。');
      const file = provider?.path;
      if (typeof file === 'string' && (path.posix.isAbsolute(file) || path.win32.isAbsolute(file) ||
          /(^|[\\/])\.\.([\\/]|$)/.test(file) || file.includes(':')))
        throw httpError(422, 'Provider 缓存路径需位于本次校验的临时目录内。');
    }
  }
  // Keep geox-url and transport paths exactly as submitted; the kernel decides their validity.
  return { secrets };
}

export function redactOutput(output, secrets = [], directory = '') {
  let text = String(output).replace(/\x1b\[[0-9;]*m/g, '');
  for (const secret of secrets.sort((a, b) => b.length - a.length)) text = text.split(secret).join('[已隐藏]');
  if (directory) text = text.split(directory).join('[临时目录]');
  return text.replace(/(?:https?|ssr?|vmess|vless|trojan|hysteria2|hy2|tuic):\/\/[^\s<>"']+/gi, '[链接已隐藏]');
}

export async function testConfig(text, settings) {
  const { secrets } = inspectConfig(text);
  const directory = await mkdtemp(path.join(tmpdir(), 'subweb-mihomo-'));
  const started = Date.now();
  try {
    await writeFile(path.join(directory, 'config.yaml'), text, { mode: 0o600 });
    if (settings.geodataDir) {
      // Copy trusted database files only. No shared writable cache or user's live client directory.
      const files = await readdir(settings.geodataDir);
      for (const name of ['geosite.dat', 'geoip.dat', 'geoip.metadb', 'Country.mmdb', 'ASN.mmdb']) {
        if (files.includes(name)) await copyFile(path.join(settings.geodataDir, name), path.join(directory, name));
      }
    }
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^CLASH_|^MIHOMO_|^VALIDATOR_/.test(key)) delete env[key];
    // Prevent environment variables from bypassing Mihomo's filesystem path checks.
    delete env.SKIP_SAFE_PATH_CHECK;
    delete env.SAFE_PATHS;
    let result;
    try {
      result = await exec(settings.binary, ['-t', '-d', directory, '-f', path.join(directory, 'config.yaml')], {
        timeout: settings.timeoutMs || 20000, maxBuffer: OUTPUT_LIMIT,
        killSignal: 'SIGKILL', windowsHide: true, cwd: directory, env,
      });
      result.valid = true;
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EACCES')
        throw httpError(503, 'Mihomo 内核不可用，请检查服务端 MIHOMO_BIN。');
      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
        throw httpError(502, '内核日志超过限制，未完成校验。');
      if (error.killed) throw httpError(504, '内核校验超时，未完成校验。请检查地理数据资源。');
      if (typeof error.code !== 'number') throw httpError(503, '无法执行 Mihomo 内核校验。');
      result = { ...error, valid: false };
    }
    const rawOutput = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    const redact = (value) => redactOutput(value, secrets, directory);
    return {
      engine: 'mihomo', mode: 'config-test', version: settings.version,
      valid: result.valid, durationMs: Date.now() - started,
      output: redact(rawOutput),
      diagnostics: result.valid ? [] : kernelDiagnostics(text, rawOutput)
        .map((diagnostic) => ({ ...diagnostic, message: redact(diagnostic.message) })),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function createValidatorServer(settings) {
  let active = false;
  const origins = new Set(settings.origins || []);
  if (settings.appOrigin) origins.add(settings.appOrigin);
  const session = randomBytes(32).toString('hex');
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
    const origin = req.headers.origin;
    if (origin) {
      if (!origins.has(origin)) return send(403, { error: '此页面来源未获校验服务允许。' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.headers['access-control-request-private-network'] === 'true')
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') return send(204, {});
    if (await servePanel(req, res, settings, session)) return;
    // Only the bundled panel can use its HttpOnly session. Cross-origin clients still need Bearer auth.
    const cookie = req.headers.cookie?.split(';').map((part) => part.trim())
      .find((part) => part.startsWith('subweb_session='))?.slice('subweb_session='.length);
    const panelRequest = settings.staticDir && settings.appOrigin && origin === settings.appOrigin &&
      req.method === 'POST' && req.url === '/validate' && equalSecret(cookie, session);
    if (settings.token && !panelRequest) {
      if (!equalSecret(req.headers.authorization, `Bearer ${settings.token}`))
        return send(401, { error: '校验服务令牌不正确。' });
    }
    if (req.method === 'GET' && req.url === '/health')
      return send(200, { engine: 'mihomo', version: settings.version, mode: 'config-test' });
    if (req.method !== 'POST' || req.url !== '/validate') return send(404, { error: 'Not Found' });
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))
      return send(415, { error: '需要 application/json。' });
    if (active) return send(429, { error: '校验服务忙，请稍后重试。' });
    active = true;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > BODY_LIMIT) throw httpError(413, '请求体过大。');
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw httpError(400, 'JSON 格式无效。'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some((key) => key !== 'config')) throw httpError(400, '只接受 config 字段。');
      // Validate request boundaries even when a test runner is injected.
      inspectConfig(body.config);
      send(200, await (settings.run || testConfig)(body.config, settings));
    } catch (error) {
      if (error.diagnostics) send(200, { engine: 'mihomo', mode: 'config-test', version: settings.version,
        valid: false, stage: 'yaml', durationMs: 0, output: error.message, diagnostics: error.diagnostics });
      else send(error.status || 500, { error: error.status ? error.message : '校验服务内部错误，未完成校验。' });
    } finally { active = false; }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

export async function start() {
  const host = process.env.VALIDATOR_HOST || '127.0.0.1';
  const token = process.env.VALIDATOR_TOKEN || '';
  if (!LOOPBACK.has(host) && !token) throw new Error('非回环监听必须设置 VALIDATOR_TOKEN。');
  const binary = process.env.MIHOMO_BIN || 'mihomo-alpha';
  const { stdout } = await exec(binary, ['-v'], { timeout: 5000, maxBuffer: OUTPUT_LIMIT, windowsHide: true });
  const version = stdout.trim().split(/\r?\n/)[0];
  if (!/Mihomo/i.test(version) || !/alpha/i.test(version)) throw new Error('请将 MIHOMO_BIN 指向 Mihomo alpha 内核。');
  const server = createValidatorServer({
    binary, version, token, geodataDir: process.env.MIHOMO_GEODATA_DIR,
    staticDir: process.env.VALIDATOR_STATIC_DIR,
    appOrigin: process.env.VALIDATOR_APP_ORIGIN ? new URL(process.env.VALIDATOR_APP_ORIGIN).origin : undefined,
    localBackendUrl: process.env.SUBWEB_LOCAL_BACKEND_URL,
    origins: (process.env.VALIDATOR_ORIGINS || 'http://127.0.0.1:5173').split(',').map((v) => v.trim()).filter(Boolean),
  });
  const port = Number(process.env.VALIDATOR_PORT || 25550);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  console.log(`Mihomo validator listening on ${host}:${port}; ${version}`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  start().catch((error) => { console.error(error.message); process.exitCode = 1; });
