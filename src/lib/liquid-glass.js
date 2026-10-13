// The DOM entry preserves Vue's native controls; the React entry is not bundled.
const states = new WeakMap();
const accessibilityQueries = ['(prefers-reduced-transparency: reduce)', '(forced-colors: active)'];

export function supportsLiquidGlass(view = globalThis.window) {
  return (
    !!view?.isSecureContext &&
    typeof view.navigator?.gpu?.requestAdapter === 'function' &&
    !accessibilityQueries.some((query) => view.matchMedia?.(query).matches)
  );
}

function stop(state) {
  state.generation++;
  state.remove?.();
  state.remove = null;
  state.scene?.dispose();
  state.scene = null;
  state.root.dataset.glassRenderer = 'fallback';
}

async function start(state) {
  if (!state.visible || state.disposed || !supportsLiquidGlass(state.view)) return;
  const generation = ++state.generation;
  try {
    const { createGlassScene } = await state.loadScene();
    if (generation !== state.generation || state.disposed) return;
    const content = state.root.querySelector('[data-glass-content]');
    const surfaces = [...state.root.querySelectorAll('[data-glass-surface]')];
    if (!content || !surfaces.length) return;
    state.scene = createGlassScene(state.root, {
      maxSurfaces: 8,
      onDiagnostic({ error, surfaces: count, maps }) {
        if (generation !== state.generation || state.disposed) return;
        if (error) {
          // Dispose after the library has finished its diagnostic callback.
          queueMicrotask(() => {
            if (generation === state.generation) stop(state);
          });
        } else if (count > 0 && maps === count) {
          state.root.dataset.glassRenderer = 'gpu';
        }
      },
    });
    state.scene.setContent(content);
    const cleanups = surfaces.map((element) =>
      state.scene.addSurface(element, {
        material: 'regular',
        appearance: state.appearance,
        radius: parseFloat(state.view.getComputedStyle(element).borderTopLeftRadius) || 28,
        refraction: element.classList.contains('engine-card') ? 36 : 24,
        // Keep form controls stationary while typing and using native dropdowns.
        interactive: false,
        motion: 'reduced',
      }),
    );
    state.remove = () => cleanups.forEach((remove) => remove());
  } catch {
    if (generation === state.generation) stop(state);
  }
}

export function createLiquidGlassDirective(loadScene = () => import('@glass-sdk/liquid-glass/dom')) {
  return {
    mounted(root, binding) {
      const view = root.ownerDocument.defaultView;
      const state = {
        root,
        view,
        loadScene,
        appearance: binding.value,
        generation: 0,
        visible: true,
        disposed: false,
      };
      states.set(root, state);
      root.dataset.glassRenderer = 'fallback';
      state.queries = accessibilityQueries.map((query) => view.matchMedia?.(query)).filter(Boolean);
      state.preferenceChanged = () => {
        stop(state);
        void start(state);
      };
      state.queries.forEach((query) => query.addEventListener?.('change', state.preferenceChanged));
      if (supportsLiquidGlass(view) && view.IntersectionObserver) {
        state.visible = false;
        state.observer = new view.IntersectionObserver(
          ([entry]) => {
            if (state.visible === entry.isIntersecting) return;
            state.visible = entry.isIntersecting;
            if (state.visible) void start(state);
            else stop(state);
          },
          { rootMargin: '120px' },
        );
        state.observer.observe(root);
      } else {
        void start(state);
      }
    },
    updated(root, binding) {
      const state = states.get(root);
      if (!state || state.appearance === binding.value) return;
      state.appearance = binding.value;
      stop(state);
      void start(state);
    },
    beforeUnmount(root) {
      const state = states.get(root);
      if (!state) return;
      state.disposed = true;
      state.observer?.disconnect();
      state.queries.forEach((query) => query.removeEventListener?.('change', state.preferenceChanged));
      stop(state);
      states.delete(root);
    },
  };
}

export const vLiquidGlass = createLiquidGlassDirective();
