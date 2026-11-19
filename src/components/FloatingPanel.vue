<script setup>
import { ref, useId, watch } from 'vue';

defineProps({
  title: { type: String, required: true },
  panelClass: { type: String, default: '' },
  count: { type: Number, default: 0 },
});

const open = defineModel({ type: Boolean, default: false });
const container = ref(null);
const trigger = ref(null);
const panelId = useId();
const titleId = `${panelId}-title`;

function close() {
  open.value = false;
  trigger.value?.focus({ preventScroll: true });
}

watch(open, (expanded, _, onCleanup) => {
  if (!expanded) return;

  function dismissOutside(event) {
    if (!container.value?.contains(event.target)) open.value = false;
  }

  function dismissOnEscape(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (container.value?.contains(document.activeElement)) close();
    else open.value = false;
  }

  document.addEventListener('pointerdown', dismissOutside);
  document.addEventListener('keydown', dismissOnEscape);
  onCleanup(() => {
    document.removeEventListener('pointerdown', dismissOutside);
    document.removeEventListener('keydown', dismissOnEscape);
  });
}, { immediate: true });
</script>

<template>
  <div ref="container" class="floating-tool">
    <button
      ref="trigger"
      type="button"
      class="floating-trigger"
      :aria-label="count > 0 ? `${title}，${count} 条记录` : title"
      :aria-expanded="open"
      :aria-controls="open ? panelId : undefined"
      @click="open = !open"
    >
      {{ title }}
      <span v-if="count > 0" class="floating-count" aria-hidden="true">{{ count }}</span>
    </button>
    <section v-if="open" :id="panelId" class="floating-panel" :class="panelClass" :aria-labelledby="titleId">
      <div class="floating-panel-heading">
        <h2 :id="titleId">{{ title }}</h2>
        <button type="button" class="text-button floating-close" :aria-label="`关闭${title}面板`" @click="close">×</button>
      </div>
      <slot :close="close"></slot>
    </section>
  </div>
</template>
