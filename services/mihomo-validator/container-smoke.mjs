import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const name = `subweb-validator-smoke-${randomUUID()}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const headers = { Authorization: 'Bearer ci-smoke-token', 'Content-Type': 'application/json' };
try {
  docker('run', '-d', '--name', name, '--read-only', '--cap-drop', 'ALL', '--pids-limit', '64',
    '--memory', '512m', '--cpus', '1', '--tmpfs', '/tmp:size=512m,mode=1777',
    '-p', '127.0.0.1::25550', '-e', 'VALIDATOR_TOKEN=ci-smoke-token',
    '-e', 'VALIDATOR_APP_ORIGIN=http://panel.example:25550',
    '-e', 'SUBWEB_LOCAL_BACKEND_URL=http://panel.example:25500', 'subweb-validator:smoke');
  const port = docker('port', name, '25550/tcp');
  const url = `http://${port}`;
  let health;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${url}/health`, { headers, signal: AbortSignal.timeout(1000) });
      if (response.ok) { health = await response.json(); break; }
    } catch { /* wait for Node and the alpha binary */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(health && /alpha/i.test(health.version), 'container must start with a real alpha kernel');
  const page = await fetch(url);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<div id="app"><\/div>/);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const config = await (await fetch(`${url}/conf/config.js`)).text();
  assert.match(config, /http:\/\/panel.example:25550/);
  assert.doesNotMatch(config, /ci-smoke-token/);
  const asset = html.match(/src="(\.\/assets\/[^\"]+\.js)"/)[1];
  const script = await fetch(new URL(asset, url + '/'));
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  const valid = 'proxies: []\nproxy-groups:\n  - name: Test\n    type: select\n    proxies: [DIRECT]\nrules: ["MATCH,Test"]\n';
  const invalid = valid + 'dns:\n  enable: true\n  nameserver: [1.1.1.1]\n  enhanced-mode: fake-ip\n  fake-ip-filter-mode: rule\n  fake-ip-filter: ["*"]\n';
  const mirror = valid + 'geox-url:\n  geoip: https://mirror.example/geoip.dat\n  geosite: https://mirror.example/geosite.dat\n';
  const syntax = 'port: 7890\nport: 7891\n';
  for (const [config, expected, line] of [[valid, true], [mirror, true], [invalid, false, 12], [syntax, false, 2]]) {
    const response = await fetch(`${url}/validate`, { method: 'POST', headers: {
      'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://panel.example:25550',
    }, body: JSON.stringify({ config }), signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.valid, expected, result.output || result.error);
    if (!expected) {
      assert.equal(result.diagnostics[0].line, line);
      assert.equal(result.diagnostics[0].source, config === syntax ? 'yaml' : 'mihomo');
    }
  }
  console.log('Read-only Docker runtime and native validation passed:', health.version);
} catch (error) {
  try { console.error(docker('logs', name)); } catch { /* container was not created */ }
  throw error;
} finally {
  try { docker('rm', '-f', name); } catch { /* no container remains */ }
}
