import test from 'node:test';
import assert from 'node:assert/strict';
import { createShortLink, fetchText, readVersion } from '../src/lib/network.js';

test('short service receives the full generated URL in FormData with no manual boundary', async (t) => {
  const long =
    'https://api.miaoceo.com/sub?url=' + encodeURIComponent('https://example.com/订阅?a=1&token=a+b');
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(url, 'https://i.miaoceo.com/short');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers, undefined);
    assert.equal(Buffer.from(request.body.get('longUrl'), 'base64').toString(), long);
    return Response.json({ Code: 1, ShortUrl: 'https://i.miaoceo.com/abcdef' });
  });
  assert.equal(await createShortLink('https://i.miaoceo.com/', long), 'https://i.miaoceo.com/abcdef');
});
test('short service business failures and verification HTML are surfaced', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ Code: 0, Message: 'KV unavailable' }));
  await assert.rejects(createShortLink('https://i.miaoceo.com', 'test'), /KV unavailable/);
  globalThis.fetch.mock.mockImplementation(async () => new Response('<html>Verification</html>'));
  await assert.rejects(createShortLink('https://i.miaoceo.com', 'test'), /不是 JSON/);
});
test('preview refuses HTTP errors and HTML challenges even when status is 200', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Invalid target', { status: 400 }));
  await assert.rejects(fetchText('https://example.com'), /HTTP 400/);
  globalThis.fetch.mock.mockImplementation(
    async () => new Response('<!DOCTYPE html><html>Just a moment</html>'),
  );
  await assert.rejects(fetchText('https://example.com'), /网页/);
});
test('version reader handles HTML identity pages without rendering backend HTML', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        '<html><style>bad style</style><h1>SubConverter-Extended</h1><p>v0.9.0</p><script>bad code</script></html>',
      ),
  );
  assert.equal(await readVersion('https://api.miaoceo.com'), 'SubConverter-Extended v0.9.0');
  globalThis.fetch.mock.mockImplementation(
    async () => new Response('<html>Just a moment cf-chl-test</html>'),
  );
  await assert.rejects(readVersion('https://api.miaoceo.com'), /验证/);
});
