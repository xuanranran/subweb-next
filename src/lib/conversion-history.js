import { parametersFor, targetsFor } from './backends.js';

export const HISTORY_KEY = 'subweb-next-conversions-v1';
export const HISTORY_LIMIT = 20;
const BYTE_LIMIT = 3 * 1024 * 1024;
const TEXT_LIMIT = 512 * 1024;
const actions = new Set(['copy', 'short', 'preview', 'download', 'validate', 'save']);

// Only conversion parameters are retained. Request-header values and validator credentials never enter storage.
function cleanEntry(value) {
  if (!value || typeof value !== 'object' || !value.state) return null;
  const source = value.state;
  if (!['standard', 'extended'].includes(source.profile) ||
      !targetsFor(source.profile).some((target) => target.value === source.target) ||
      typeof source.sources !== 'string' || !source.sources.trim() || typeof source.backend !== 'string') return null;
  let backend;
  try {
    backend = new URL(source.backend);
    if (!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password || backend.search || backend.hash) return null;
  } catch { return null; }
  const allowed = new Set(parametersFor(source.profile, source.target).map((field) => field.key));
  const options = Object.fromEntries(Object.entries(source.options || {}).filter(([key, val]) =>
    allowed.has(key) && ['string', 'number', 'boolean'].includes(typeof val)).sort(([a], [b]) => a.localeCompare(b)));
  const configText = typeof value.configText === 'string' && value.configText.length * 2 <= TEXT_LIMIT ? value.configText : '';
  return {
    id: typeof value.id === 'string' ? value.id.slice(0, 80) : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    time: Number.isFinite(value.time) ? value.time : Date.now(),
    action: actions.has(value.action) ? value.action : 'preview',
    state: {
      backend: backend.href.replace(/\/+$/, ''), profile: source.profile, target: source.target,
      sources: source.sources, config: typeof source.config === 'string' ? source.config : '',
      ver: typeof source.ver === 'string' ? source.ver : '', options,
      hasHeaders: !!source.hasHeaders || (typeof source.headerValues === 'string' && !!source.headerValues.trim()),
    },
    configText, edited: !!value.edited,
    contentOmitted: !!value.contentOmitted || (!!value.configText && !configText),
  };
}

export function createConversionHistory(getStorage = () => globalThis.localStorage) {
  let items = [];
  let error = '';
  function reload() {
    try {
      const parsed = JSON.parse(getStorage().getItem(HISTORY_KEY) || '[]');
      items = Array.isArray(parsed) ? parsed.map(cleanEntry).filter(Boolean).slice(0, HISTORY_LIMIT) : [];
      error = '';
    } catch { error = '浏览器记录不可读取，当前记录仅保留在本次页面中。'; }
    return { items: [...items], error };
  }
  function persist() {
    items = items.slice(0, HISTORY_LIMIT);
    while (items.length > 1 && JSON.stringify(items).length * 2 > BYTE_LIMIT) items.pop();
    if (JSON.stringify(items).length * 2 > BYTE_LIMIT) items = [];
    try {
      if (items.length) getStorage().setItem(HISTORY_KEY, JSON.stringify(items));
      else getStorage().removeItem(HISTORY_KEY);
      error = '';
    } catch {
      // Keep the history in memory if this browser denies storage or its quota is exhausted.
      error = '浏览器存储不可用或空间不足，新增记录仅保留在本次页面中。';
    }
    return { items: [...items], error };
  }
  reload();
  return {
    list: () => ({ items: [...items], error }), reload,
    save(value) {
      const entry = cleanEntry({ ...value, id: undefined, time: Date.now() });
      if (!entry) return { items: [...items], error: '转换参数无法保存。' };
      if (JSON.stringify(entry).length * 2 > BYTE_LIMIT)
        return { items: [...items], error: '本次参数过大，无法写入本地转换记录。' };
      const fingerprint = JSON.stringify(entry.state);
      const old = items.find((item) => JSON.stringify(item.state) === fingerprint);
      if (!entry.configText && old?.configText) {
        entry.configText = old.configText;
        entry.edited = old.edited;
        entry.contentOmitted = old.contentOmitted;
      }
      items = [entry, ...items.filter((item) => JSON.stringify(item.state) !== fingerprint)];
      return persist();
    },
    remove(id) { items = items.filter((item) => item.id !== id); return persist(); },
    clear() { items = []; return persist(); },
  };
}
