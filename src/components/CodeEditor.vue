<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  language: { type: String, default: 'YAML' },
  theme: { type: String, default: 'light' },
  readOnly: Boolean,
  diagnostics: { type: Array, default: () => [] },
});
const emit = defineEmits(['update:modelValue']);
const host = ref(null);
const ready = ref(false);
const failed = ref(false);
const wrapping = ref(true);
const lines = computed(() => props.modelValue.split('\n').length);
let editor;
let disposed = false;
let pendingFocus;
function focusLine(line, column) {
  pendingFocus = [line, column];
  if (editor) { editor.focusLine(line, column); pendingFocus = null; }
}
defineExpose({ focusLine, measure: () => editor?.measure() });
const settings = () => ({ language: props.language, dark: props.theme === 'dark', readOnly: props.readOnly });
onMounted(async () => {
  try {
    const { createCodeEditor } = await import('../lib/code-editor.js');
    if (disposed) return;
    editor = createCodeEditor(host.value, { ...settings(), text: props.modelValue, onChange: (text) => emit('update:modelValue', text) });
    editor.diagnostics(props.diagnostics);
    ready.value = true;
    await nextTick();
    if (!disposed) {
      editor.measure();
      if (pendingFocus) focusLine(...pendingFocus);
    }
  } catch { if (!disposed) failed.value = true; }
});
watch(() => props.modelValue, (text) => editor?.setText(text));
watch(() => props.diagnostics, (items) => editor?.diagnostics(items));
watch(() => [props.language, props.theme, props.readOnly], () => editor?.configure(settings()));
watch(wrapping, (value) => editor?.wrap(value));
onBeforeUnmount(() => { disposed = true; editor?.destroy(); });
</script>

<template>
  <div class="code-editor">
    <div class="editor-toolbar">
      <span>{{ language }} · {{ lines }} 行<span v-if="readOnly"> · 只读</span></span>
      <div>
        <button class="text-button" :disabled="!ready" @click="editor.search()">查找替换</button>
        <button class="text-button" :disabled="!ready" @click="editor.fold()">折叠</button>
        <button class="text-button" :disabled="!ready" @click="editor.unfold()">展开</button>
        <button class="text-button" :aria-pressed="wrapping" @click="wrapping = !wrapping">{{ wrapping ? '自动换行' : '不换行' }}</button>
      </div>
    </div>
    <p v-if="failed" class="field-help">代码编辑器加载失败，可继续使用文本编辑。</p>
    <ul v-if="diagnostics.length" class="editor-diagnostics">
      <li v-for="(item, index) in diagnostics" :key="index">
        <button type="button" class="text-button diagnostic-location" v-if="item.line" @click="focusLine(item.line, item.column)">第 {{ item.line }} 行<span v-if="item.column">，第 {{ item.column }} 列</span></button>
        <span>{{ item.message }}</span>
      </li>
    </ul>
    <div ref="host" class="code-mirror-host" v-show="ready"></div>
    <textarea v-if="!ready" class="editor-fallback" aria-label="转换后配置代码编辑器" :value="modelValue" :readonly="readOnly" spellcheck="false" @input="emit('update:modelValue', $event.target.value)"></textarea>
  </div>
</template>
