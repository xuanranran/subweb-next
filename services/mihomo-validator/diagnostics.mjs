import { parseDocument, LineCounter } from 'yaml';

// Mihomo reports array indexes and field paths rather than source lines for many semantic errors.
// Resolve only explicit paths/indexes against the original YAML AST; never guess a line from a keyword.
export function kernelDiagnostics(text, output) {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });
  const lines = output.split(/\r?\n/).filter((line) => line.trim());
  const errors = lines.filter((line) => /level=(?:error|fatal)|\byaml:|\bline \d+:/i.test(line));
  const selected = errors.length ? errors : lines.slice(-1);
  return selected.slice(0, 12).map((raw) => {
    const message = raw.replace(/^.*?level=(?:error|fatal)\s+msg=/, '').replace(/^"(.*)"$/, '$1');
    const diagnostic = { source: 'mihomo', severity: 'error', message };
    const explicit = raw.match(/\bline (\d+)(?::(\d+))?/i);
    if (explicit && Number(explicit[1]) > 0 && Number(explicit[1]) <= text.split('\n').length) {
      return { ...diagnostic, line: Number(explicit[1]), column: Number(explicit[2] || 1) };
    }
    let field = raw.match(/\b(?:dns|rules|proxies|proxy-groups|proxy-providers|rule-providers|listeners)(?:\.[\w-]+|\[\d+\])+/)?.[0];
    const proxy = raw.match(/\bproxy (\d+):/);
    const group = raw.match(/\bproxy group\[(\d+)\]:/);
    if (!field && proxy) field = `proxies[${proxy[1]}]`;
    if (!field && group) field = `proxy-groups[${group[1]}]`;
    if (!field) return diagnostic;
    const parts = field.replace(/\[(\d+)\]/g, '.$1').split('.').map((part) => /^\d+$/.test(part) ? Number(part) : part);
    let node;
    try { node = doc.getIn(parts, true); } catch { return { ...diagnostic, field }; }
    if (!node?.range) return { ...diagnostic, field };
    const position = lineCounter.linePos(node.range[0]);
    return { ...diagnostic, field, line: position.line, column: position.col };
  });
}
