import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
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
    'geox-url: {geosite: "http://127.0.0.1/private"}',
    'a: &a [x,x,x,x,x,x,x,x,x,x]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]',
  ]) assert.throws(() => inspectConfig(source), undefined, source);
  assert.doesNotThrow(() => inspectConfig(valid));
  assert.doesNotThrow(() => inspectConfig('proxy-providers: {x: {type: http, path: ./providers/x.yaml}}'));
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

test('real Mihomo accepts valid config and rejects DNS/filter and missing policy errors', {
  skip: !process.env.MIHOMO_TEST_BIN,
}, async () => {
  const binary = process.env.MIHOMO_TEST_BIN;
  const version = execFileSync(binary, ['-v'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0];
  const settings = { binary, version, timeoutMs: 10000 };
  const success = await testConfig(valid, settings);
  assert.equal(success.valid, true);
  assert.match(success.output, /successful/i);
  const badDNS = await testConfig(valid + 'dns:\n  enable: true\n  nameserver: [1.1.1.1]\n  enhanced-mode: fake-ip\n  fake-ip-filter-mode: rule\n  fake-ip-filter: ["*"]\n', settings);
  assert.equal(badDNS.valid, false);
  assert.match(badDNS.output, /fake-ip-filter|invalid action/i);
  const missingPolicy = await testConfig(valid.replace('MATCH,Test', 'MATCH,MissingPolicy'), settings);
  assert.equal(missingPolicy.valid, false);
  assert.match(missingPolicy.output, /MissingPolicy|not found/i);
  await assert.rejects(testConfig(valid, { binary: '/nonexistent/mihomo', version }), { status: 503 });
});
