<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  language: { type: String, default: 'YAML' },
  theme: { type: String, default: 'light' },
  readOnly: Boolean,
});
const emit = defineEmits(['update:modelValue']);
const host = ref(null);
const ready = ref(false);
const failed = ref(false);
const fullscreen = ref(false);
const wrapping = ref(true);
const lines = computed(() => props.modelValue.split('\n').length);
let editor;
let disposed = false;
const settings = () => ({ language: props.language, dark: props.theme === 'dark', readOnly: props.readOnly });
function escape(event) { if (event.key === 'Escape' && fullscreen.value) fullscreen.value = false; }
onMounted(async () => {
  window.addEventListener('keydown', escape);
  try {
    const { createCodeEditor } = await import('../lib/code-editor.js');
    if (disposed) return;
    editor = createCodeEditor(host.value, { ...settings(), text: props.modelValue, onChange: (text) => emit('update:modelValue', text) });
    ready.value = true;
    await nextTick();
    if (!disposed) editor.measure();
  } catch { if (!disposed) failed.value = true; }
});
watch(() => props.modelValue, (text) => editor?.setText(text));
watch(() => [props.language, props.theme, props.readOnly], () => editor?.configure(settings()));
watch(wrapping, (value) => editor?.wrap(value));
watch(fullscreen, async () => { await nextTick(); if (!disposed) editor?.measure(); });
onBeforeUnmount(() => { disposed = true; editor?.destroy(); window.removeEventListener('keydown', escape); });
</script>

<template>
  <div class="code-editor" :class="{ fullscreen }">
    <div class="editor-toolbar">
      <span>{{ language }} · {{ lines }} 行<span v-if="readOnly"> · 只读</span></span>
      <div>
        <button class="text-button" :disabled="!ready" @click="editor.search()">查找替换</button>
        <button class="text-button" :disabled="!ready" @click="editor.fold()">折叠</button>
        <button class="text-button" :disabled="!ready" @click="editor.unfold()">展开</button>
        <button class="text-button" :aria-pressed="wrapping" @click="wrapping = !wrapping">{{ wrapping ? '自动换行' : '不换行' }}</button>
        <button class="text-button" :aria-pressed="fullscreen" @click="fullscreen = !fullscreen">{{ fullscreen ? '退出全屏' : '全屏' }}</button>
      </div>
    </div>
    <p v-if="failed" class="field-help">代码编辑器加载失败，可继续使用文本编辑。</p>
    <div ref="host" class="code-mirror-host" v-show="ready"></div>
    <textarea v-if="!ready" class="editor-fallback" aria-label="转换后配置代码编辑器" :value="modelValue" :readonly="readOnly" spellcheck="false" @input="emit('update:modelValue', $event.target.value)"></textarea>
  </div>
</template>
