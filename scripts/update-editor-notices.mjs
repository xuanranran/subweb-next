import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const entries = [];
for (const [name, data] of Object.entries(lock.packages)) {
  if (!/^node_modules\/(?:@codemirror\/|@lezer\/|(?:codemirror|style-mod|w3c-keyname|crelt)$)/.test(name)) continue;
  const license = await readFile(path.join(root, name, 'LICENSE'), 'utf8');
  entries.push(`${name.replace('node_modules/', '')} ${data.version}\n${license.trim()}\n`);
}
await writeFile(path.join(root, 'public/codemirror-notices.txt'), `CodeMirror editor third-party notices\n\n${entries.join('\n').trimEnd()}\n`);
console.log(`Updated notices for ${entries.length} editor packages.`);
