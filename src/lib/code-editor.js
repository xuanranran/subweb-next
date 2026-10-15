import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { indentUnit, foldAll, unfoldAll, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { openSearchPanel } from '@codemirror/search';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { lintGutter, setDiagnostics } from '@codemirror/lint';

export function createCodeEditor(parent, options) {
  const language = new Compartment();
  const wrapping = new Compartment();
  const appearance = new Compartment();
  const editable = new Compartment();
  let updating = false;
  const mode = (name) => name === 'YAML' ? yaml() : name === 'JSON' ? json() : [];
  const theme = (dark) => EditorView.theme({
    '&': { color: 'var(--text)', backgroundColor: 'var(--input)', fontSize: '12px' },
    '.cm-scroller': { fontFamily: 'var(--font-family)', lineHeight: '1.8', overflow: 'auto' },
    '.cm-content': { fontFamily: 'var(--font-family)', padding: '12px 0', minHeight: '320px' },
    '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--muted)', borderColor: 'var(--line)' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: dark ? '#8cafff12' : '#376cdb09' },
    '.cm-cursor': { borderLeftColor: 'var(--text)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)' },
    '.cm-search input, .cm-search button': { fontFamily: 'var(--font-family)', fontSize: '12px' },
    '.cm-config-key': { color: dark ? '#a9c2ff' : '#345a9b' },
    '.cm-config-string': { color: dark ? '#abd4b3' : '#347447' },
    '.cm-config-number': { color: dark ? '#eab58f' : '#a35529' },
    '.cm-config-keyword': { color: dark ? '#d3b1ee' : '#8750a4' },
    '.cm-config-comment': { color: 'var(--muted)' },
  }, { dark });
  const readOnly = (value) => [EditorState.readOnly.of(value), EditorView.editable.of(!value)];
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.text,
      extensions: [
        basicSetup, lintGutter(), keymap.of([indentWithTab]), indentUnit.of('  '),
        syntaxHighlighting(HighlightStyle.define([
          { tag: tags.propertyName, class: 'cm-config-key' },
          { tag: tags.string, class: 'cm-config-string' },
          { tag: tags.number, class: 'cm-config-number' },
          { tag: [tags.keyword, tags.bool, tags.null], class: 'cm-config-keyword' },
          { tag: tags.comment, class: 'cm-config-comment' },
        ])),
        language.of(mode(options.language)), wrapping.of(EditorView.lineWrapping),
        appearance.of(theme(options.dark)), editable.of(readOnly(options.readOnly)),
        EditorView.contentAttributes.of({ 'aria-label': '转换后配置代码编辑器', spellcheck: 'false' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !updating) options.onChange(update.state.doc.toString());
        }),
      ],
    }),
  });
  return {
    view,
    setText(text) {
      if (view.state.doc.toString() === text) return;
      updating = true;
      try { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); }
      finally { updating = false; }
    },
    configure(options) {
      view.dispatch({ effects: [language.reconfigure(mode(options.language)), appearance.reconfigure(theme(options.dark)), editable.reconfigure(readOnly(options.readOnly))] });
    },
    wrap(enabled) { view.dispatch({ effects: wrapping.reconfigure(enabled ? EditorView.lineWrapping : []) }); },
    diagnostics(items) {
      const diagnostics = items.filter((item) => Number.isInteger(item.line) && item.line > 0 && item.line <= view.state.doc.lines)
        .map((item) => {
          const line = view.state.doc.line(item.line);
          const from = Math.min(line.to, line.from + Math.max(0, (item.column || 1) - 1));
          return { from, to: Math.min(view.state.doc.length, Math.max(from + 1, line.to)),
            severity: 'error', message: item.message, source: item.source === 'yaml' ? 'YAML' : 'Mihomo' };
        });
      view.dispatch(setDiagnostics(view.state, diagnostics));
    },
    focusLine(number, column = 1) {
      if (!Number.isInteger(number) || number < 1 || number > view.state.doc.lines) return;
      const line = view.state.doc.line(number);
      const position = Math.min(line.to, line.from + Math.max(0, column - 1));
      unfoldAll(view);
      view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) });
      view.dom.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      view.focus();
    },
    search() { openSearchPanel(view); view.focus(); },
    fold() { foldAll(view); }, unfold() { unfoldAll(view); },
    measure() { view.requestMeasure(); },
    destroy() { view.destroy(); },
  };
}
