import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConversion,
  base64,
  endpoint,
  forwardedHeaders,
  normalizeSources,
} from '../src/lib/converter.js';
import { targetsFor, cleanOptions, parametersFor } from '../src/lib/backends.js';

const fixture = {
  backend: 'https://api.miaoceo.com/',
  profile: 'extended',
  target: 'clash',
  sources: 'https://example.com/sub?token=a+b%2Fc&name=机场',
};
const generate = (extra) => new URL(buildConversion({ ...fixture, ...extra }).url);

test('nested URLs, unicode and blank lines survive one query encoding', () => {
  const url = generate({
    sources: `\n ${fixture.sources}\r\n\nss://YWVzLTEyOC1nY206dGVzdA@192.0.2.1:443#测试\n`,
  });
  assert.equal(url.pathname, '/sub');
  assert.equal(
    url.searchParams.get('url'),
    `${fixture.sources}|ss://YWVzLTEyOC1nY206dGVzdA@192.0.2.1:443#测试`,
  );
});
test('omitted switches preserve backend defaults; explicit false is transmitted', () => {
  assert.deepEqual([...generate().searchParams.keys()], ['target', 'url']);
  const url = generate({ options: { expand: '', udp: false, emoji: 'true', insert: null } });
  assert.equal(url.searchParams.get('udp'), 'false');
  assert.equal(url.searchParams.get('emoji'), 'true');
  assert.equal(url.searchParams.has('expand'), false);
  assert.equal(url.searchParams.has('insert'), false);
});
test('Surge target and version are separate and no default is forced', () => {
  const url = generate({ target: 'surge', ver: '5' });
  assert.equal(url.searchParams.get('target'), 'surge');
  assert.equal(url.searchParams.get('ver'), '5');
  assert.equal(generate({ target: 'surge' }).searchParams.has('ver'), false);
  assert.equal(generate({ ver: '5' }).searchParams.has('ver'), false);
});
test('the actual backend entry point target sets differ', () => {
  assert.equal(targetsFor('extended').length, 22);
  assert.equal(targetsFor('standard').length, 16);
  for (const target of ['stash', 'vless', 'hysteria2', 'v2rayn', 'v2rayng', 'shadowrocket'])
    assert.throws(() => generate({ profile: 'standard', target }), /不支持/);
  assert.throws(() => generate({ target: 'wireguard' }), /不支持/);
});
test('ignored and unparsed parameters never leak to the other backend', () => {
  const ext = generate({
    options: {
      ua: 'wrong',
      agekey: 'secret',
      token: 'secret',
      groups: 'custom',
      ruleset: 'custom',
      filter_script: 'script',
      new_name: 'false',
      xudp: 'true',
      unexpected: 'yes',
    },
  });
  assert.deepEqual([...ext.searchParams.keys()], ['target', 'url']);
  const standard = generate({
    profile: 'standard',
    options: { provider_proxy_direct: true, provider_headers: 'X-Key', ua: 'test' },
  });
  assert.equal(standard.searchParams.get('ua'), 'test');
  assert.equal(standard.searchParams.has('provider_headers'), false);
});
test('switching targets drops parameters with incompatible semantics', () => {
  assert.deepEqual(
    cleanOptions('extended', 'singbox', {
      udp: 'false',
      provider_proxy_direct: 'true',
      expand: 'false',
      new_name: 'true',
    }),
    { udp: 'false' },
  );
  assert.equal(
    parametersFor('extended', 'clashr').some((p) => p.key === 'provider_headers'),
    false,
  );
  assert.equal(
    parametersFor('extended', 'surge').some((p) => p.key === 'classic'),
    false,
  );
});
test('Unicode custom groups use URL-safe Base64 and managed URL uses ordinary Base64', () => {
  const raw = '选择`select`.*@直连`select`[]DIRECT';
  const url = generate({
    profile: 'standard',
    options: { groups: raw, profile_data: 'https://example.com/托管' },
  });
  assert.equal(Buffer.from(url.searchParams.get('groups'), 'base64url').toString(), raw);
  assert.equal(
    Buffer.from(url.searchParams.get('profile_data'), 'base64').toString(),
    'https://example.com/托管',
  );
  assert.equal(Buffer.from(base64('你好'), 'base64').toString(), '你好');
});
test('endpoint validation protects path joining and rejects ambiguous roots', () => {
  assert.equal(endpoint(' https://example.com/api/// '), 'https://example.com/api');
  assert.equal(generate({ backend: 'https://example.com/api/' }).pathname, '/api/sub');
  for (const invalid of [
    'hello https://example.com',
    'javascript:alert(1)',
    'https://user:password@example.com',
    'https://example.com?target=stash',
    'https://example.com/#hash',
  ])
    assert.throws(() => endpoint(invalid));
});
test('provider-only prefixes enforce backend and target constraints', () => {
  const source = 'provider:HK,interval:21600,tag:机场,https://example.com/sub';
  assert.equal(normalizeSources(source, 'extended', 'stash'), source);
  assert.throws(() => normalizeSources(source, 'standard', 'clash'), /Extended/);
  assert.throws(() => normalizeSources(source, 'extended', 'loon'), /间隔/);
  assert.throws(() => normalizeSources(source, 'extended', 'clash', { list: 'true' }), /节点/);
  assert.throws(() => normalizeSources('interval:0,https://example.com/sub', 'extended', 'surge'), /大于 0/);
  assert.throws(
    () => normalizeSources('interval:1,interval:2,https://example.com/sub', 'extended', 'clash'),
    /重复/,
  );
  assert.equal(
    normalizeSources('tag:机场,https://example.com/sub', 'standard', 'clash'),
    'tag:机场,https://example.com/sub',
  );
  assert.equal(
    normalizeSources('<provider:HK,https://example.com/sub>', 'extended', 'clash'),
    '<provider:HK,https://example.com/sub>',
  );
});
test('explicit HTTP node rules are not mistaken for subscription URLs', () => {
  assert.equal(
    normalizeSources('node:https://192.0.2.1:443', 'extended', 'clash'),
    'node:https://192.0.2.1:443',
  );
  for (const source of [
    'node:https://example.com',
    'node:http://example.com:80/path',
    'node:http://user:pass@example.com:80',
    'provider:HK,node:http://example.com:80',
  ])
    assert.throws(() => normalizeSources(source, 'extended', 'clash'));
  assert.throws(() => normalizeSources('node:http://example.com:80', 'extended', 'singbox'));
});
test('forwarded headers require real values and reject reserved or malformed headers', () => {
  assert.deepEqual(forwardedHeaders('X-Key', '{"x-key":"value"}'), { 'X-Key': 'value' });
  for (const name of ['Cookie', 'User-Agent', 'Range', 'X-Real-IP', 'CF-Test'])
    assert.throws(() => forwardedHeaders(name, JSON.stringify({ [name]: 'test' })));
  assert.throws(() => forwardedHeaders('X-Key', '{}'), /填写/);
  assert.throws(() => forwardedHeaders('X-Key,x-key', '{"X-Key":"test"}'), /重复/);
  assert.throws(() => forwardedHeaders('X-Key', '{"X-Key":"value\\nInjected"}'), /有效/);
  const req = buildConversion({
    ...fixture,
    options: { provider_headers: 'X-Key' },
    headerValues: '{"X-Key":"value"}',
  });
  assert.deepEqual(req.headers, { 'X-Key': 'value' });
  assert.equal(new URL(req.url).searchParams.get('provider_headers'), 'X-Key');
  assert.equal(req.url.includes('value'), false);
});
test('Extended explain is an explicit action and normal generated URLs never diagnose', () => {
  assert.equal(generate().searchParams.has('explain'), false);
  assert.equal(generate({ explain: true }).searchParams.get('explain'), 'true');
  assert.throws(() => generate({ explain: true, profile: 'standard' }), /仅支持/);
});
