import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, lookupSubscriptionInfo, lookupSubStoreExpiry, publicSubscriptionUrl } from './subscription-info.mjs';
import { subStoreSubscription } from './subscription-expiry.mjs';

const source = 'http://store.example/private-prefix/download/MAYING?target=Surge';
const expiryNode = 'ss://YWJj@example.com:443#' + encodeURIComponent('过期时间：2026-12-30 21:22:42');

test('Sub-Store flow supplies quota even when expiry is absent', async () => {
  const paths = [];
  const result = await lookupSubscriptionInfo(source, new AbortController().signal, {
    subStore: true,
    fetcher: async (url) => {
      paths.push(new URL(url).pathname);
      if (String(url).includes('/flow/')) return Response.json({ status: 'success', data: {
        usage: { upload: 10, download: 90 }, total: 200,
      } });
      return Response.json({ status: 'success', data: { name: 'MAYING', source: 'local', content: '' } });
    },
  });
  assert.deepEqual(result, { traffic: { used: 100, total: 200 } });
  assert.equal(paths[0], '/private-prefix/api/sub/flow/MAYING');
});

test('public-header lookup excludes internal addresses including IPv6 and only accepts HTTPS on the standard port', () => {
  for (const address of ['127.0.0.1', '192.168.2.190', '169.254.169.254', '100.100.100.200'])
    assert.equal(isPublicAddress({ address, family: 4 }), false);
  for (const address of ['::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1', '2002:a9fe:a9fe::1'])
    assert.equal(isPublicAddress({ address, family: 6 }), false);
  assert.equal(isPublicAddress({ address: '1.1.1.1', family: 4 }), true);
  assert.equal(isPublicAddress({ address: '2606:4700::1111', family: 6 }), true);
  for (const url of ['http://example.com/sub', 'https://example.com:8443/sub', 'https://user@example.com/sub', 'https://[::1]/sub'])
    assert.equal(publicSubscriptionUrl(url), null);
});

test('Sub-Store lookup is scoped to the named subscription and strips export-only query parameters', () => {
  assert.deepEqual(subStoreSubscription(source), { api: 'http://store.example/private-prefix/api/sub/MAYING', name: 'MAYING' });
  assert.equal(subStoreSubscription('https://store.example/download/%E6%B5%8B%E8%AF%95/Surge').name, '测试');
  for (const url of ['https://example.com/sub', 'https://store.example/download/collection/test',
    'https://store.example/download/%2fsettings', 'https://user:pass@store.example/download/test',
    'file:///download/test']) assert.equal(subStoreSubscription(url), null);
});

test('processed exports recover original status nodes without executing scripts or returning source credentials', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (String(url).includes('/api/sub/')) return Response.json({ status: 'success', data: {
      name: 'MAYING', source: 'remote', url: 'https://original.example/sub?token=private', ua: 'Clash',
      process: [{ type: 'Script Operator', args: { content: 'throw new Error("must not execute")' } }],
    } });
    return new Response(Buffer.from(expiryNode).toString('base64'));
  };
  const info = await lookupSubStoreExpiry(source, new AbortController().signal, fetcher);
  assert.deepEqual(info, { text: '2026-12-30 21:22:42', source: 'node', via: 'substore' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'http://store.example/private-prefix/api/sub/MAYING');
  assert.equal(calls[1].options.headers['User-Agent'], 'Clash');
  assert.doesNotMatch(JSON.stringify(info), /private|token|original.example|process|Script/);
});

test('original header takes priority; local sources work and aggregates never choose an arbitrary date', async () => {
  const signal = new AbortController().signal;
  const fetcher = async (url) => String(url).includes('/api/sub/')
    ? Response.json({ status: 'success', data: { name: 'MAYING', source: 'remote', url: 'https://original.example/sub' } })
    : new Response(expiryNode, { headers: { 'Subscription-Userinfo': 'expire=1893456000' } });
  assert.equal((await lookupSubStoreExpiry(source, signal, fetcher)).source, 'header');
  const local = async () => Response.json({ status: 'success', data: { name: 'MAYING', source: 'local', content: expiryNode } });
  assert.equal((await lookupSubStoreExpiry(source, signal, local)).text, '2026-12-30 21:22:42');
  const aggregate = async (url) => String(url).includes('/api/sub/')
    ? Response.json({ status: 'success', data: { name: 'MAYING', url: 'https://original.example/one\nhttps://original.example/two' } })
    : new Response('', { headers: { 'Subscription-Userinfo': 'expire=' + (String(url).endsWith('one') ? 1893456000 : 1893457000) } });
  assert.equal((await lookupSubStoreExpiry(source, signal, aggregate)).ambiguous, true);
});

test('non-Sub-Store JSON, invalid addresses, missing originals and oversized API responses fail safely', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(lookupSubStoreExpiry('https://example.com/sub', signal), { status: 400 });
  assert.equal(await lookupSubStoreExpiry(source, signal, async () => Response.json({ name: 'MAYING', url: 'file:///private' })), null);
  assert.equal(await lookupSubStoreExpiry(source, signal, async () => Response.json({ status: 'success', data: { name: 'OTHER', url: 'https://example.com/sub' } })), null);
  assert.equal(await lookupSubStoreExpiry(source, signal, async () => Response.json({ status: 'success', data: { name: 'MAYING', url: 'file:///private' } })), null);
  await assert.rejects(lookupSubStoreExpiry(source, signal, async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))), /too-large/);
});

test('local subscriptions read their separate user-info URL before content and return only expiry metadata', async () => {
  const calls = [];
  let bodyCancelled = false;
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/api/sub/')) return Response.json({ status: 'success', data: {
      name: 'MAYING', source: 'local', content: expiryNode, subUserinfo: 'https://info.example/account?token=secret',
    } });
    return new Response(new ReadableStream({ cancel() { bodyCancelled = true; } }), {
      headers: { 'Subscription-Userinfo': 'upload=0; total=800; expire=1803830400' },
    });
  };
  const result = await lookupSubStoreExpiry(source, new AbortController().signal, fetcher);
  assert.equal(result.source, 'header');
  assert.equal(result.timestamp, 1803830400);
  assert.equal(result.via, 'substore-info');
  assert.equal(calls.length, 2);
  assert.equal(bodyCancelled, true, 'a valid info header does not download the node list');
  assert.doesNotMatch(JSON.stringify(result), /secret|info.example|account/);
});

test('inline user-info overrides and unavailable separate URLs retain deterministic fallback behavior', async () => {
  const signal = new AbortController().signal;
  const inline = async () => Response.json({ status: 'success', data: {
    name: 'MAYING', source: 'local', content: expiryNode, subUserinfo: 'upload=0; expire=1803830400',
  } });
  assert.equal((await lookupSubStoreExpiry(source, signal, inline)).via, 'substore-info');
  const unavailable = async (url) => String(url).includes('/api/sub/')
    ? Response.json({ status: 'success', data: { name: 'MAYING', source: 'local', content: expiryNode, subUserinfo: 'https://info.example/sub' } })
    : new Response('Unavailable', { status: 503 });
  assert.equal((await lookupSubStoreExpiry(source, signal, unavailable)).source, 'node');
});
