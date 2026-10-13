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
  assert.equal(currentSiteBackend('http://localhost:25501/').value, 'http://localhost:25501');
});
test('HTTPS and IPv6 retain their origin without leaking credentials', () => {
  assert.equal(currentSiteBackend('https://example.com:8443/web/').value, 'https://example.com:8443');
  assert.equal(currentSiteBackend('http://[::1]:25500/').value, 'http://[::1]:25500');
  assert.equal(currentSiteBackend('http://user:password@localhost:25500/').value, 'http://localhost:25500');
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
