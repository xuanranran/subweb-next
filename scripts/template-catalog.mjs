export function parseAethersailorCatalog(text) {
  const templates = [];
  const ids = new Set();
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line.startsWith('Aethersailor ')) continue;
    const fields = line.split(',');
    if (fields.length !== 3 || fields.some((field) => !field.trim()))
      throw new Error(`目录第 ${index + 1} 行需要名称、文件名和 URL 三列。`);
    const [label, id, value] = fields.map((field) => field.trim());
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !id.endsWith('.ini'))
      throw new Error(`目录第 ${index + 1} 行不是有效的 HTTPS INI 模板。`);
    if (ids.has(id)) throw new Error(`目录中存在重复文件名：${id}`);
    ids.add(id);
    templates.push({
      id,
      text: label.replace(/^Aethersailor 规则\s*/, ''),
      value,
      group: 'Aethersailor',
      profiles: ['extended'],
      targets: ['clash', 'clashr'],
    });
  }
  if (!templates.length) throw new Error('未找到 Aethersailor 模板。');
  return templates;
}
