import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectConfig, redactOutput, createValidatorServer, testConfig } from './server.mjs';

const valid = 'proxies: []\nproxy-groups:\n  - name: Test\n    type: select\n    proxies: [DIRECT]\nrules: ["MATCH,Test"]\n';
const report = { engine: 'mihomo', mode: 'config-test', version: 'Mihomo test fixture', valid: true, output: 'test successful' };

test('request policy rejects external files, unsafe paths, alias bombs and non-config YAML', () => {
  for (const source of [
    'hello', '[]', 'a: 1\na: 2',
    'proxy-providers: {x: {type: file, path: ./private.yaml}}',
    'proxy-providers: {x: {type: http, path: ../private.yaml}}',
    'proxy-providers: {x: {type: http, path: "C:\\private.yaml"}}',
    'proxies: [{certificate: /etc/passwd}]',
    'a: &a [x,x,x,x,x,x,x,x,x,x]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]',
  ]) assert.throws(() => inspectConfig(source), undefined, source);
  assert.doesNotThrow(() => inspectConfig(valid));
  assert.doesNotThrow(() => inspectConfig('proxy-providers: {x: {type: http, path: ./providers/x.yaml}}'));
  assert.doesNotThrow(() => inspectConfig('geox-url: {geosite: "https://mirror.example/geosite.dat"}'));
  assert.doesNotThrow(() => inspectConfig('proxies: [{name: ws, type: vmess, ws-opts: {path: /websocket}}]'));
});

test('kernel output redacts credentials, links and temporary directory', () => {
  const result = redactOutput('secret-123 https://example.com/sub?token=a vless://uuid@host /tmp/private/config.yaml', ['secret-123'], '/tmp/private');
  assert.doesNotMatch(result, /secret-123|token=a|uuid@host|\/tmp\/private/);
});

test('HTTP contract authenticates and checks CORS before accepting exact YAML, while refusing overlap', async () => {
  let release;
  const received = [];
  const server = createValidatorServer({
    token: 'fixture-secret', origins: ['https://panel.example'], version: report.version,
    run: async (config) => {
      received.push(config);
      return await new Promise((resolve) => { release = () => resolve(report); });
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-secret', Origin: 'https://panel.example' };
  const post = (body, extra = {}) => fetch(`${url}/validate`, { method: 'POST', headers, body: JSON.stringify(body), ...extra });
  try {
    const preflight = await fetch(`${url}/validate`, { method: 'OPTIONS', headers: { Origin: headers.Origin } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), headers.Origin);
    assert.equal((await post({ config: valid }, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await post({ config: valid }, { headers: { ...headers, Authorization: '' } })).status, 401);
    assert.equal((await post({ url: 'https://example.com/sub' })).status, 400);
    assert.equal((await post({ config: '- nodes-only' })).status, 400);
    assert.equal((await post({ config: 'x'.repeat(4 * 1024 * 1024 + 1) })).status, 413);
    const syntax = await post({ config: 'dns:\n  enable: true\n  enable: false\n' });
    assert.equal(syntax.status, 200);
    const syntaxReport = await syntax.json();
    assert.equal(syntaxReport.valid, false);
    assert.equal(syntaxReport.stage, 'yaml');
    assert.equal(syntaxReport.diagnostics[0].line, 3);
    assert.equal(syntaxReport.diagnostics[0].column, 3);
    const pending = post({ config: valid });
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await post({ config: valid })).status, 429);
    release();
    const response = await pending;
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), report);
    assert.deepEqual(received, [valid]);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    release?.();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('bundled panel serves assets and uses an origin-bound session without exposing API credentials', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'subweb-panel-test-'));
  await mkdir(path.join(directory, 'conf'));
  await writeFile(path.join(directory, 'index.html'), '<html>Subweb panel</html>');
  await writeFile(path.join(directory, 'conf/config.js'), 'window.config = {};');
  await writeFile(path.join(directory, '.private.txt'), 'private');
  const appOrigin = 'http://panel.example:25550';
  const server = createValidatorServer({
    staticDir: directory, appOrigin, token: 'fixture-secret',
    localBackendUrl: 'http://panel.example:25500', origins: ['https://other.example'],
    run: async () => report,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /Subweb panel/);
    const cookie = page.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    assert.doesNotMatch(cookie, /fixture-secret/);
    const runtime = await (await fetch(`${url}/conf/config.js`)).text();
    assert.match(runtime, /mihomoValidatorUrl/);
    assert.match(runtime, /panel.example:25500/);
    assert.doesNotMatch(runtime, /fixture-secret|subweb_session/);
    assert.equal((await fetch(url, { method: 'HEAD' })).status, 200);
    for (const suffix of ['/missing.js', '/.private.txt', '/%2eprivate.txt', '/conf%2f..%2f.private.txt'])
      assert.notEqual((await fetch(url + suffix)).status, 200);
    const headers = { 'Content-Type': 'application/json', Cookie: cookie.split(';')[0], Origin: appOrigin };
    const post = (overrides = {}) => fetch(`${url}/validate`, {
      method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify({ config: valid }),
    });
    assert.deepEqual(await (await post()).json(), report);
    assert.equal((await post({ Cookie: '' })).status, 401);
    assert.equal((await post({ Cookie: 'subweb_session=wrong' })).status, 401);
    assert.equal((await post({ Origin: '' })).status, 401);
    assert.equal((await post({ Origin: 'https://other.example' })).status, 401);
    assert.equal((await post({ Origin: 'https://evil.example' })).status, 403);
    assert.equal((await fetch(`${url}/health`, { headers })).status, 401);
    assert.equal((await post({ Cookie: '', Origin: 'https://other.example', Authorization: 'Bearer fixture-secret' })).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('tunnel and LAN panels load Origin-bearing assets and validate with their own addresses and cookies', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'subweb-tunnel-test-'));
  await mkdir(path.join(directory, 'conf'));
  await writeFile(path.join(directory, 'index.html'), '<html>Subweb panel</html>');
  await writeFile(path.join(directory, 'conf/config.js'), 'window.config = {};');
  await writeFile(path.join(directory, 'app.js'), 'window.panelLoaded = true;');
  await writeFile(path.join(directory, 'app.css'), 'body { color: black; }');
  const appOrigin = 'http://192.168.2.190:25550';
  const publicOrigin = 'https://apis.miaoceo.com';
  const server = createValidatorServer({
    staticDir: directory, appOrigin, appOrigins: [publicOrigin], token: 'fixture-secret',
    origins: ['https://external-client.example'], run: async () => report,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const call = (pathname, host, headers = {}, body) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path: pathname,
      method: body ? 'POST' : 'GET', headers: { Host: host, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
  try {
    for (const origin of [appOrigin, publicOrigin]) {
      const host = new URL(origin).host;
      const page = await call('/', host);
      const cookie = page.headers['set-cookie'][0];
      assert.equal(page.status, 200);
      assert.equal(cookie.includes('; Secure'), origin.startsWith('https:'));
      for (const [pathname, mime] of [['/app.js', 'text/javascript'], ['/app.css', 'text/css']]) {
        const asset = await call(pathname, host, { Origin: origin });
        assert.equal(asset.status, 200, 'browser module/style request must not become a JSON 403');
        assert.ok(asset.headers['content-type'].startsWith(mime));
      }
      const runtime = await call('/conf/config.js', host);
      assert.ok(runtime.text.includes(`"mihomoValidatorUrl":"${origin}"`));
      assert.doesNotMatch(runtime.text, /fixture-secret/);
      const headers = { Origin: origin, Cookie: cookie.split(';')[0], 'Content-Type': 'application/json' };
      const result = await call('/validate', host, headers, JSON.stringify({ config: valid }));
      assert.equal(result.status, 200);
      assert.deepEqual(JSON.parse(result.text), report);
      assert.equal((await call('/validate', host, { ...headers, Cookie: '' }, JSON.stringify({ config: valid }))).status, 401);
      assert.equal((await call('/app.js', host, { Origin: 'https://evil.example' })).status, 403);
      assert.equal((await call('/validate', host, { ...headers, Origin: 'https://external-client.example' }, JSON.stringify({ config: valid }))).status, 401);
    }
    const spoof = await call('/conf/config.js', 'evil.example', { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' });
    assert.doesNotMatch(spoof.text, /evil\.example/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('real Mihomo accepts valid config and rejects DNS/filter and missing policy errors', {
  skip: !process.env.MIHOMO_TEST_BIN,
}, async () => {
  const binary = process.env.MIHOMO_TEST_BIN;
  const version = execFileSync(binary, ['-v'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0];
  const settings = { binary, version, timeoutMs: 10000 };
  const success = await testConfig(valid, settings);
  assert.equal(success.valid, true);
  assert.match(success.output, /successful/i);
  assert.deepEqual(success.diagnostics, []);
  const withMirror = await testConfig(valid + 'geox-url:\n  geoip: https://mirror.example/geoip.dat\n  geosite: https://mirror.example/geosite.dat\n', settings);
  assert.equal(withMirror.valid, true, 'custom geodata addresses reach the kernel unchanged');
  const badDNS = await testConfig(valid + 'dns:\n  enable: true\n  nameserver: [1.1.1.1]\n  enhanced-mode: fake-ip\n  fake-ip-filter-mode: rule\n  fake-ip-filter: ["*"]\n', settings);
  assert.equal(badDNS.valid, false);
  assert.match(badDNS.output, /fake-ip-filter|invalid action/i);
  assert.equal(badDNS.diagnostics[0].line, 12);
  assert.equal(badDNS.diagnostics[0].field, 'dns.fake-ip-filter[0]');
  const missingPolicy = await testConfig(valid.replace('MATCH,Test', 'MATCH,MissingPolicy'), settings);
  assert.equal(missingPolicy.valid, false);
  assert.match(missingPolicy.output, /MissingPolicy|not found/i);
  assert.equal(missingPolicy.diagnostics[0].line, 6);
  const badProxy = await testConfig('proxies:\n - name: Bad\n   type: invalid\nrules: ["MATCH,DIRECT"]\n', settings);
  assert.equal(badProxy.valid, false);
  assert.equal(badProxy.diagnostics[0].line, 2);
  const badGroup = await testConfig('proxy-groups:\n - name: Bad\n   type: select\n   proxies: [Missing]\nrules: ["MATCH,DIRECT"]\n', settings);
  assert.equal(badGroup.valid, false);
  assert.equal(badGroup.diagnostics[0].line, 2);
  await assert.rejects(testConfig(valid, { binary: '/nonexistent/mihomo', version }), { status: 503 });
});
