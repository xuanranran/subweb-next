<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';

defineProps({ title: { type: String, default: '转换后配置' } });
const emit = defineEmits(['close', 'resize']);
const dialog = ref(null);
const maximized = ref(false);
let previousFocus;
let previousOverflow;

function cancel() {
  if (maximized.value) maximized.value = false;
  else emit('close');
}
function backdrop(event) {
  if (event.target !== dialog.value) return;
  const box = dialog.value.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)
    emit('close');
}
watch(maximized, async () => { await nextTick(); emit('resize'); });
onMounted(() => {
  previousFocus = document.activeElement;
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  dialog.value.showModal();
});
onBeforeUnmount(() => {
  dialog.value?.close();
  document.body.style.overflow = previousOverflow;
  nextTick(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
});
</script>

<template>
  <dialog ref="dialog" class="output-dialog output-panel" :class="{ maximized }" aria-modal="true" aria-labelledby="config-dialog-title" @cancel.prevent="cancel" @click="backdrop">
    <header class="dialog-heading">
      <div class="dialog-title"><h2 id="config-dialog-title">{{ title }}</h2><slot name="badge" /></div>
      <div class="dialog-window-controls">
        <button type="button" class="text-button" :aria-pressed="maximized" @click="maximized = !maximized">{{ maximized ? '还原窗口' : '最大化' }}</button>
        <button type="button" class="dialog-close text-button" autofocus @click="emit('close')" aria-label="关闭配置窗口">关闭 ×</button>
      </div>
    </header>
    <div class="dialog-body"><slot /></div>
    <footer class="dialog-footer"><slot name="status" /><span class="dialog-key-hint">{{ maximized ? 'Esc 还原窗口' : 'Esc 关闭窗口' }}</span></footer>
  </dialog>
</template>
