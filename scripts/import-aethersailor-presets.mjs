import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseAethersailorCatalog } from './template-catalog.mjs';

const catalogRepository = 'vernesong/OpenClash';
const catalogPath = 'luci-app-openclash/root/usr/share/openclash/res/sub_ini.list';
const args = process.argv.slice(2);
const input = args.includes('--input') ? args[args.indexOf('--input') + 1] : undefined;
let commit = args.includes('--commit') ? args[args.indexOf('--commit') + 1] : undefined;
async function get(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'subweb-next' },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`模板目录下载失败：HTTP ${response.status}`);
  return response;
}
if (!commit && !input)
  commit = (await (await get(`https://api.github.com/repos/${catalogRepository}/commits/dev`)).json()).sha;
if (!/^[a-f\d]{40}$/.test(commit || ''))
  throw new Error('请提供完整目录 commit；本地导入需要 --input 和 --commit。');
const text = input
  ? await readFile(input, 'utf8')
  : await (
      await get(`https://raw.githubusercontent.com/${catalogRepository}/${commit}/${catalogPath}`)
    ).text();
const templates = parseAethersailorCatalog(text);
const output = fileURLToPath(new URL('../src/lib/aethersailor-presets.js', import.meta.url));
const source = {
  repository: 'Aethersailor/Custom_OpenClash_Rules',
  branch: 'main',
  catalog: { repository: catalogRepository, commit, path: catalogPath },
};
await writeFile(
  output,
  '// Generated template data. Update with npm run update:presets.\nexport default ' +
    JSON.stringify({ source, templates }, null, 2) +
    ';\n',
);
console.log(`Imported ${templates.length} Aethersailor presets`);
