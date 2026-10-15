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
  const window = new Window({ url: 'http://192.168.2.190:25500/' });
  const themeListeners = new Set();
  const systemTheme = { matches: false,
    addEventListener(type, listener) { if (type === 'change') themeListeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'change') themeListeners.delete(listener); },
  };
  const originalMatchMedia = window.matchMedia.bind(window);
  t.mock.method(window, 'matchMedia', (query) => query === '(prefers-color-scheme: dark)' ? systemTheme : originalMatchMedia(query));
  const changeSystemTheme = (matches) => {
    systemTheme.matches = matches;
    for (const listener of themeListeners) listener({ matches });
  };
  // Old versions wrote the resolved color on every visit; that must not override the new auto default.
  window.localStorage.setItem('subweb-theme', 'dark');
  const earlyTheme = await readFile(path.join(testRoot, '../public/theme-init.js'), 'utf8');
  window.eval(earlyTheme);
  assert.equal(window.document.documentElement.dataset.theme, 'light');
  for (const key of [
    'window',
    'document',
    'Document',
    'ShadowRoot',
    'navigator',
    'HTMLElement',
    'SVGElement',
    'Element',
    'Node',
    'Event',
    'MutationObserver',
    'DOMRect',
    'Range',
  ])
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === 'window' ? window : window[key],
    });
  for (const key of ['requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle'])
    Object.defineProperty(globalThis, key, { configurable: true, value: window[key].bind(window) });
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
  let pendingValidation;
  let localVersion = null;
  let pendingLocalVersion;
  let deferLocalVersion = false;
  let deferCustomVersion = false;
  let pendingCustomVersion;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url) === window.location.origin + '/version') {
      if (deferLocalVersion)
        return new Promise((resolve) => {
          pendingLocalVersion = resolve;
        });
      return new Response(localVersion || '<html><body>Subweb Next</body></html>');
    }
    if (String(url) === 'https://custom.example.com/version') {
      if (deferCustomVersion)
        return new Promise((resolve) => {
          pendingCustomVersion = resolve;
        });
      return new Response('SubConverter-Extended v1.9.14');
    }
    if (String(url).endsWith('/version')) return new Response('SubConverter v0.9.0');
    if (String(url).endsWith('/short'))
      return new Promise((resolve) => {
        pendingShort = resolve;
      });
    if (String(url).endsWith('/validate'))
      return new Promise((resolve) => { pendingValidation = resolve; });
    if (String(url).includes('explain=true')) return Response.json({ ok: true, target: 'clash' });
    return new Response('proxies:\n - name: synthetic');
  });
  let app;
  try {
    for (const [relative, filename] of [
      ['src/App.vue', 'App.mjs'],
      ['src/components/OptionField.vue', 'OptionField.mjs'],
      ['src/components/CodeEditor.vue', 'CodeEditor.mjs'],
      ['src/components/ConfigDialog.vue', 'ConfigDialog.mjs'],
    ]) {
      const source = await readFile(path.join(testRoot, '..', relative), 'utf8');
      const { descriptor } = parse(source);
      const compiled = compileScript(descriptor, { id: filename, inlineTemplate: true })
        .content.replaceAll('./components/OptionField.vue', './OptionField.mjs')
        .replaceAll('./components/CodeEditor.vue', './CodeEditor.mjs')
        .replaceAll('./components/ConfigDialog.vue', './ConfigDialog.mjs')
        .replaceAll('../lib/code-editor.js', '../../src/lib/code-editor.js')
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
    assert.equal(requests.length, 3, 'only version requests happen automatically');
    assert.equal(root.querySelector('#theme-mode').value, 'auto');
    assert.equal(window.document.documentElement.dataset.theme, 'light');
    changeSystemTheme(true);
    await settle();
    assert.equal(window.document.documentElement.dataset.theme, 'dark', 'auto mode reacts to browser color changes');
    await setInput('#theme-mode', 'light');
    assert.equal(window.localStorage.getItem('subweb-theme-mode'), 'light');
    changeSystemTheme(false);
    changeSystemTheme(true);
    await settle();
    assert.equal(window.document.documentElement.dataset.theme, 'light', 'manual light mode ignores system changes');
    await setInput('#theme-mode', 'auto');
    assert.equal(window.document.documentElement.dataset.theme, 'dark', 'returning to auto uses the current browser preference');
    await setInput('#theme-mode', 'dark');
    changeSystemTheme(false);
    await settle();
    assert.equal(window.document.documentElement.dataset.theme, 'dark', 'manual dark mode ignores system changes');
    await setInput('#theme-mode', 'light');
    changeSystemTheme(true);
    await settle();
    await setInput('#sources', 'https://example.com/sub?a=1&token=a+b');
    assert.equal(requests.length, 3, 'editing subscriptions stays local');
    assert.equal(
      new URL(root.querySelector('#result-link').value).searchParams.get('url'),
      'https://example.com/sub?a=1&token=a+b',
    );
    button('复制转换链接').click();
    await settle();
    assert.equal(new URL(copied.at(-1)).searchParams.get('target'), 'clash');

    assert.equal(root.querySelectorAll('#config optgroup option').length, 8);
    const aethersailor = [...root.querySelectorAll('#config optgroup')].find(
      (group) => group.label === 'Aethersailor',
    );
    assert.equal(aethersailor.querySelectorAll('option').length, 8);
    assert.equal(root.querySelector('#config').textContent.includes('eHpo1'), false);
    const ruleTemplate = [...aethersailor.querySelectorAll('option')].find((option) =>
      option.value.endsWith('/Custom_Clash_GFW.ini'),
    ).value;
    await setInput('#config', ruleTemplate);
    await setInput('#rule-expansion', 'true');
    assert.equal(new URL(root.querySelector('#result-link').value).searchParams.get('config'), ruleTemplate);
    assert.equal(new URL(root.querySelector('#result-link').value).searchParams.get('expand'), 'true');
    await setInput('#rule-expansion', 'false');
    assert.equal(new URL(root.querySelector('#result-link').value).searchParams.get('expand'), 'false');
    assert.equal(requests.length, 3, 'template selection and expansion stay local');

    await setInput('#target', 'stash');
    assert.equal(root.querySelector('#config').value, '');
    assert.equal(root.querySelectorAll('#config optgroup').length, 0);
    assert.equal(root.querySelector('#rule-expansion'), null);
    engine('subconverter').click();
    await settle();
    assert.equal(root.querySelector('#target').value, 'clash');
    assert.equal(root.querySelectorAll('#target option').length, 16);
    assert.equal(root.querySelectorAll('#config optgroup').length, 0);
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
    const previewTrigger = button('预览配置');
    previewTrigger.focus();
    previewTrigger.click();
    await settle();
    assert.equal(requests.at(-1).options.headers['X-Key'], 'secret-value');
    assert.ok(root.querySelector('.code-editor'));
    const dialog = root.querySelector('dialog[open][aria-modal="true"]');
    assert.ok(dialog, 'configuration opens in a native modal dialog');
    assert.equal(window.document.body.style.overflow, 'hidden');
    assert.match(root.querySelector('.editor-fallback')?.value || root.querySelector('.cm-content')?.textContent || '', /synthetic/);
    const clipboardWrite = window.navigator.clipboard.writeText;
    const execCommand = window.document.execCommand;
    let modalCopy = false;
    try {
      window.navigator.clipboard.writeText = async () => { throw new Error('HTTP clipboard unavailable'); };
      window.document.execCommand = (command) => {
        assert.equal(command, 'copy');
        assert.equal(window.document.activeElement.parentElement, dialog);
        assert.equal(window.document.activeElement.value, 'proxies:\n - name: synthetic');
        modalCopy = true;
        return true;
      };
      const copyConfig = button('复制配置');
      copyConfig.focus();
      copyConfig.click();
      await settle();
      assert.ok(modalCopy, 'HTTP LAN clipboard fallback stays inside the modal');
      assert.equal(dialog.querySelector(':scope > textarea'), null);
      assert.equal(window.document.activeElement, copyConfig);
    } finally {
      window.navigator.clipboard.writeText = clipboardWrite;
      window.document.execCommand = execCommand;
    }
    const bounds = t.mock.method(dialog, 'getBoundingClientRect', () => ({ left: 100, top: 100, right: 700, bottom: 500, width: 600, height: 400 }));
    const heading = dialog.querySelector('.dialog-heading');
    const pointer = (target, type, x, y) => target.dispatchEvent(new window.PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, isPrimary: true, button: 0, clientX: x, clientY: y,
    }));
    pointer(heading, 'pointerdown', 150, 120);
    pointer(window, 'pointermove', 250, 180);
    await settle();
    assert.equal(dialog.style.left, '200px');
    assert.equal(dialog.style.top, '160px');
    pointer(window, 'pointermove', 10000, 10000);
    await settle();
    assert.equal(dialog.style.left, `${window.innerWidth - 600 - 8}px`, 'dragging keeps the full window inside the viewport');
    assert.equal(dialog.style.top, `${window.innerHeight - 400 - 8}px`);
    pointer(window, 'pointerup', 10000, 10000);
    const stopped = dialog.style.left;
    pointer(window, 'pointermove', 0, 0);
    await settle();
    assert.equal(dialog.style.left, stopped, 'pointer release stops movement');
    pointer(button('最大化'), 'pointerdown', 50, 50);
    pointer(window, 'pointermove', 0, 0);
    await settle();
    assert.equal(dialog.style.left, stopped, 'window controls do not initiate a drag');
    button('最大化').click();
    await settle();
    assert.ok(dialog.classList.contains('maximized'));
    assert.equal(dialog.style.left, '', 'maximizing clears the manual position');
    pointer(heading, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 200, 200);
    await settle();
    assert.equal(dialog.style.left, '', 'maximized windows cannot be dragged');
    dialog.dispatchEvent(new window.Event('cancel', { cancelable: true }));
    await settle();
    assert.ok(!dialog.classList.contains('maximized'), 'Escape restores a maximized dialog first');
    assert.equal(dialog.style.left, stopped, 'restoring preserves the previous dragged position');
    const windowSize = { width: window.innerWidth, height: window.innerHeight };
    window.happyDOM.setWindowSize({ width: 480, height: 720 });
    window.dispatchEvent(new window.Event('resize'));
    await settle();
    assert.equal(dialog.style.left, '', 'mobile sizing resets the desktop drag position');
    pointer(heading, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 200, 200);
    await settle();
    assert.equal(dialog.style.left, '', 'mobile full-screen windows cannot be dragged');
    window.happyDOM.setWindowSize(windowSize);
    window.dispatchEvent(new window.Event('resize'));
    bounds.mock.restore();
    dialog.dispatchEvent(new window.Event('cancel', { cancelable: true }));
    await settle();
    assert.equal(root.querySelector('dialog'), null);
    assert.equal(window.document.body.style.overflow, '');
    assert.equal(window.document.activeElement, previewTrigger, 'closing returns keyboard focus to the triggering control');
    const previewRequests = requests.length;
    previewTrigger.click();
    await settle();
    assert.ok(root.querySelector('dialog[open]'));
    assert.equal(requests.length, previewRequests, 'reopening preserves cached config without another request');
    root.querySelector('.dialog-close').click();
    await settle();
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
    engine('本地后端').click();
    await settle();
    assert.equal(new URL(root.querySelector('#result-link').value).origin, 'http://192.168.2.190:25500');
    assert.equal(root.querySelectorAll('#target option').length, 16);
    localVersion = 'SubConverter-Extended v1.9.14';
    button('读取在线版本').click();
    await settle();
    assert.equal(root.querySelectorAll('#target option').length, 22);
    localVersion = 'subconverter v0.9.0';
    button('读取在线版本').click();
    await settle();
    assert.equal(root.querySelectorAll('#target option').length, 16);
    assert.equal(root.querySelector('#local-profile'), null);
    assert.equal(root.querySelector('.custom-backend select'), null);
    await setInput('#custom-endpoint', 'https://custom.example.com');
    button('使用并读取版本').click();
    await settle();
    assert.equal(root.querySelectorAll('#target option').length, 22);
    await setInput('#target', 'clash');
    assert.equal(root.querySelectorAll('#config optgroup option').length, 8);
    assert.equal(new URL(root.querySelector('#result-link').value).origin, 'https://custom.example.com');
    await setInput('#custom-endpoint', 'http://127.0.0.1:25500');
    assert.equal(
      root.querySelectorAll('#target option').length,
      16,
      'new address resets old detected capabilities',
    );
    assert.equal(root.querySelectorAll('#config optgroup').length, 0);
    button('使用并读取版本').click();
    await settle();
    assert.equal(new URL(root.querySelector('#result-link').value).origin, 'http://127.0.0.1:25500');
    deferCustomVersion = true;
    await setInput('#custom-endpoint', 'https://custom.example.com');
    button('使用并读取版本').click();
    await settle();
    await setInput('#custom-endpoint', 'http://127.0.0.1:25500');
    pendingCustomVersion(new Response('SubConverter-Extended v1.9.14'));
    await settle();
    assert.equal(root.querySelectorAll('#target option').length, 16, 'stale version response is ignored');
    app.unmount();

    // With a real /version response, an untouched page defaults to the current backend.
    localVersion = 'SubConverter-Extended v1.9.14';
    const autoRoot = window.document.createElement('div');
    window.document.body.append(autoRoot);
    app = createApp(Panel);
    app.mount(autoRoot);
    await settle();
    assert.equal(autoRoot.querySelector('#theme-mode').value, 'light', 'explicit theme selection survives remounting');
    assert.equal(window.document.documentElement.dataset.theme, 'light');
    const autoTheme = autoRoot.querySelector('#theme-mode');
    autoTheme.value = 'auto';
    autoTheme.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();
    assert.equal(window.document.documentElement.dataset.theme, 'dark');
    assert.ok(autoRoot.querySelector('.engine-card.local.selected'));
    assert.equal(autoRoot.querySelectorAll('#target option').length, 22);
    assert.equal(autoRoot.querySelector('#local-profile'), null);
    app.unmount();

    // A late version response cannot override a backend the user already chose.
    deferLocalVersion = true;
    const manualRoot = window.document.createElement('div');
    window.document.body.append(manualRoot);
    app = createApp(Panel);
    app.mount(manualRoot);
    await settle();
    [...manualRoot.querySelectorAll('.engine-card')]
      .find((card) => card.querySelector('strong').textContent === 'subconverter')
      .click();
    await settle();
    pendingLocalVersion(new Response('SubConverter-Extended v1.9.14'));
    await settle();
    assert.equal(manualRoot.querySelector('.engine-card.local.selected'), null);
    assert.equal(manualRoot.querySelectorAll('#target option').length, 16);
    app.unmount();

    // Domain-hosted panels must neither display nor probe a third, same-origin backend.
    deferLocalVersion = false;
    localVersion = 'subconverter v0.9.0';
    window.happyDOM.setURL('https://sub.miaoceo.com/');
    requests.length = 0;
    const domainRoot = window.document.createElement('div');
    window.document.body.append(domainRoot);
    app = createApp(Panel);
    app.mount(domainRoot);
    await settle();
    assert.equal(domainRoot.querySelector('.engine-card.local'), null);
    assert.equal(domainRoot.querySelector('.engine-grid.has-local'), null);
    assert.equal(domainRoot.querySelectorAll('.engine-card').length, 2);
    assert.equal(requests.length, 2, 'only the configured public backends are checked');
    assert.ok(domainRoot.querySelector('.engine-card.selected strong').textContent.includes('Extended'));
    const mobileSelector = domainRoot.querySelector('#mobile-backend');
    assert.equal(mobileSelector.options.length, 2, 'mobile also hides the local backend on domains');
    mobileSelector.value = '1';
    mobileSelector.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();
    assert.equal(domainRoot.querySelectorAll('#target option').length, 16);
    assert.equal(domainRoot.querySelector('.mobile-engine-address code').textContent, 'sub.miaoceo.com');
    assert.equal(domainRoot.querySelector('.engine-card.selected strong').textContent, 'subconverter');
    mobileSelector.value = '0';
    mobileSelector.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();
    assert.equal(domainRoot.querySelectorAll('#target option').length, 22);
    assert.equal(domainRoot.querySelector('.mobile-engine-address code').textContent, 'api.miaoceo.com');
    assert.equal(requests.length, 2, 'changing the mobile selection does not send subscription requests');
    // Kernel validation is explicit, sends the exact preview and discards obsolete reports.
    const domainButton = (text) => [...domainRoot.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
    const domainInput = async (selector, value) => {
      const input = domainRoot.querySelector(selector);
      input.value = value;
      input.dispatchEvent(new window.Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      await settle();
    };
    await domainInput('#sources', 'https://example.com/sub');
    domainButton('内核校验').click();
    await settle();
    assert.equal(requests.length, 2, 'no config is sent until a service is configured');
    assert.match(domainRoot.textContent, /请先填写内核校验服务地址/);
    await domainInput('#validator-url', 'https://validator.example');
    await domainInput('#validator-token', 'validation-secret');
    domainButton('预览配置').click();
    await settle();
    const before = requests.length;
    domainButton('校验当前内容').click();
    await settle();
    assert.equal(requests.length, before + 1, 'existing preview is reused without re-conversion');
    assert.deepEqual(JSON.parse(requests.at(-1).options.body), { config: 'proxies:\n - name: synthetic' });
    assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer validation-secret');
    const nativeReport = { engine: 'mihomo', mode: 'config-test', version: 'Mihomo test', valid: false, output: 'invalid action',
      diagnostics: [{ line: 2, column: 3, message: 'invalid action', source: 'mihomo' }] };
    pendingValidation(Response.json(nativeReport));
    await settle();
    assert.match(domainRoot.querySelector('.validation-report.failed').textContent, /invalid action/);
    // Real CodeMirror, edited-config validation and cache restoration all stay on the client until requested.
    for (let attempt = 0; attempt < 50 && !domainRoot.querySelector('.cm-editor'); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await settle();
    }
    assert.ok(domainRoot.querySelector('.cm-editor'), 'CodeMirror is loaded, not only the textarea fallback');
    const { EditorView } = await import('@codemirror/view');
    const { diagnosticCount } = await import('@codemirror/lint');
    let codeView = EditorView.findFromDOM(domainRoot.querySelector('.cm-editor'));
    assert.equal(diagnosticCount(codeView.state), 1);
    domainButton('查看日志').click();
    await settle();
    assert.match(domainRoot.querySelector('.dialog-kernel-log').textContent, /invalid action/);
    domainRoot.querySelector('.dialog-close').click();
    await settle();
    assert.equal(domainRoot.querySelector('dialog'), null);
    assert.ok(domainRoot.querySelector('.validation-report'), 'closing the window preserves the matching validation report');
    domainRoot.querySelector('.validation-report .diagnostic-location').click();
    await settle();
    assert.ok(domainRoot.querySelector('dialog[open]'), 'an error location reopens the editor window');
    codeView = EditorView.findFromDOM(domainRoot.querySelector('.cm-editor'));
    assert.equal(codeView.state.selection.main.head, codeView.state.doc.line(2).from + 2);
    const editedConfig = 'proxies: []\nrules: ["MATCH,DIRECT"]\n';
    codeView.dispatch({ changes: { from: 0, to: codeView.state.doc.length, insert: editedConfig } });
    await settle();
    assert.equal(domainRoot.querySelector('.validation-report'), null, 'editing invalidates an existing kernel report');
    assert.equal(diagnosticCount(codeView.state), 0, 'editing clears obsolete source diagnostics');
    const beforeReopen = requests.length;
    domainRoot.querySelector('.dialog-close').click();
    await settle();
    domainButton('预览配置').click();
    await settle();
    codeView = EditorView.findFromDOM(domainRoot.querySelector('.cm-editor'));
    assert.equal(codeView.state.doc.toString(), editedConfig, 'closing and reopening does not discard local edits');
    assert.equal(requests.length, beforeReopen);
    domainButton('校验当前内容').click();
    await settle();
    assert.equal(JSON.parse(requests.at(-1).options.body).config, editedConfig, 'the edited YAML reaches the kernel service');
    pendingValidation(Response.json({ ...nativeReport, valid: true, output: 'test successful', diagnostics: [] }));
    await settle();
    domainButton('保存到记录').click();
    await settle();
    const beforeRestore = requests.length;
    await domainInput('#sources', 'https://example.com/another-source');
    const latestRestore = domainRoot.querySelector('.history-list button');
    latestRestore.click();
    for (let i = 0; i < 4; i++) await settle();
    assert.equal(requests.length, beforeRestore, 'restoring local history sends no subscription or config to a server');
    assert.equal(domainRoot.querySelector('#sources').value, 'https://example.com/sub');
    assert.equal(domainRoot.querySelector('.editor-fallback')?.value || EditorView.findFromDOM(domainRoot.querySelector('.cm-editor')).state.doc.toString(), editedConfig);
    assert.doesNotMatch(window.localStorage.getItem('subweb-next-conversions-v1'), /validation-secret|secret-value/);
    await domainInput('#sources', 'https://example.com/new');
    assert.equal(domainRoot.querySelector('.validation-report'), null);
    domainButton('内核校验').click();
    await settle();
    const signal = requests.at(-1).options.signal;
    await domainInput('#validator-url', 'https://other-validator.example');
    assert.equal(signal.aborted, true);
    pendingValidation(Response.json({ ...nativeReport, valid: true }));
    await settle();
    assert.equal(domainRoot.querySelector('.validation-report'), null, 'old service report never becomes current');
    assert.equal(domainRoot.querySelector('[role="alert"]'), null, 'cancelled request does not show a stale error');
    await domainInput('#target', 'singbox');
    assert.equal(domainButton('内核校验'), undefined);
    assert.equal(domainRoot.querySelector('#validator-token'), null);
  } finally {
    if (app) app.unmount();
    assert.equal(themeListeners.size, 0, 'system theme listeners are removed on unmount');
    await window.happyDOM.close();
    assert.equal(path.dirname(path.resolve(scratch)), path.resolve(testRoot));
    assert.ok(path.basename(scratch).startsWith('.ui-'));
    await rm(scratch, { recursive: true, force: true });
  }
});
