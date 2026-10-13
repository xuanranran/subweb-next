import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createLiquidGlassDirective, supportsLiquidGlass } from '../src/lib/liquid-glass.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture() {
  const view = new Window({ url: 'https://panel.example/' });
  Object.defineProperty(view, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(view.navigator, 'gpu', { value: { requestAdapter() {} }, configurable: true });
  Object.defineProperty(view, 'IntersectionObserver', { value: undefined, configurable: true });
  const queries = new Map();
  view.matchMedia = (query) => {
    if (!queries.has(query)) {
      const media = new view.EventTarget();
      media.matches = false;
      queries.set(query, media);
    }
    return queries.get(query);
  };
  const root = view.document.createElement('div');
  root.innerHTML =
    '<div data-glass-content aria-hidden="true"></div>' +
    '<section data-glass-surface style="border-radius:28px"><input value="unchanged"></section>';
  view.document.body.append(root);
  const scenes = [];
  const directive = createLiquidGlassDirective(async () => ({
    createGlassScene(element, options) {
      const scene = {
        disposed: 0,
        removed: 0,
        options,
        setContent(content) {
          scene.content = content;
        },
        addSurface(surface, settings) {
          scene.surface = surface;
          scene.settings = settings;
          return () => scene.removed++;
        },
        dispose() {
          scene.disposed++;
        },
      };
      scenes.push(scene);
      return scene;
    },
  }));
  return { view, root, queries, scenes, directive };
}

test('glass rendering requires a secure origin, WebGPU and unrestricted transparency', () => {
  const { view, queries } = fixture();
  assert.equal(supportsLiquidGlass(view), true);
  Object.defineProperty(view, 'isSecureContext', { value: false });
  assert.equal(supportsLiquidGlass(view), false, 'LAN HTTP stays usable with CSS');
  Object.defineProperty(view, 'isSecureContext', { value: true });
  queries.get('(forced-colors: active)').matches = true;
  assert.equal(supportsLiquidGlass(view), false);
  queries.get('(forced-colors: active)').matches = false;
  queries.get('(prefers-reduced-transparency: reduce)').matches = true;
  assert.equal(supportsLiquidGlass(view), false);
  assert.equal(supportsLiquidGlass({ isSecureContext: true, navigator: {} }), false);
});

test('ready glass switches material with the theme and releases every scene without replacing controls', async () => {
  const { root, scenes, directive } = fixture();
  const input = root.querySelector('input');
  directive.mounted(root, { value: 'light' });
  await settle();
  assert.equal(root.dataset.glassRenderer, 'fallback', 'CSS remains until maps are ready');
  scenes[0].options.onDiagnostic({ surfaces: 1, maps: 0 });
  assert.equal(root.dataset.glassRenderer, 'fallback');
  scenes[0].options.onDiagnostic({ surfaces: 1, maps: 1 });
  assert.equal(root.dataset.glassRenderer, 'gpu');
  directive.updated(root, { value: 'dark' });
  await settle();
  assert.equal(scenes[0].disposed, 1);
  assert.equal(scenes[0].removed, 1);
  assert.equal(scenes[1].settings.appearance, 'dark');
  assert.equal(scenes[1].settings.interactive, false);
  assert.equal(root.querySelector('input'), input);
  assert.equal(input.value, 'unchanged');
  directive.updated(root, { value: 'dark' });
  await settle();
  assert.equal(scenes.length, 2, 'ordinary form updates do not rebuild GPU maps');
  directive.beforeUnmount(root);
  assert.equal(scenes[1].disposed, 1);
});

test('renderer diagnostics restore CSS and late diagnostics cannot revive a disposed scene', async () => {
  const { root, scenes, directive } = fixture();
  directive.mounted(root, { value: 'light' });
  await settle();
  scenes[0].options.onDiagnostic({ surfaces: 1, maps: 0, error: new Error('no adapter') });
  await settle();
  assert.equal(root.dataset.glassRenderer, 'fallback');
  assert.equal(scenes[0].disposed, 1);
  scenes[0].options.onDiagnostic({ surfaces: 1, maps: 1 });
  assert.equal(root.dataset.glassRenderer, 'fallback');
  directive.beforeUnmount(root);
  assert.equal(scenes[0].disposed, 1);
});

test('unmount during lazy import cannot create an orphan scene', async () => {
  const { root } = fixture();
  let resolve;
  let created = 0;
  const directive = createLiquidGlassDirective(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  directive.mounted(root, { value: 'light' });
  directive.beforeUnmount(root);
  resolve({
    createGlassScene() {
      created++;
    },
  });
  await settle();
  assert.equal(created, 0);
  assert.equal(root.dataset.glassRenderer, 'fallback');
});

test('offscreen glass sleeps and accessibility preferences turn the renderer off immediately', async () => {
  const { view, root, queries, scenes, directive } = fixture();
  let observed;
  let disconnected = 0;
  Object.defineProperty(view, 'IntersectionObserver', {
    value: class {
      constructor(callback) {
        observed = callback;
      }
      observe() {}
      disconnect() {
        disconnected++;
      }
    },
  });
  directive.mounted(root, { value: 'light' });
  await settle();
  assert.equal(scenes.length, 0);
  observed([{ isIntersecting: true }]);
  await settle();
  assert.equal(scenes.length, 1);
  observed([{ isIntersecting: false }]);
  assert.equal(scenes[0].disposed, 1);
  observed([{ isIntersecting: true }]);
  await settle();
  const media = queries.get('(prefers-reduced-transparency: reduce)');
  media.matches = true;
  media.dispatchEvent(new view.Event('change'));
  await settle();
  assert.equal(scenes[1].disposed, 1);
  assert.equal(root.dataset.glassRenderer, 'fallback');
  media.matches = false;
  media.dispatchEvent(new view.Event('change'));
  await settle();
  assert.equal(scenes.length, 3);
  directive.beforeUnmount(root);
  assert.equal(disconnected, 1);
  media.dispatchEvent(new view.Event('change'));
  await settle();
  assert.equal(scenes.length, 3);
});
