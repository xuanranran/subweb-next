// Component interaction checks in a DOM environment. This does not replace visual browser QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Window } from 'happy-dom';
import { parse, compileScript } from '@vue/compiler-sfc';

test('the actual Vue panel switches profiles, resets incompatible fields and invalidates async results', async (t) => {
  const testRoot = path.dirname(fileURLToPath(import.meta.url));
  const scratch = await mkdtemp(path.join(testRoot, '.ui-'));
  const window = new Window({ url: 'http://localhost:5173' });
  for (const key of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'SVGElement',
    'Element',
    'Node',
    'Event',
  ])
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === 'window' ? window : window[key],
    });
  window.config = {
    apiUrl: [
      { value: 'https://api.miaoceo.com', text: 'SubConverter-Extended', profile: 'extended' },
      { value: 'https://sub.miaoceo.com', text: 'subconverter', profile: 'standard' },
    ],
    shortUrl: 'https://i.miaoceo.com',
  };
  const copied = [];
  window.navigator.clipboard.writeText = async (text) => {
    copied.push(text);
  };
  let pendingShort;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/version')) return new Response('SubConverter v0.9.0');
    if (String(url).endsWith('/short'))
      return new Promise((resolve) => {
        pendingShort = resolve;
      });
    if (String(url).includes('explain=true')) return Response.json({ ok: true, target: 'clash' });
    return new Response('proxies:\n - name: synthetic');
  });
  let app;
  try {
    for (const [relative, filename] of [
      ['src/App.vue', 'App.mjs'],
      ['src/components/OptionField.vue', 'OptionField.mjs'],
    ]) {
      const source = await readFile(path.join(testRoot, '..', relative), 'utf8');
      const { descriptor } = parse(source);
      const compiled = compileScript(descriptor, { id: filename, inlineTemplate: true })
        .content.replaceAll('./components/OptionField.vue', './OptionField.mjs')
        .replaceAll('./lib/', '../../src/lib/');
      await writeFile(path.join(scratch, filename), compiled);
    }
    const { default: Panel } = await import(pathToFileURL(path.join(scratch, 'App.mjs')).href);
    const { createApp, nextTick } = await import('vue');
    const root = window.document.createElement('div');
    window.document.body.append(root);
    app = createApp(Panel);
    app.mount(root);
    const settle = async () => {
      await new Promise((resolve) => setImmediate(resolve));
      await nextTick();
    };
    const button = (text) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));
    const engine = (text) =>
      [...root.querySelectorAll('.engine-card')].find((b) => b.querySelector('strong').textContent === text);
    const setInput = async (selector, value) => {
      const input = root.querySelector(selector);
      assert.ok(input, selector);
      input.value = value;
      input.dispatchEvent(
        new window.Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }),
      );
      await settle();
    };
    await settle();
    assert.equal(root.querySelectorAll('#target option').length, 22);
    assert.equal(requests.length, 2, 'only version requests happen automatically');
    await setInput('#sources', 'https://example.com/sub?a=1&token=a+b');
    assert.equal(requests.length, 2, 'editing subscriptions stays local');
    assert.equal(
      new URL(root.querySelector('#result-link').value).searchParams.get('url'),
      'https://example.com/sub?a=1&token=a+b',
    );
    button('复制转换链接').click();
    await settle();
    assert.equal(new URL(copied.at(-1)).searchParams.get('target'), 'clash');

    await setInput('#target', 'stash');
    engine('subconverter').click();
    await settle();
    assert.equal(root.querySelector('#target').value, 'clash');
    assert.equal(root.querySelectorAll('#target option').length, 16);
    assert.equal(new URL(root.querySelector('#result-link').value).hostname, 'sub.miaoceo.com');
    button('高级参数').click();
    await settle();
    button('进阶').click();
    await settle();
    assert.ok(root.querySelector('#param-ua'));
    await setInput('#param-ua', 'my-source-agent');
    assert.equal(new URL(root.querySelector('#result-link').value).searchParams.get('ua'), 'my-source-agent');
    engine('SubConverter-Extended').click();
    await settle();
    assert.equal(new URL(root.querySelector('#result-link').value).searchParams.has('ua'), false);
    assert.equal(root.querySelector('#param-ua'), null);
    [...root.querySelectorAll('[role="tab"]')].find((b) => b.textContent === 'Provider').click();
    await settle();
    await setInput('#param-provider_headers', 'X-Key');
    const headerInput = [...root.querySelectorAll('textarea')].find((a) =>
      a.placeholder.includes('X-Subscription-Key'),
    );
    headerInput.value = '{"X-Key":"secret-value"}';
    headerInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    await settle();
    assert.equal(button('复制转换链接').disabled, true);
    assert.equal(button('生成短链').disabled, true);
    button('预览配置').click();
    await settle();
    assert.equal(requests.at(-1).options.headers['X-Key'], 'secret-value');
    assert.match(root.querySelector('.output-panel pre').textContent, /synthetic/);
    button('恢复全部默认参数').click();
    await settle();
    assert.equal(root.querySelector('.output-panel'), null);

    button('转换诊断').click();
    await settle();
    assert.ok(requests.at(-1).url.includes('explain=true'));
    assert.equal(new URL(root.querySelector('#result-link').value).searchParams.has('explain'), false);
    await setInput('#sources', 'https://example.com/sub?token=new');
    assert.equal(root.querySelector('.output-panel'), null);

    button('生成短链').click();
    await settle();
    assert.ok(pendingShort);
    await setInput('#sources', 'https://example.com/sub?token=changed-during-request');
    pendingShort(Response.json({ Code: 1, ShortUrl: 'https://i.miaoceo.com/stale' }));
    await settle();
    assert.equal(root.querySelector('.short-result'), null, 'stale response is discarded');
    button('生成短链').click();
    await settle();
    pendingShort(Response.json({ Code: 1, ShortUrl: 'https://i.miaoceo.com/fresh' }));
    await settle();
    assert.equal(root.querySelector('.short-result input').value, 'https://i.miaoceo.com/fresh');
    await setInput('#target', 'singbox');
    assert.equal(root.querySelector('.short-result'), null);
    assert.equal(root.querySelectorAll('[role="alert"]').length, 0);
  } finally {
    if (app) app.unmount();
    await window.happyDOM.close();
    assert.equal(path.dirname(path.resolve(scratch)), path.resolve(testRoot));
    assert.ok(path.basename(scratch).startsWith('.ui-'));
    await rm(scratch, { recursive: true, force: true });
  }
});
