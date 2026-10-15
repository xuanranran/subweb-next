import test from 'node:test';
import assert from 'node:assert/strict';
import { kernelDiagnostics } from './diagnostics.mjs';

test('kernel diagnostics resolve original YAML locations including inline lists and never invent unknown positions', () => {
  const config = '# heading\ndns:\n  fake-ip-filter: ["*", "MATCH,real-ip"]\nrules:\n  - MATCH,Missing\n';
  const [dns] = kernelDiagnostics(config, 'level=error msg="dns.fake-ip-filter[0] [*] error: invalid action"');
  assert.equal(dns.line, 3);
  assert.equal(dns.column, 20);
  assert.equal(dns.field, 'dns.fake-ip-filter[0]');
  const [rule] = kernelDiagnostics(config, 'level=error msg="rules[0] error: proxy not found"');
  assert.equal(rule.line, 5);
  const [explicit] = kernelDiagnostics(config, 'yaml: line 4: cannot unmarshal scalar');
  assert.equal(explicit.line, 4);
  const [unlocated] = kernelDiagnostics(config, 'level=error msg="download geodata failed"');
  assert.equal(unlocated.line, undefined);
  const [missing] = kernelDiagnostics(config, 'level=error msg="dns.nameserver[0] error"');
  assert.equal(missing.line, undefined);
});
