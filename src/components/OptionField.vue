<script setup>
defineProps({ field: Object, modelValue: [String, Boolean, Number] });
defineEmits(['update:modelValue']);
</script>

<template>
  <div class="option-field">
    <label :for="`param-${field.key}`"
      >{{ field.label }} <code>{{ field.key }}</code></label
    >
    <select
      v-if="field.kind === 'bool'"
      :id="`param-${field.key}`"
      :value="modelValue ?? ''"
      @change="$emit('update:modelValue', $event.target.value)"
    >
      <option value="">跟随后端</option>
      <option value="true">开启 · true</option>
      <option value="false">关闭 · false</option>
    </select>
    <textarea
      v-else-if="field.multiline"
      :id="`param-${field.key}`"
      :value="modelValue ?? ''"
      rows="3"
      placeholder="留空使用后端配置"
      spellcheck="false"
      @input="$emit('update:modelValue', $event.target.value)"
    ></textarea>
    <input
      v-else
      :id="`param-${field.key}`"
      :type="field.kind === 'secret' ? 'password' : 'text'"
      :inputmode="field.kind === 'integer' ? 'numeric' : undefined"
      :value="modelValue ?? ''"
      placeholder="留空使用后端配置"
      autocomplete="off"
      @input="$emit('update:modelValue', $event.target.value)"
    />
    <p class="field-help">{{ field.help }}</p>
  </div>
</template>
