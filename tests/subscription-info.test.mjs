import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSubscriptionExpiry, formatTraffic, readSubscriptionInfo, subscriptionNodeNames, subscriptionSources } from '../src/lib/subscription-info.js';

test('public metadata supplement preserves node expiry and handles missing expiry and zero usage independently', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).endsWith('/subscription-info')) return Response.json({ kind: 'subscription-expiry', info: {
      traffic: { used: 0, total: 2 ** 40 },
    } });
    return new Response(encode(links));
  });
  const info = await readSubscriptionInfo('https://source.example/sub', {
    backend: 'https://converter.example', service: 'https://validator.example',
  }, new AbortController().signal);
  assert.equal(info.text, '2026-12-30 21:22:42');
  assert.deepEqual(info.traffic, { used: 0, total: 2 ** 40 });
  assert.equal(formatTraffic(info.traffic.total), '1 TB');
});

const encode = (value) => Buffer.from(value).toString('base64url');
const names = ['香港 01', '剩余流量：99.07% 891.66GB', '过期时间：2026-12-30 21:22:42'];
const ssr = (name) => `ssr://${encode(`example.com:443:origin:aes-128-gcm:plain:cGFzcw/?remarks=${encode(name)}`)}`;
const links = names.map(ssr).join('\n');

test('expiry comes from the response header before node names, and invalid or absent expire falls back', () => {
  const result = extractSubscriptionExpiry('upload=0; expire=1893456000; total=123', links);
  assert.equal(result.source, 'header');
  assert.equal(result.timestamp, 1893456000);
  for (const header of ['', 'upload=0; total=123', 'expire=0', 'expire=-1', 'expire=NaN', 'expire=999999999999999999999'])
    assert.deepEqual(extractSubscriptionExpiry(header, links), { text: '2026-12-30 21:22:42', source: 'node' });
});

test('SSR, URI fragments, VMess and UTF-8 Base64 wrappers retain status node names', () => {
  assert.deepEqual(subscriptionNodeNames(links), names);
  assert.deepEqual(subscriptionNodeNames(encode(links)), names);
  const uri = 'ss://dGVzdA@example.com:443#' + encodeURIComponent(names[2]);
  const vmess = `vmess://${encode(JSON.stringify({ ps: names[2], add: 'example.com' }))}`;
  for (const body of [uri, encode(uri), vmess])
    assert.equal(extractSubscriptionExpiry('', body).text, '2026-12-30 21:22:42');
});

test('Clash YAML and sing-box JSON inspect only node names and never arbitrary configuration text', () => {
  const yaml = `proxies:\n  - name: '${names[2]}'\n    type: ss\n    password: secret\n`;
  assert.deepEqual(subscriptionNodeNames(yaml), [names[2]]);
  assert.deepEqual(subscriptionNodeNames(JSON.stringify({ outbounds: [{ tag: names[2] }] })), [names[2]]);
  assert.equal(extractSubscriptionExpiry('', `rules: ['过期时间：2026-12-30']`), null);
  assert.equal(extractSubscriptionExpiry('', '<html>到期时间：2026-12-30</html>'), null);
});

test('dates are validated and unrelated dates, remaining traffic, or conflicting account dates are not guessed', () => {
  const expiry = (name) => extractSubscriptionExpiry('', ssr(name));
  assert.equal(expiry('到期日期：2028年2月29日').text, '2028-02-29');
  assert.equal(expiry('Expiry Date: 2026/12/30 21:22:42Z').text, '2026-12-30 21:22:42 Z');
  assert.equal(expiry('有效期至 2026.12.30').text, '2026-12-30');
  assert.equal(expiry('到期时间: 永久有效').text, '长期有效');
  for (const name of ['到期时间：2026-02-29', '到期：2026-12-30 25:10', '到期：2026-13-01',
    '更新日期：2026-12-30', '剩余流量：123GB', '有效期：剩余 30 天']) assert.equal(expiry(name), null, name);
  assert.equal(extractSubscriptionExpiry('', links + '\n' + ssr('到期：2027-01-01')).ambiguous, true);
  assert.equal(extractSubscriptionExpiry('', links + '\n' + ssr(names[2])).text, '2026-12-30 21:22:42');
});

test('source discovery removes Extended prefixes, deduplicates URLs, and never treats HTTP nodes as subscriptions', () => {
  const url = 'https://example.com/sub?a=1&b=2';
  assert.deepEqual(subscriptionSources(`provider:机场,interval:21600,tag:HK,${url}\n${url}\nnode:http://example.com:443\nss://abc#name`), [{ url, label: '机场' }]);
  assert.equal(subscriptionSources(encodeURIComponent(`provider:TAG,${url}`))[0].label, 'TAG');
  assert.equal(subscriptionSources(`<provider:TAG,${url}>`)[0].url, url);
  assert.deepEqual(subscriptionSources('https://\nprovider:x,not a URL\njavascript:alert(1)'), []);
});

test('a readable source header needs no converter request, sends no cookies, and does not download nodes', async (t) => {
  const calls = [];
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      headers: { 'Subscription-UserInfo': 'expire=1893456000' },
    });
  });
  const info = await readSubscriptionInfo('https://source.example/sub', { backend: 'https://converter.example' }, new AbortController().signal);
  assert.equal(info.source, 'header');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  assert.equal(cancelled, true);
});

test('CORS failures fall back to an isolated node-list query without template, prefix, or output filters', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new TypeError('Failed to fetch');
    return new Response(encode(links));
  });
  const info = await readSubscriptionInfo('https://source.example/sub', {
    backend: 'https://converter.example', options: { exclude: '过期', config: 'https://template.example',
      ua: 'Clash', provider_headers: 'X-Key' }, headerValues: '{"X-Key":"secret"}',
  }, new AbortController().signal);
  assert.equal(info.text, '2026-12-30 21:22:42');
  const query = new URL(calls[1].url);
  assert.equal(query.origin, 'https://converter.example');
  assert.equal(query.searchParams.get('url'), 'https://source.example/sub');
  assert.equal(query.searchParams.get('target'), 'mixed');
  assert.equal(query.searchParams.get('append_info'), 'true');
  assert.equal(query.searchParams.get('ua'), 'Clash');
  assert.equal(query.searchParams.get('include'), '.*');
  assert.equal(query.searchParams.get('exclude'), '^$');
  assert.equal(query.searchParams.get('rename'), '^$@');
  assert.equal(query.searchParams.has('config'), false);
  assert.equal(calls[1].options.headers['X-Key'], 'secret');
  assert.equal(query.href.includes('secret'), false);
});

test('aborted queries never fall back and oversized responses stop reading', async (t) => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; controller.abort(); throw new Error('cancelled'); });
  await assert.rejects(readSubscriptionInfo('https://source.example/sub', { backend: 'https://converter.example' }, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
  globalThis.fetch.mock.mockImplementation(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
  await assert.rejects(readSubscriptionInfo('https://source.example/sub', { backend: 'https://converter.example' }, new AbortController().signal), /subscription-too-large/);
});

test('Sub-Store exports with stripped status nodes use the authenticated info service and distinguish unavailable services', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (String(url).endsWith('/subscription-info')) return Response.json({ kind: 'subscription-expiry',
      info: { text: '2026-12-30 21:22:42', source: 'node', via: 'substore' } });
    return new Response('ss://YWJj@example.com:443#HK');
  });
  const source = 'http://store.example/private/download/MAYING';
  const settings = { backend: 'https://converter.example', service: 'https://validator.example', token: 'fixture-secret' };
  const info = await readSubscriptionInfo(source, settings, new AbortController().signal);
  assert.equal(info.via, 'substore');
  assert.equal(info.text, '2026-12-30 21:22:42');
  const request = calls.at(-1);
  assert.equal(request.url, 'https://validator.example/subscription-info');
  assert.deepEqual(JSON.parse(request.options.body), { source });
  assert.equal(request.options.headers.Authorization, 'Bearer fixture-secret');
  assert.equal(request.options.credentials, 'same-origin');
  globalThis.fetch.mock.mockImplementation(async (url) => String(url).endsWith('/subscription-info')
    ? Response.json({ error: 'Not Found' }, { status: 404 }) : new Response('ss://YWJj@example.com:443#HK'));
  assert.equal((await readSubscriptionInfo(source, settings, new AbortController().signal)).unavailable, true);
});

test('separate Sub-Store user-info timestamps use the browser timezone rather than the service-formatted text', async (t) => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  t.after(() => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; });
  t.mock.method(globalThis, 'fetch', async (url) => String(url).endsWith('/subscription-info')
    ? Response.json({ kind: 'subscription-expiry', info: {
      text: '2027-03-01 00:00:00', source: 'header', timestamp: 1803830400, via: 'substore-info',
    } }) : new Response('ss://YWJj@example.com:443#HK'));
  const info = await readSubscriptionInfo('http://store.example/private/download/TAG', {
    backend: 'https://converter.example', service: 'https://validator.example',
  }, new AbortController().signal);
  assert.equal(info.text, '2027-02-28 11:00:00');
  assert.equal(info.via, 'substore-info');
});
