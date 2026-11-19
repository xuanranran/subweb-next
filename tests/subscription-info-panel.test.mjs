import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Window } from 'happy-dom';
import { parse, compileScript } from '@vue/compiler-sfc';

test('subscription panel debounces, caches, labels results, clears stale responses and cancels on disable or unmount', async (t) => {
  const rootPath = path.dirname(fileURLToPath(import.meta.url));
  const scratch = await mkdtemp(path.join(rootPath, '.ui-'));
  const window = new Window({ url: 'https://panel.example/' });
  for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node'])
    Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
  const calls = [];
  let pending;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('slow')) return new Promise((resolve) => { pending = resolve; });
    return new Response('ss://YWJj@example.com:443#' + encodeURIComponent('过期时间：2026-12-30 21:22:42'), {
      headers: { 'Subscription-UserInfo': 'upload=12; download=20; total=100' },
    });
  });
  let app;
  try {
    for (const component of ['SubscriptionInfo', 'FloatingPanel']) {
      const { descriptor } = parse(await readFile(path.join(rootPath, `../src/components/${component}.vue`), 'utf8'));
      const compiled = compileScript(descriptor, { id: component, inlineTemplate: true }).content
        .replaceAll('../lib/subscription-info.js', '../../src/lib/subscription-info.js')
        .replaceAll('./FloatingPanel.vue', './FloatingPanel.mjs');
      await writeFile(path.join(scratch, `${component}.mjs`), compiled);
    }
    const { default: Panel } = await import(pathToFileURL(path.join(scratch, 'SubscriptionInfo.mjs')).href);
    const { createApp, reactive, nextTick } = await import('vue');
    const props = reactive({ sources: '', backend: 'https://converter.example' });
    const root = window.document.createElement('div');
    window.document.body.append(root);
    // Passing reactive props through a wrapper keeps real parent-to-child update semantics.
    const { h } = await import('vue');
    app = createApp({ setup: () => () => h(Panel, props) });
    app.mount(root);
    const settle = async () => { await new Promise(setImmediate); await nextTick(); };
    const debounce = async () => { await new Promise((resolve) => setTimeout(resolve, 950)); await settle(); };
    props.sources = 'https://source.example/a';
    await settle();
    props.sources = 'provider:TAG,interval:21600,https://source.example/b';
    await settle();
    assert.equal(calls.length, 0, 'typing does not send every intermediate URL');
    await debounce();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://source.example/b');
    const trigger = root.querySelector('.floating-trigger');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(root.querySelector('.subscription-info'), null);
    trigger.click();
    await settle();
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.match(root.textContent, /TAG/);
    assert.match(root.textContent, /2026-12-30 21:22:42/);
    assert.match(root.textContent, /节点名称/);
    const card = root.querySelector('.subscription-card');
    assert.equal(card.style.getPropertyValue('--quota-fill'), '68%');
    assert.match(card.textContent, /剩余 68%/);
    assert.match(card.textContent, /32 B \/ 100 B/);
    assert.equal(root.textContent.includes('source.example/b'), false, 'token-bearing URL is not displayed');
    const closeButton = root.querySelector('.floating-close');
    closeButton.focus();
    closeButton.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    assert.equal(root.querySelector('.subscription-info'), null);
    assert.equal(window.document.activeElement, trigger);
    trigger.click();
    await settle();
    window.document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    await settle();
    assert.equal(root.querySelector('.subscription-info'), null);
    trigger.click();
    await settle();
    assert.match(root.textContent, /2026-12-30 21:22:42/);
    assert.equal(calls.length, 1, 'reopening displays the result without a second lookup');
    props.sources = 'https://source.example/slow';
    await settle();
    assert.equal(root.querySelectorAll('li').length, 0, 'input changes clear old results immediately');
    await debounce();
    const oldSignal = calls.at(-1).options.signal;
    props.sources = 'https://source.example/new';
    await settle();
    assert.equal(oldSignal.aborted, true);
    pending(new Response('', { headers: { 'Subscription-UserInfo': 'expire=1893456000' } }));
    await settle();
    assert.equal(root.querySelectorAll('li').length, 0, 'a late result cannot appear against new input');
    const checkbox = root.querySelector('input[type=checkbox]');
    checkbox.checked = false;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();
    const count = calls.length;
    await debounce();
    assert.equal(calls.length, count, 'disabling cancels a scheduled query');
    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    props.sources = 'https://source.example/b';
    await settle();
    await debounce();
    assert.equal(calls.length, count, 'a recent result is reused only within this page');
    root.querySelector('.subscription-refresh').click();
    await settle();
    assert.equal(calls.length, count + 1, 'refresh bypasses the memory cache');
    props.sources = 'https://source.example/slow';
    await settle();
    await debounce();
    const unmountSignal = calls.at(-1).options.signal;
    app.unmount(); app = null;
    assert.equal(unmountSignal.aborted, true);
    pending(new Response(''));
    await settle();
    assert.equal(window.localStorage.length, 0, 'expiry data and URLs never enter browser storage');
  } finally {
    app?.unmount();
    await window.happyDOM.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
