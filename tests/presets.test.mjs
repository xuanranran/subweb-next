import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AETHERSAILOR_PRESETS,
  AETHERSAILOR_SOURCE,
  templatesFor,
  templateGroups,
} from '../src/lib/presets.js';
import { parseAethersailorCatalog } from '../scripts/template-catalog.mjs';
import { buildConversion } from '../src/lib/converter.js';

test('snapshot contains exactly the eight Aethersailor variants with original URLs', () => {
  assert.equal(AETHERSAILOR_PRESETS.length, 8);
  assert.equal(AETHERSAILOR_SOURCE.repository, 'Aethersailor/Custom_OpenClash_Rules');
  for (const id of [
    'Custom_Clash.ini',
    'Custom_Clash_Fallback.ini',
    'Custom_Clash_Lite.ini',
    'Custom_Clash_Lite_Fallback.ini',
    'Custom_Clash_GFW.ini',
    'Custom_Clash_GFW_Fallback.ini',
    'Custom_Clash_Full.ini',
    'Custom_Clash_Full_Fallback.ini',
  ]) {
    const template = AETHERSAILOR_PRESETS.find((t) => t.id === id);
    assert.ok(template);
    assert.equal(
      template.value,
      `https://raw.githubusercontent.com/Aethersailor/Custom_OpenClash_Rules/refs/heads/main/cfg/${id}`,
    );
    assert.equal(template.group, 'Aethersailor');
  }
});
test('import extracts only Aethersailor and validates its rows', () => {
  const valid = 'Aethersailor 规则 标准版,Custom.ini,https://example.com/Custom.ini';
  const result = parseAethersailorCatalog(
    `eHpo1 规则,ehpo1_main.ini,https://example.com/ehpo1_main.ini\nACL4SSR 规则,test.ini,https://example.com/test.ini\n${valid}\r\n`,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].text, '标准版');
  for (const text of [
    '',
    'Aethersailor Name,id.ini',
    'Aethersailor Name,id.ini,javascript:bad',
    `${valid}\n${valid}`,
  ])
    assert.throws(() => parseAethersailorCatalog(text));
});
test('presets appear only for Extended Clash and ClashR and can be disabled', () => {
  for (const target of ['clash', 'clashr']) assert.equal(templatesFor([], 'extended', target).length, 8);
  for (const target of ['stash', 'surge', 'singbox'])
    assert.equal(templatesFor([], 'extended', target).length, 0);
  assert.equal(templatesFor([], 'standard', 'clash').length, 0);
  assert.equal(templatesFor([], 'extended', 'clash', false).length, 0);
});
test('configured templates keep priority and duplicate URLs are removed per profile', () => {
  const custom = { ...AETHERSAILOR_PRESETS[0], text: 'My version', group: '已有配置', profiles: undefined };
  const result = templatesFor([custom], 'extended', 'clash');
  assert.equal(result.length, 8);
  assert.equal(result[0].text, 'My version');
  assert.equal(templatesFor([custom], 'standard', 'clash').length, 1);
  assert.equal(templateGroups(result)[1].label, 'Aethersailor');
});
test('each preset is passed verbatim in both expanded and remote rule modes', () => {
  for (const template of AETHERSAILOR_PRESETS) {
    for (const expand of ['true', 'false', '']) {
      const result = buildConversion({
        backend: 'https://api.miaoceo.com',
        profile: 'extended',
        target: 'clash',
        sources: 'ss://YWVzLTEyOC1nY206dGVzdA@192.0.2.1:443#Smoke',
        config: template.value,
        options: { expand },
      });
      const url = new URL(result.url);
      assert.equal(url.searchParams.get('config'), template.value);
      assert.equal(url.searchParams.get('expand'), expand || null);
      assert.equal(url.searchParams.has('list'), false);
    }
  }
});
