<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import FloatingPanel from './FloatingPanel.vue';
import { formatTraffic, readSubscriptionInfo, subscriptionSources } from '../lib/subscription-info.js';

const props = defineProps({
  sources: { type: String, default: '' }, backend: { type: String, default: '' },
  options: { type: Object, default: () => ({}) }, headerValues: { type: String, default: '' },
  service: { type: String, default: '' }, token: { type: String, default: '' },
  auto: { type: Boolean, default: true },
});
const enabled = ref(props.auto);
const rows = ref([]);
const subscriptions = computed(() => subscriptionSources(props.sources));
const pending = computed(() => rows.value.some((row) => row.loading));
const hasSubscriptions = computed(() => subscriptions.value.length > 0);
const expanded = defineModel({ type: Boolean, default: false });
const quotaPercent = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 });
const cache = new Map();
let timer;
let controller;
let generation = 0;
const settings = computed(() => ({ backend: props.backend, headerValues: props.headerValues,
  service: props.service, token: props.token,
  options: Object.fromEntries(['ua', 'agekey', 'token', 'provider_headers']
    .filter((key) => props.options[key]).map((key) => [key, props.options[key]])) }));

function remainingQuota(traffic) {
  if (!traffic || traffic.total <= 0) return null;
  return Math.max(0, traffic.total - traffic.used) / traffic.total;
}

watch(hasSubscriptions, (available) => {
  if (!available) expanded.value = false;
});

function cancel() {
  clearTimeout(timer);
  controller?.abort();
  generation++;
}
async function query(refresh = false) {
  cancel();
  if (!enabled.value) { rows.value = []; return; }
  const requestGeneration = generation;
  const snapshot = settings.value;
  const abort = new AbortController();
  controller = abort;
  rows.value = subscriptions.value.slice(0, 20).map((source) => ({ ...source, loading: true }));
  const queue = [...rows.value];
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length && !abort.signal.aborted) {
      const row = queue.shift();
      const key = JSON.stringify([row.url, snapshot]);
      const cached = cache.get(key);
      try {
        const info = !refresh && cached && Date.now() - cached.time < 300000
          ? cached.info : await readSubscriptionInfo(row.url, snapshot, abort.signal);
        if (generation !== requestGeneration) return;
        if (cache.size >= 40) cache.delete(cache.keys().next().value);
        cache.set(key, { time: Date.now(), info });
        row.info = info;
        row.remaining = remainingQuota(info?.traffic);
      } catch {
        if (generation !== requestGeneration) return;
        row.error = '无法读取，请检查后端、CORS 或订阅权限';
      } finally {
        if (generation === requestGeneration) { row.loading = false; rows.value = [...rows.value]; }
      }
    }
  }));
}
watch([subscriptions, settings, enabled], () => {
  cancel();
  rows.value = [];
  if (enabled.value && subscriptions.value.length) timer = setTimeout(() => query(), 900);
}, { immediate: true, deep: true });
onBeforeUnmount(() => { cancel(); cache.clear(); });
</script>

<template>
  <FloatingPanel v-if="hasSubscriptions" v-model="expanded" title="订阅信息" panel-class="subscription-info">
    <div class="subscription-info-heading">
      <label class="subscription-auto"><input v-model="enabled" type="checkbox" />自动查询</label>
      <button v-if="enabled" type="button" class="text-button subscription-refresh" :disabled="pending" @click="query(true)">刷新信息 ↻</button>
    </div>
    <p v-if="enabled" class="field-help">浏览器读不到信息时，会通过查询服务或转换后端读取。</p>
    <ul v-if="rows.length" class="subscription-info-list" aria-label="流量与到期时间" aria-live="polite">
      <li
        v-for="row in rows"
        :key="row.url"
        class="subscription-card"
        :style="row.remaining != null ? { '--quota-fill': `${row.remaining * 100}%` } : undefined"
      >
        <div class="subscription-card-heading">
          <strong class="subscription-info-name" :title="row.label">{{ row.label }}</strong>
          <span v-if="row.remaining != null" class="subscription-remaining">剩余 {{ quotaPercent.format(row.remaining) }}</span>
        </div>
        <span v-if="row.loading" class="subscription-expiry muted">读取中…</span>
        <span v-else-if="row.error" class="subscription-expiry muted">{{ row.error }}</span>
        <template v-else>
          <span v-if="row.info?.traffic" class="subscription-traffic">
            已用 / 总流量 {{ formatTraffic(row.info.traffic.used) }} / {{ formatTraffic(row.info.traffic.total) }}
          </span>
          <span v-if="row.info?.ambiguous" class="subscription-expiry muted">检测到多个到期时间，无法确定</span>
          <span v-else-if="row.info?.unavailable" class="subscription-expiry muted">原始订阅信息暂无法读取</span>
          <span v-else-if="row.info?.text" class="subscription-expiry">
            <span>到期：{{ row.info.text }}</span>
            <small class="muted" :title="row.info.source === 'header' ? '响应头 expire 时间戳，按浏览器时区显示' : '按节点名称原文提取，时区以服务商标注为准'">{{ row.info.via === 'substore-info' ? 'Sub-Store · ' : row.info.via === 'substore' ? '原订阅 · ' : '' }}{{ row.info.source === 'header' ? '响应头 · 本地时区' : '节点名称' }}</small>
          </span>
          <span v-else class="subscription-expiry muted">无到期信息</span>
        </template>
      </li>
    </ul>
    <p v-if="subscriptions.length > 20" class="field-help">仅自动查询前 20 个不同的订阅地址。</p>
  </FloatingPanel>
</template>
