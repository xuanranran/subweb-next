import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversionHistory, HISTORY_KEY, HISTORY_LIMIT } from '../src/lib/conversion-history.js';

function fixture() {
  const data = new Map([['unrelated-key', 'keep']]);
  return { data, storage: {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  } };
}
const state = {
  backend: 'https://api.example', profile: 'extended', target: 'clash',
  sources: 'https://airport.example/sub?token=source-token', config: '', ver: '',
  options: { expand: 'false' }, headerValues: '{"X-Key":"header-secret"}',
};

test('local history restores parameters and config, excludes credential fields and never changes other storage', () => {
  const { data, storage } = fixture();
  const store = createConversionHistory(() => storage);
  const saved = store.save({ state, action: 'save', configText: 'rules: [MATCH,DIRECT]', edited: true, validatorToken: 'validator-secret' });
  assert.equal(saved.items.length, 1);
  const persisted = data.get(HISTORY_KEY);
  assert.doesNotMatch(persisted, /header-secret|validator-secret|headerValues/);
  const record = createConversionHistory(() => storage).list().items[0];
  assert.equal(record.state.sources, state.sources);
  assert.equal(record.state.hasHeaders, true);
  assert.equal(record.configText, 'rules: [MATCH,DIRECT]');
  assert.equal(record.edited, true);
  store.clear();
  assert.equal(data.has(HISTORY_KEY), false);
  assert.equal(data.get('unrelated-key'), 'keep');
});

test('history deduplicates parameters, preserves saved config on link copy and caps records', () => {
  const { storage } = fixture();
  const store = createConversionHistory(() => storage);
  store.save({ state, action: 'preview', configText: 'dns: {}' });
  assert.equal(store.save({ state, action: 'copy' }).items[0].configText, 'dns: {}');
  for (let i = 0; i < 30; i++) store.save({ state: { ...state, sources: `https://example.com/${i}` }, action: 'copy' });
  const records = store.list().items;
  assert.equal(records.length, HISTORY_LIMIT);
  assert.equal(records[0].state.sources, 'https://example.com/29');
  assert.equal(store.remove(records[0].id).items.length, HISTORY_LIMIT - 1);
});

test('large config snapshots keep parameters; denied storage and corrupted entries do not break conversions', () => {
  const { storage, data } = fixture();
  const store = createConversionHistory(() => storage);
  const saved = store.save({ state, action: 'preview', configText: 'x'.repeat(300000) }).items[0];
  assert.equal(saved.contentOmitted, true);
  assert.equal(saved.configText, '');
  data.set(HISTORY_KEY, '[{"state":{"profile":"unknown"}}]');
  assert.deepEqual(createConversionHistory(() => storage).list().items, []);
  data.set(HISTORY_KEY, 'broken JSON');
  assert.ok(createConversionHistory(() => storage).list().error);
  const unavailable = createConversionHistory(() => { throw new Error('denied'); });
  assert.equal(unavailable.save({ state, action: 'copy' }).items.length, 1);
  assert.ok(unavailable.list().error);
});
