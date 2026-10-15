<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';

defineProps({ title: { type: String, default: '转换后配置' } });
const emit = defineEmits(['close', 'resize']);
const dialog = ref(null);
const maximized = ref(false);
const position = ref(null);
const dragging = ref(false);
const windowStyle = computed(() => !maximized.value && position.value
  ? { left: `${position.value.left}px`, top: `${position.value.top}px`, right: 'auto', bottom: 'auto', margin: '0' } : {});
let previousFocus;
let previousOverflow;
let drag;

function constrain(left, top, box = dialog.value.getBoundingClientRect()) {
  return {
    left: Math.max(8, Math.min(left, window.innerWidth - box.width - 8)),
    top: Math.max(8, Math.min(top, window.innerHeight - box.height - 8)),
  };
}
function stopDrag(event) {
  if (!drag || (event && event.pointerId !== drag.pointerId)) return;
  const { handle, pointerId } = drag;
  drag = null;
  dragging.value = false;
  if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
}
function startDrag(event) {
  if (event.button !== 0 || event.isPrimary === false || maximized.value || window.innerWidth <= 600 ||
      event.target.closest('button, a, input, select, textarea, [role="button"]')) return;
  const box = dialog.value.getBoundingClientRect();
  drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
    left: box.left, top: box.top, handle: event.currentTarget };
  position.value = { left: box.left, top: box.top };
  dragging.value = true;
  // Capture continues the drag outside the window; window listeners also cover non-capturing hosts.
  try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* synthetic/non-active pointer */ }
  event.preventDefault();
}
function moveDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  position.value = constrain(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
}
function fitWindow() {
  stopDrag();
  if (!dialog.value) return;
  if (window.innerWidth <= 600) position.value = null;
  else if (!maximized.value && position.value) position.value = constrain(position.value.left, position.value.top);
}

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
watch(maximized, async () => { stopDrag(); await nextTick(); fitWindow(); emit('resize'); });
onMounted(() => {
  previousFocus = document.activeElement;
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  dialog.value.showModal();
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', stopDrag);
  window.addEventListener('pointercancel', stopDrag);
  window.addEventListener('resize', fitWindow);
});
onBeforeUnmount(() => {
  stopDrag();
  window.removeEventListener('pointermove', moveDrag);
  window.removeEventListener('pointerup', stopDrag);
  window.removeEventListener('pointercancel', stopDrag);
  window.removeEventListener('resize', fitWindow);
  dialog.value?.close();
  document.body.style.overflow = previousOverflow;
  nextTick(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
});
</script>

<template>
  <dialog ref="dialog" class="output-dialog output-panel" :class="{ maximized, dragging }" :style="windowStyle" aria-modal="true" aria-labelledby="config-dialog-title" @cancel.prevent="cancel" @click="backdrop">
    <header class="dialog-heading" @pointerdown="startDrag" @lostpointercapture="stopDrag">
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
