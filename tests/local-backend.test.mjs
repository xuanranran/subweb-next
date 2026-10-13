import test from 'node:test';
import assert from 'node:assert/strict';
import { currentSiteBackend, versionProfile } from '../src/lib/local-backend.js';
import { buildConversion } from '../src/lib/converter.js';

test('LAN deployment uses the current IP and port and ignores the page path', () => {
  const local = currentSiteBackend({ href: 'http://192.168.2.190:25500/sub-web/index.html?view=local#main' });
  assert.equal(local.value, 'http://192.168.2.190:25500');
  const conversion = buildConversion({
    backend: local.value,
    profile: local.profile,
    target: 'clash',
    sources: 'https://example.com/sub',
  });
  assert.equal(new URL(conversion.url).origin, 'http://192.168.2.190:25500');
  assert.equal(new URL(conversion.url).pathname, '/sub');
});
test('loopback deployment follows the URL instead of fixing a port', () => {
  assert.equal(currentSiteBackend('http://127.0.0.1:25500/').value, 'http://127.0.0.1:25500');
  assert.equal(currentSiteBackend('http://127.0.0.2:25501/').value, 'http://127.0.0.2:25501');
});
test('HTTPS and IPv6 retain their origin without leaking credentials', () => {
  assert.equal(currentSiteBackend('https://192.168.2.190:8443/web/').value, 'https://192.168.2.190:8443');
  assert.equal(currentSiteBackend('http://[::1]:25500/').value, 'http://[::1]:25500');
  assert.equal(currentSiteBackend('http://user:password@127.0.0.1:25500/').value, 'http://127.0.0.1:25500');
});

test('domain access hides the local backend, including names that resolve to a local IP', () => {
  for (const url of [
    'https://sub.miaoceo.com/',
    'https://api.miaoceo.com/',
    'http://localhost:25500/',
    'http://router.local:25500/',
    'http://192.168.2.190.example.com:25500/',
  ])
    assert.equal(currentSiteBackend(url), null, url);
});

test('the provided IPv4 CIDRs include reserved and test networks with exact boundaries', () => {
  const ranges = [
    ['0.0.0.0', '0.255.255.255'],
    ['10.0.0.0', '10.255.255.255'],
    ['100.64.0.0', '100.127.255.255'],
    ['127.0.0.0', '127.255.255.255'],
    ['169.254.0.0', '169.254.255.255'],
    ['172.16.0.0', '172.31.255.255'],
    ['192.0.0.0', '192.0.0.255'],
    ['192.0.2.0', '192.0.2.255'],
    ['192.88.99.0', '192.88.99.255'],
    ['192.168.0.0', '192.168.255.255'],
    ['198.18.0.0', '198.19.255.255'],
    ['198.51.100.0', '198.51.100.255'],
    ['203.0.113.0', '203.0.113.255'],
    ['224.0.0.0', '239.255.255.255'],
    ['240.0.0.0', '255.255.255.255'],
    ['255.255.255.255', '255.255.255.255'],
  ];
  const addressNumber = (host) =>
    host
      .split('.')
      .map(Number)
      .reduce((value, octet) => value * 256 + octet, 0);
  const numberAddress = (value) =>
    [24, 16, 8, 0].map((bits) => Math.floor(value / 2 ** bits) % 256).join('.');
  for (const [first, last] of ranges) {
    assert.ok(currentSiteBackend(`http://${first}:25500/`), first);
    assert.ok(currentSiteBackend(`http://${last}:25500/`), last);
    for (const neighbor of [addressNumber(first) - 1, addressNumber(last) + 1]) {
      if (neighbor < 0 || neighbor > 0xffffffff) continue;
      const includedElsewhere = ranges.some(
        ([a, b]) => neighbor >= addressNumber(a) && neighbor <= addressNumber(b),
      );
      assert.equal(!!currentSiteBackend(`http://${numberAddress(neighbor)}:25500/`), includedElsewhere);
    }
  }
  assert.equal(currentSiteBackend('http://8.8.8.8:25500/'), null);
});

test('the provided IPv6 CIDRs use all 128 bits and do not match other IPv6 ranges', () => {
  for (const host of ['::', '::1', '2001::', '2001:0:ffff:ffff:ffff:ffff:ffff:ffff']) {
    assert.ok(currentSiteBackend(`http://[${host}]:25500/`), host);
  }
  for (const host of [
    '::2',
    '2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:1::',
    '2001:db8::1',
    'fd12::1',
    'fe80::1',
  ]) {
    assert.equal(currentSiteBackend(`http://[${host}]:25500/`), null, host);
  }
});
test('file URLs and invalid input do not create a bogus local API', () => {
  assert.equal(currentSiteBackend('file:///D:/subweb/index.html'), null);
  assert.equal(currentSiteBackend('not a URL'), null);
  assert.equal(currentSiteBackend(undefined), null);
});
test('local profile inference uses the service identity rather than the URL', () => {
  assert.equal(versionProfile('subconverter v0.9.0-26.1013.1444-de06431'), 'standard');
  assert.equal(versionProfile('SubConverter-Extended v1.9.14 · 545afd8'), 'extended');
  assert.equal(versionProfile('Subweb Next v1.0.0'), null);
  assert.equal(versionProfile('v1.0.0'), null);
});
