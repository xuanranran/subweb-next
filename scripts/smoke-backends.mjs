// Read-only conversion requests with a synthetic TEST-NET node; no real subscription.
import assert from 'node:assert/strict';
import { buildConversion } from '../src/lib/converter.js';
const endpoints = [
  ['extended', 'https://api.miaoceo.com'],
  ['standard', 'https://sub.miaoceo.com'],
];
const node = 'ss://YWVzLTEyOC1nY206dGVzdA@192.0.2.1:443#Subweb-Smoke';
let failures = 0;
for (const [profile, backend] of endpoints) {
  for (const action of ['version', 'clash', 'singbox', ...(profile === 'extended' ? ['explain'] : [])]) {
    try {
      const url =
        action === 'version'
          ? `${backend}/version`
          : buildConversion({
              backend,
              profile,
              target: action === 'singbox' ? 'singbox' : 'clash',
              sources: node,
              options: { list: 'true' },
              explain: action === 'explain',
            }).url;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'subconverter/v0.9.0', Origin: 'http://localhost:5173' },
        signal: AbortSignal.timeout(25000),
      });
      const text = await response.text();
      assert.equal(response.status, 200, `HTTP ${response.status}: ${text.slice(0, 180)}`);
      if (action === 'version') assert.match(text, /subconverter/i);
      else if (action === 'clash') assert.match(text, /Subweb-Smoke/);
      else if (action === 'singbox') assert.ok(JSON.parse(text).outbounds);
      else assert.ok(JSON.parse(text));
      console.log(
        `${profile} ${action}: PASS; CORS=${
          response.headers.get('access-control-allow-origin') || 'missing'
        }`,
      );
    } catch (e) {
      failures++;
      console.log(`${profile} ${action}: FAIL; ${e.message}`);
    }
  }
}
process.exitCode = failures ? 1 : 0;
