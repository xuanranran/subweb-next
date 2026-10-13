import catalog from './aethersailor-presets.js';

export const AETHERSAILOR_SOURCE = catalog.source;
export const AETHERSAILOR_PRESETS = catalog.templates;

export function templatesFor(configured = [], profile, target, includeAethersailor = true) {
  const seen = new Set();
  const combined = [
    ...configured.map((template) => ({ group: '已有配置', ...template })),
    ...(includeAethersailor ? AETHERSAILOR_PRESETS : []),
  ];
  return combined.filter((template) => {
    if (template.profiles && !template.profiles.includes(profile)) return false;
    if (template.targets && !template.targets.includes(target)) return false;
    if (seen.has(template.value)) return false;
    seen.add(template.value);
    return true;
  });
}

export function templateGroups(templates) {
  const grouped = new Map();
  for (const template of templates) {
    const label = template.group || '已有配置';
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(template);
  }
  const order = ['已有配置', 'Aethersailor'];
  return [...grouped]
    .map(([label, entries]) => ({ label, entries }))
    .sort((a, b) => {
      const rank = (label) => (order.includes(label) ? order.indexOf(label) : order.length);
      return rank(a.label) - rank(b.label);
    });
}
