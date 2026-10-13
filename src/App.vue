<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import OptionField from './components/OptionField.vue';
import { PROFILES, SECTIONS, cleanOptions, parametersFor, targetsFor } from './lib/backends.js';
import { buildConversion, sourceLines } from './lib/converter.js';
import { copyText, createShortLink, fetchText, readVersion } from './lib/network.js';
import { templatesFor, templateGroups } from './lib/presets.js';
import { currentSiteBackend, versionProfile } from './lib/local-backend.js';

const runtime = window.config || {};
const backends = reactive(
  (runtime.apiUrl || []).map((b, index) => ({
    ...b,
    id: String(index),
    profile: b.profile || (index === 0 ? 'extended' : 'standard'),
  })),
);
if (!backends.length)
  backends.push(
    { id: '0', value: 'https://api.miaoceo.com', text: 'SubConverter-Extended', profile: 'extended' },
    { id: '1', value: 'https://sub.miaoceo.com', text: 'subconverter', profile: 'standard' },
  );
const currentSite = runtime.localBackend === false ? null : currentSiteBackend(window.location);
if (currentSite) backends.push(currentSite);
const selected = ref(backends[0].id);
const userSelectedBackend = ref(false);
const localBackend = computed(() => backends.find((b) => b.local));
const customProfile = ref('standard');
const customEndpoint = ref('');
const backend = computed(() => backends.find((b) => b.id === selected.value));
const profile = computed(() => (selected.value === 'custom' ? customProfile.value : backend.value.profile));
const address = computed(() => (selected.value === 'custom' ? customEndpoint.value : backend.value.value));
const target = ref('clash');
const sources = ref('');
const configChoice = ref('');
const customConfig = ref('');
const ver = ref('');
const options = reactive({});
const headerValues = ref('');
const advanced = ref(false);
const activeSection = ref('output');
const theme = ref('light');
try {
  theme.value = localStorage.getItem('subweb-theme') || 'light';
} catch {
  /* unavailable browser storage */
}
const error = ref('');
const toast = ref('');
const busy = ref('');
const short = ref(null);
const output = ref(null);
const versions = reactive({});
const revision = ref(0);
const providerOpen = ref(false);
const providerForm = reactive({ name: '', url: '', tag: '', interval: '' });
const availableTargets = computed(() => targetsFor(profile.value));
const chosenTarget = computed(() => availableTargets.value.find((t) => t.value === target.value));
const templates = computed(() =>
  templatesFor(
    runtime.remoteConfigOptions,
    profile.value,
    target.value,
    runtime.aethersailorPresets !== false,
  ),
);
const groupedTemplates = computed(() => templateGroups(templates.value));
const selectedTemplate = computed(() =>
  templates.value.find((template) => template.value === configChoice.value),
);
const ruleExpansion = computed({
  get: () => options.expand ?? '',
  set: (value) => {
    options.expand = value;
  },
});
const config = computed(() => (configChoice.value === 'custom' ? customConfig.value : configChoice.value));
const fields = computed(() => parametersFor(profile.value, target.value));
const sections = computed(() => SECTIONS.filter((s) => fields.value.some((f) => f.section === s.key)));
const currentFields = computed(() => fields.value.filter((f) => f.section === activeSection.value));
const overrideCount = computed(
  () =>
    fields.value.filter(
      (f) => options[f.key] !== '' && options[f.key] !== undefined && options[f.key] !== null,
    ).length,
);
const sourceCount = computed(() => sourceLines(sources.value).length);
const supportsProvider = computed(
  () =>
    profile.value === 'extended' &&
    ['clash', 'clashr', 'surge', 'surfboard', 'loon', 'quanx', 'stash'].includes(target.value),
);
const state = computed(() => ({
  backend: address.value,
  profile: profile.value,
  target: target.value,
  sources: sources.value,
  config: config.value,
  ver: ver.value,
  options: { ...options },
  headerValues: headerValues.value,
}));
const generated = computed(() => {
  if (!sources.value.trim()) return { url: '', headers: {} };
  try {
    return buildConversion(state.value);
  } catch (e) {
    return { url: '', headers: {}, error: e.message };
  }
});
const shortUrl = computed(() => (short.value?.source === generated.value.url ? short.value.url : ''));
const currentOutput = computed(() => (output.value?.source === generated.value.url ? output.value : null));
const needsHeaders = computed(() => Object.keys(generated.value.headers).length > 0);
const description = computed(() => {
  if (profile.value === 'standard') return '源订阅由后端下载并转换，支持自定义规则与策略组。';
  if (supportsProvider.value)
    return '支持客户端原生远程订阅。节点覆盖和筛选可能触发服务端转换，可通过诊断确认。';
  return '源订阅由 Extended 后端转换为所选客户端格式。';
});

function notify(message) {
  toast.value = message;
  setTimeout(() => {
    if (toast.value === message) toast.value = '';
  }, 3500);
}
function validated(explain = false) {
  error.value = '';
  return buildConversion({ ...state.value, explain });
}
async function run(name, action) {
  if (busy.value) return;
  busy.value = name;
  error.value = '';
  try {
    await action();
  } catch (e) {
    error.value =
      e.name === 'TimeoutError'
        ? '请求超时，请检查后端可用性。'
        : e.message === 'Failed to fetch'
          ? '请求未完成。请检查后端 CORS、网络和 Cloudflare 验证；HTTP 后端也可能被 HTTPS 页面拦截。'
          : e.message;
  } finally {
    busy.value = '';
  }
}
async function copyLink() {
  await run('copy', async () => {
    const req = validated();
    if (Object.keys(req.headers).length) throw new Error('链接无法携带请求头值，请使用预览或下载。');
    await copyText(req.url);
    notify('转换链接已复制');
  });
}
async function shorten() {
  await run('short', async () => {
    const req = validated();
    const requestRevision = revision.value;
    if (Object.keys(req.headers).length)
      throw new Error('带请求头的转换不能生成可直接使用的短链，请使用下载。');
    const url = await createShortLink(runtime.shortUrl || 'https://i.miaoceo.com', req.url);
    if (generated.value.url !== req.url || revision.value !== requestRevision) return;
    short.value = { source: req.url, url };
    await copyText(url);
    notify('短链已生成并复制，有效期 30 天');
  });
}
async function requestOutput(diagnostic = false, download = false) {
  await run(diagnostic ? 'diagnose' : download ? 'download' : 'preview', async () => {
    const req = validated(diagnostic);
    const original = generated.value.url;
    const requestRevision = revision.value;
    const { text } = await fetchText(req.url, req.headers);
    let result = text;
    if (diagnostic) {
      try {
        result = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        throw new Error('后端未返回诊断 JSON，在线版本可能尚未支持 explain。');
      }
    }
    if (generated.value.url !== original || revision.value !== requestRevision) return;
    if (download) {
      const format = chosenTarget.value.format;
      const extension =
        format === 'YAML' ? 'yaml' : format === 'JSON' ? 'json' : format === 'CONF' ? 'conf' : 'txt';
      const blobUrl = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = options.filename || `subscription.${extension}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      notify('配置已下载');
    } else {
      output.value = { source: original, text: result, diagnostic };
    }
  });
}
function selectBackend(id) {
  userSelectedBackend.value = true;
  selected.value = id;
}
async function checkVersions(autoSelectLocal = false) {
  const list = selected.value === 'custom' ? [{ id: 'custom', value: customEndpoint.value }] : backends;
  await Promise.allSettled(
    list.map(async (b) => {
      versions[b.id] = { loading: true, endpoint: b.value };
      try {
        const text = await readVersion(b.value);
        if (versions[b.id]?.endpoint === b.value && (b.id !== 'custom' || customEndpoint.value === b.value)) {
          versions[b.id] = { text, endpoint: b.value };
          const detectedProfile = versionProfile(text);
          if (b.id === 'custom') customProfile.value = detectedProfile || 'standard';
          if (b.local) {
            if (detectedProfile) b.profile = detectedProfile;
            if (
              detectedProfile &&
              autoSelectLocal &&
              !userSelectedBackend.value &&
              !sources.value.trim() &&
              target.value === 'clash' &&
              !configChoice.value &&
              !overrideCount.value
            )
              selected.value = b.id;
          }
        }
      } catch (e) {
        if (b.id === 'custom' && customEndpoint.value !== b.value) return;
        versions[b.id] = {
          error: e.message === 'Failed to fetch' ? '无法读取 · 检查 CORS / 验证' : e.message,
          endpoint: b.value,
        };
      }
    }),
  );
}
function resetOptions() {
  for (const key of Object.keys(options)) delete options[key];
  ver.value = '';
  headerValues.value = '';
  notify('已恢复后端默认参数');
}
function addProvider() {
  error.value = '';
  try {
    const { name, url, tag, interval } = providerForm;
    if (!name.trim() || /[,|\r\n]/.test(name + tag))
      throw new Error('请填写 Provider 名称；名称和标签不能含逗号、竖线或换行。');
    const line = `provider:${name.trim()},${interval ? `interval:${interval},` : ''}${
      tag.trim() ? `tag:${tag.trim()},` : ''
    }${url.trim()}`;
    buildConversion({ ...state.value, sources: line });
    sources.value = [...sourceLines(sources.value), line].join('\n');
    Object.assign(providerForm, { name: '', url: '', tag: '', interval: '' });
    providerOpen.value = false;
    notify('已添加远程订阅');
  } catch (e) {
    error.value = e.message;
  }
}
watch([profile, target], () => {
  if (!targetsFor(profile.value).some((t) => t.value === target.value)) target.value = 'clash';
  const valid = cleanOptions(profile.value, target.value, options);
  for (const key of Object.keys(options)) if (!(key in valid)) delete options[key];
  if (!sections.value.some((s) => s.key === activeSection.value)) activeSection.value = 'output';
  if (configChoice.value !== 'custom' && !templates.value.some((c) => c.value === configChoice.value))
    configChoice.value = '';
  ver.value = '';
  error.value = '';
  providerOpen.value = false;
  if (!fields.value.some((f) => f.key === 'provider_headers')) headerValues.value = '';
});
watch(customEndpoint, () => {
  customProfile.value = 'standard';
  delete versions.custom;
});
watch(
  state,
  () => {
    revision.value++;
    error.value = '';
    short.value = null;
    output.value = null;
  },
  { deep: true },
);
watch(
  theme,
  (value) => {
    document.documentElement.dataset.theme = value;
    try {
      localStorage.setItem('subweb-theme', value);
    } catch {
      /* optional preference */
    }
  },
  { immediate: true },
);
onMounted(() => checkVersions(true));
</script>

<template>
  <div class="shell">
    <div class="navigation">
      <header class="topbar">
        <a href="./" class="brand" aria-label="Subweb 首页"
          ><span class="brand-icon"
            ><svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M5 8h14m-4-4 4 4-4 4M19 16H5m4 4-4-4 4-4"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              /></svg></span
          >{{ runtime.siteName || 'Subweb' }}<span class="brand-tag">NEXT</span></a
        >
        <div class="top-actions">
          <a :href="PROFILES[profile].source" target="_blank" rel="noreferrer">后端源码 ↗</a
          ><button
            class="icon-button"
            @click="theme = theme === 'light' ? 'dark' : 'light'"
            :aria-label="theme === 'light' ? '切换深色模式' : '切换浅色模式'"
          >
            <svg v-if="theme === 'light'" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M20 14.2A8 8 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2Z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
              />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.6" />
              <path
                d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>
      </header>
    </div>
    <main>
      <h1 class="sr-only">订阅转换工作台</h1>
      <section class="engine-section" id="convert" aria-labelledby="engine-title">
        <div class="section-heading">
          <h2 id="engine-title"><span class="section-number">01</span>选择转换引擎</h2>
          <button
            class="text-button"
            @click="checkVersions()"
            :disabled="Object.values(versions).some((v) => v.loading)"
          >
            ↻ 读取在线版本
          </button>
        </div>
        <div class="mobile-engine-picker">
          <label for="mobile-backend" class="sr-only">选择转换后端</label>
          <select id="mobile-backend" :value="selected" @change="selectBackend($event.target.value)">
            <option v-for="b in backends" :key="b.id" :value="b.id">{{ b.text }}</option>
            <option v-if="selected === 'custom'" value="custom">自定义后端</option>
          </select>
          <div class="mobile-engine-address">
            <code>{{ address.replace(/^https?:\/\//, '') || '请填写自定义地址' }}</code>
            <details class="mobile-engine-status" :key="selected">
              <summary>
                {{
                  versions[selected]?.loading
                    ? '读取中…'
                    : versions[selected]?.text
                      ? '版本已读取'
                      : versions[selected]?.error
                        ? '读取失败'
                        : '待检查'
                }}
              </summary>
              <p>
                {{
                  versions[selected]?.text ||
                  versions[selected]?.error ||
                  '点击上方“读取在线版本”检查后端版本。'
                }}
              </p>
            </details>
          </div>
        </div>
        <div class="engine-grid" :class="{ 'has-local': localBackend }">
          <button
            v-for="b in backends"
            :key="b.id"
            type="button"
            class="engine-card"
            :class="{ selected: selected === b.id, local: b.local }"
            :aria-pressed="selected === b.id"
            @click="selectBackend(b.id)"
          >
            <div class="engine-top">
              <span class="engine-glyph" :class="b.profile"
                ><svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path v-if="b.local" d="m3 10 9-7 9 7M5 9v11h14V9M10 20v-6h4v6" />
                  <path
                    v-else-if="b.profile === 'extended'"
                    d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"
                  />
                  <path v-else d="M4 8h16m-4-4 4 4-4 4M20 16H4m4 4-4-4 4-4" /></svg></span
              ><span class="selection-dot"></span>
            </div>
            <strong>{{ b.text }}</strong
            ><span class="engine-desc">{{
              b.local ? '自动沿用当前访问地址' : PROFILES[b.profile]?.description
            }}</span>
            <div class="engine-bottom">
              <code>{{ b.value.replace(/^https?:\/\//, '') }}</code
              ><span class="version-pill">{{
                versions[b.id]?.loading ? '读取中…' : versions[b.id]?.text ? '版本已读取' : '待检查'
              }}</span>
            </div>
            <span class="version-detail">{{
              versions[b.id]?.text || versions[b.id]?.error || '点击上方按钮检查版本'
            }}</span>
          </button>
        </div>
        <details class="custom-backend">
          <summary @click="error = ''">使用自定义后端</summary>
          <div class="custom-grid">
            <label for="custom-endpoint"
              >API 根地址<input
                id="custom-endpoint"
                v-model="customEndpoint"
                placeholder="https://example.com"
                autocomplete="off" /></label
            ><button
              class="secondary"
              @click="
                selectBackend('custom');
                checkVersions();
              "
            >
              使用并读取版本
            </button>
          </div>
          <p v-if="selected === 'custom'" class="field-help">
            当前自定义后端：{{
              versions.custom?.text ||
              versions.custom?.error ||
              (versions.custom?.loading ? '读取中…' : '暂按普通版参数')
            }}
          </p>
        </details>
      </section>

      <div class="workspace">
        <div class="editor">
          <div class="form-section">
            <section class="panel">
              <div class="panel-heading">
                <h2><span class="step">02</span>订阅来源</h2>
                <span class="muted">{{ sourceCount }} 条来源</span>
              </div>
              <label class="sr-only" for="sources">订阅链接或节点，每行一条</label>
              <textarea
                id="sources"
                v-model="sources"
                class="source-input"
                rows="6"
                spellcheck="false"
                autocomplete="off"
                placeholder="粘贴订阅链接或节点，每行一条&#10;https://example.com/subscription&#10;ss://… 或 vmess://…"
              ></textarea>
              <div class="source-footer">
                <span class="field-help">支持多行或 | 分隔。链接仅在预览、下载或短链时发送。</span
                ><button
                  v-if="supportsProvider"
                  class="text-button"
                  @click="providerOpen = !providerOpen"
                  :aria-expanded="providerOpen"
                >
                  ＋ 添加 Provider
                </button>
              </div>
              <div v-if="providerOpen" class="provider-composer">
                <div class="two-columns">
                  <label>Provider 名称<input v-model="providerForm.name" placeholder="例如 香港机场" /></label
                  ><label>来源标签（可选）<input v-model="providerForm.tag" placeholder="例如 HK" /></label>
                </div>
                <label
                  >订阅 URL<input v-model="providerForm.url" placeholder="https://example.com/sub" /></label
                ><label v-if="['clash', 'clashr', 'surge', 'quanx', 'stash'].includes(target)"
                  >独立更新间隔（秒，可选）<input
                    v-model="providerForm.interval"
                    inputmode="numeric"
                    placeholder="21600" /></label
                ><button class="secondary" @click="addProvider">添加到来源</button>
              </div>
            </section>
          </div>

          <div class="form-section">
            <section class="panel">
              <div class="panel-heading">
                <h2><span class="step">03</span>输出配置</h2>
                <span class="small-badge">{{ PROFILES[profile].short }}</span>
              </div>
              <div class="two-columns">
                <label for="target"
                  >目标客户端<select id="target" v-model="target">
                    <option v-for="t in availableTargets" :key="t.value" :value="t.value">
                      {{ t.label }}
                    </option>
                  </select></label
                ><label for="config"
                  >远程配置<select id="config" v-model="configChoice">
                    <option value="">使用后端默认配置</option>
                    <optgroup v-for="group in groupedTemplates" :key="group.label" :label="group.label">
                      <option v-for="c in group.entries" :key="c.value" :value="c.value">{{ c.text }}</option>
                    </optgroup>
                    <option value="custom">自定义配置 URL</option>
                  </select></label
                >
              </div>
              <label v-if="configChoice === 'custom'" class="spaced"
                >配置 URL<input
                  v-model="customConfig"
                  placeholder="https://example.com/config.ini"
                  autocomplete="off"
              /></label>
              <p v-if="selectedTemplate" class="field-help">
                {{ selectedTemplate.text }} ·
                <a :href="selectedTemplate.value" target="_blank" rel="noreferrer">查看模板 ↗</a>
              </p>
              <label
                v-if="profile === 'extended' && ['clash', 'clashr'].includes(target)"
                for="rule-expansion"
                class="spaced"
              >
                规则输出
                <select id="rule-expansion" v-model="ruleExpansion">
                  <option value="">跟随后端 · 默认保留远程规则</option>
                  <option value="true">展开规则 · 内联到配置</option>
                  <option value="false">保留远程规则 · Rule Provider</option>
                </select>
                <span class="field-help"
                  >展开后由后端读取规则集并写入配置；保留远程规则时由客户端更新规则集。GEOSITE / GEOIP
                  条目仍由客户端处理。</span
                >
                <span v-if="options.list === 'true' || options.list === true" class="field-help"
                  >当前仅输出节点，不包含规则或策略组。需要完整配置时，请将高级参数“仅输出节点”设为关闭。</span
                >
              </label>
              <label v-if="target === 'surge'" class="spaced"
                >Surge 版本<select v-model="ver">
                  <option value="">后端默认 · {{ PROFILES[profile].surgeDefault }}</option>
                  <option v-for="v in [2, 3, 4, 5]" :key="v" :value="String(v)">Surge {{ v }}</option>
                </select></label
              >
              <p class="engine-note"><span>ⓘ</span>{{ description }}</p>
            </section>
          </div>

          <div class="form-section">
            <section class="panel advanced-panel">
              <button
                class="accordion-heading"
                @click="advanced = !advanced"
                :aria-expanded="advanced"
                aria-controls="advanced-options"
              >
                <h2>
                  <span class="step">04</span>高级参数<span class="count" v-if="overrideCount">{{
                    overrideCount
                  }}</span>
                </h2>
                <span>{{ advanced ? '收起 −' : '展开 ＋' }}</span>
              </button>
              <p class="advanced-caption">留空或“跟随后端”保留引擎默认行为。</p>
              <div v-if="advanced" id="advanced-options">
                <div class="param-tabs" role="tablist" aria-label="参数分类">
                  <button
                    v-for="s in sections"
                    :key="s.key"
                    role="tab"
                    :aria-selected="activeSection === s.key"
                    :class="{ active: activeSection === s.key }"
                    @click="activeSection = s.key"
                  >
                    {{ s.label }}
                  </button>
                </div>
                <div class="options-grid">
                  <OptionField v-for="f in currentFields" :key="f.key" :field="f" v-model="options[f.key]" />
                </div>
                <label v-if="activeSection === 'provider' && options.provider_headers" class="spaced"
                  >请求头值 · JSON<textarea
                    v-model="headerValues"
                    rows="3"
                    spellcheck="false"
                    autocomplete="off"
                    placeholder='{"X-Subscription-Key":"你的值"}'
                  ></textarea
                  ><span class="field-help"
                    >值保留在当前页面内存中。下载需要后端 CORS
                    允许这些请求头；复制链接和短链无法传递请求头值。</span
                  ></label
                >
                <p v-if="profile === 'extended' && activeSection === 'rules'" class="engine-note">
                  Extended 的 Clash 始终使用新字段名；自定义分组与规则请写入远程配置。classic 在此后端只控制
                  Clash。
                </p>
                <button class="text-button reset-options" @click="resetOptions">恢复全部默认参数</button>
              </div>
            </section>
          </div>
        </div>

        <div class="result-column">
          <div class="result-section">
            <section class="panel result-panel">
              <div class="panel-heading">
                <h2><span class="result-indicator"></span>转换结果</h2>
                <span class="format-tag">{{ chosenTarget?.format }}</span>
              </div>
              <div class="result-summary">
                <span class="result-mark">⇄</span>
                <div>
                  <strong>{{ chosenTarget?.label }}</strong
                  ><span
                    >{{ PROFILES[profile].short }} · {{ availableTargets.length }} 种格式 ·
                    {{ sourceCount }} 条来源</span
                  >
                </div>
              </div>
              <label for="result-link">订阅链接 <span class="muted">实时生成</span></label>
              <textarea
                id="result-link"
                class="result-url"
                :value="generated.url"
                rows="5"
                readonly
                placeholder="添加订阅来源后，转换链接会出现在这里。"
              ></textarea>
              <div v-if="error || generated.error" class="error" role="alert">
                {{ error || generated.error }}
              </div>
              <p v-if="needsHeaders" class="field-help">已配置请求头，请使用预览或下载配置。</p>
              <button
                class="primary main-action"
                :disabled="!!busy || !generated.url || needsHeaders"
                @click="copyLink"
              >
                {{ busy === 'copy' ? '复制中…' : '复制转换链接' }} <span>↗</span>
              </button>
              <div class="result-actions">
                <button
                  class="secondary"
                  :disabled="!!busy || !generated.url || needsHeaders"
                  @click="shorten"
                >
                  {{ busy === 'short' ? '生成中…' : '生成短链' }}</button
                ><button
                  class="secondary"
                  :disabled="!!busy || !generated.url"
                  @click="requestOutput(false, true)"
                >
                  {{ busy === 'download' ? '下载中…' : '下载配置 ↓' }}
                </button>
              </div>
              <div v-if="shortUrl" class="short-result">
                <span>短链 · 30 天有效</span>
                <div>
                  <input :value="shortUrl" readonly aria-label="生成的短链接" /><button
                    class="text-button"
                    @click="
                      run('copy-short', async () => {
                        await copyText(shortUrl);
                        notify('短链已复制');
                      })
                    "
                  >
                    复制
                  </button>
                </div>
              </div>
              <div class="result-tools">
                <button class="text-button" :disabled="!!busy || !generated.url" @click="requestOutput()">
                  {{ busy === 'preview' ? '读取中…' : '预览配置' }}</button
                ><button
                  v-if="profile === 'extended'"
                  class="text-button"
                  :disabled="!!busy || !generated.url"
                  @click="requestOutput(true)"
                >
                  {{ busy === 'diagnose' ? '诊断中…' : '转换诊断' }}
                </button>
              </div>
              <p class="result-footnote">面板不保存订阅和密钥。短链服务会保存生成链接，用于后续跳转。</p>
            </section>
          </div>
          <section class="context-card" id="about">
            <span class="eyebrow">当前能力</span
            ><strong>{{ profile === 'extended' ? '为远程订阅而设计' : '保留完整转换控制' }}</strong>
            <p>
              {{
                profile === 'extended'
                  ? '22 种输出格式；支持 Provider 命名、独立间隔和 explain 诊断。'
                  : '16 种输出格式；支持源 UA、Age 解密、自定义策略组和规则集。'
              }}
            </p>
            <a :href="PROFILES[profile].source" target="_blank" rel="noreferrer">查看后端文档 ↗</a>
          </section>
        </div>
      </div>
      <div v-if="currentOutput" class="output-stage">
        <section class="panel output-panel">
          <div class="panel-heading">
            <h2>{{ currentOutput.diagnostic ? '转换诊断 · JSON' : '配置预览' }}</h2>
            <button class="text-button" @click="output = null">关闭 ×</button>
          </div>
          <pre>{{ currentOutput.text }}</pre>
        </section>
      </div>
    </main>
    <footer>
      <span>Subweb Next <span class="footer-dot">·</span> 订阅转换工作台</span
      ><span>Standard & Extended</span>
    </footer>
    <div v-if="toast" class="toast" role="status">✓ {{ toast }}</div>
  </div>
</template>
