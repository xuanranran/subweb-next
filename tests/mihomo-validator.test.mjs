import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMihomoConfig, supportsMihomoValidation } from '../src/lib/mihomo-validator.js';

test('Mihomo validation supports full Clash YAML and excludes node lists, scripts and other clients', () => {
  assert.equal(supportsMihomoValidation('clash'), true);
  assert.equal(supportsMihomoValidation('clashr'), true);
  for (const target of ['stash', 'singbox', 'surge', 'mixed']) assert.equal(supportsMihomoValidation(target), false);
  assert.equal(supportsMihomoValidation('clash', { list: 'true' }), false);
  assert.equal(supportsMihomoValidation('clash', { script: true }), false);
  assert.equal(supportsMihomoValidation('clash', { list: 'false' }), true);
});

test('validator submits exact YAML and separate bearer token, handles native failure and refuses fake/HTML results', async (t) => {
  let reply = Response.json({ engine: 'mihomo', mode: 'config-test', version: 'Mihomo fixture', valid: false, output: 'invalid action' });
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => { request = { url, options }; return reply; });
  const yaml = 'dns:\n  fake-ip-filter-mode: rule\n  fake-ip-filter: ["*"]\n';
  const result = await validateMihomoConfig('https://validator.example/prefix/', yaml, 'test-secret');
  assert.equal(result.valid, false);
  assert.equal(request.url, 'https://validator.example/prefix/validate');
  assert.deepEqual(JSON.parse(request.options.body), { config: yaml });
  assert.deepEqual(request.options.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer test-secret' });
  assert.equal(request.options.credentials, 'same-origin');
  reply = new Response('<html>verification</html>');
  await assert.rejects(validateMihomoConfig('https://validator.example', yaml), /JSON/);
  reply = Response.json({ valid: true });
  await assert.rejects(validateMihomoConfig('https://validator.example', yaml), /响应格式/);
  reply = Response.json({ error: '校验服务忙' }, { status: 429 });
  await assert.rejects(validateMihomoConfig('https://validator.example', yaml), /校验服务忙/);
});

test('service connection failures identify the validator and do not become validation success', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(validateMihomoConfig('https://validator.example', 'dns: {}'), /无法连接校验服务/);
});
