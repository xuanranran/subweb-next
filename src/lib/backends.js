// Source-audited capability profiles, not inferred from a server's hostname.
export const PROFILES = {
  extended: {
    name: 'SubConverter-Extended',
    short: 'Extended',
    surgeDefault: 3,
    source: 'https://github.com/Aethersailor/SubConverter-Extended',
    sha: '5931771b0402118ee1a806e263747df945780ca0',
    description: '原生远程订阅 · Provider · Stash',
  },
  standard: {
    name: 'subconverter',
    short: 'Standard',
    surgeDefault: 5,
    source: 'https://github.com/xuanranran/subconverter',
    sha: '58b9298bf8d8283d2d618690b9a4f360fe9dcaae',
    description: '服务端转换 · 自定义分组与规则',
  },
};

export const TARGETS = [
  ['clash', 'Clash / Mihomo', 'YAML'],
  ['clashr', 'ClashR', 'YAML'],
  ['singbox', 'sing-box', 'JSON'],
  ['surge', 'Surge', 'CONF'],
  ['stash', 'Stash', 'YAML', 'extended'],
  ['quanx', 'Quantumult X', 'CONF'],
  ['loon', 'Loon', 'CONF'],
  ['surfboard', 'Surfboard', 'CONF'],
  ['quan', 'Quantumult', 'CONF'],
  ['mellow', 'Mellow', 'CONF'],
  ['v2ray', 'V2Ray', 'BASE64'],
  ['v2rayn', 'v2rayN', 'BASE64', 'extended'],
  ['v2rayng', 'v2rayNG', 'BASE64', 'extended'],
  ['shadowrocket', 'Shadowrocket', 'BASE64', 'extended'],
  ['ss', 'Shadowsocks · SIP002', 'BASE64'],
  ['sssub', 'Shadowsocks · Android', 'JSON'],
  ['ssd', 'SSD', 'BASE64'],
  ['ssr', 'ShadowsocksR', 'BASE64'],
  ['trojan', 'Trojan', 'BASE64'],
  ['vless', 'VLESS', 'BASE64', 'extended'],
  ['hysteria2', 'Hysteria 2', 'BASE64', 'extended'],
  ['mixed', '混合节点链接', 'BASE64'],
].map(([value, label, format, profile]) => ({ value, label, format, profile }));

const clash = ['clash', 'clashr'];
const configs = [
  'clash',
  'clashr',
  'singbox',
  'surge',
  'stash',
  'quanx',
  'loon',
  'surfboard',
  'quan',
  'mellow',
];
const field = (key, label, kind, section, help, extra = {}) => ({
  key,
  label,
  kind,
  section,
  help,
  ...extra,
});
export const PARAMETERS = [
  field('filename', '文件名', 'text', 'output', '指定下载文件名，例如 subscription.yaml。'),
  field('list', '仅输出节点', 'bool', 'output', '省略规则和策略组。Extended 会展开远程订阅。'),
  field('append_info', '附带流量信息', 'bool', 'output', '让后端在响应头中附带订阅信息（取决于源订阅）。'),
  field('group', '订阅分组名', 'text', 'output', '传给后端的 group，实际效果取决于输出格式。'),
  field(
    'interval',
    '配置更新间隔',
    'integer',
    'output',
    '秒。托管配置的更新间隔，与单个 Provider 前缀间隔不同。',
    { targets: configs },
  ),
  field('strict', '严格更新', 'bool', 'output', '传递托管配置 strict 更新选项。', { targets: configs }),
  field('dev_id', 'Quantumult X 设备 ID', 'text', 'output', '用于 Quantumult X 配置中的设备标识。', {
    targets: ['quanx'],
  }),
  field('profile_data', '托管配置 URL', 'base64', 'output', '输入原始 URL，面板自动进行标准 Base64 编码。', {
    targets: configs,
  }),
  field('include', '保留匹配节点', 'text', 'nodes', '节点名包含规则，支持后端正则语法。'),
  field('exclude', '排除匹配节点', 'text', 'nodes', '节点名排除规则，支持后端正则语法。'),
  field('rename', '节点重命名', 'text', 'nodes', '后端语法：正则@替换值，多条使用反引号 ` 分隔。'),
  field('emoji', '国旗 Emoji', 'bool', 'nodes', '后端兼容开关；设置时会影响 add_emoji / remove_emoji。'),
  field('add_emoji', '添加国旗', 'bool', 'nodes', '细分添加国旗选项；使用时保持 emoji 为跟随后端。'),
  field('remove_emoji', '移除原国旗', 'bool', 'nodes', '细分移除原国旗选项；使用时保持 emoji 为跟随后端。'),
  field('append_type', '附加节点类型', 'bool', 'nodes', '在节点名称中附加协议类型。'),
  field('sort', '节点排序', 'bool', 'nodes', '按节点名称排序，或使用后端配置的排序脚本。'),
  field('sort_script', '使用排序脚本', 'bool', 'nodes', '需要后端预先配置 sort_script，并开启 sort。'),
  field('fdn', '过滤不受支持的节点', 'bool', 'nodes', '过滤目标客户端不支持或已弃用的节点类型。'),
  field('insert', '插入默认节点', 'bool', 'nodes', '使用后端已配置的 insert_url。'),
  field('prepend', '默认节点置前', 'bool', 'nodes', '决定已配置插入节点的排列位置。'),
  field('udp', 'UDP', 'bool', 'connection', '覆盖节点 UDP 设置；能否输出取决于协议和客户端。'),
  field('tfo', 'TCP Fast Open', 'bool', 'connection', '覆盖节点 TFO 设置。'),
  field('scv', '跳过证书验证', 'bool', 'connection', '开启后不验证节点 TLS 证书。'),
  field('tls13', 'TLS 1.3', 'bool', 'connection', '覆盖节点 TLS 1.3 设置。'),
  field(
    'expand',
    '展开规则集',
    'bool',
    'rules',
    'Standard 的 Clash 默认展开；Extended 默认保留远程规则集。',
    { targets: clash },
  ),
  field(
    'classic',
    'Classical 规则模式',
    'bool',
    'rules',
    'Clash 使用 classical 规则集。Standard 的 Surge：关闭时允许 DOMAIN-SET 拆分，开启时使用传统 RULE-SET。',
    { targets: [...clash, 'surge'] },
  ),
  field(
    'script',
    'Clash Script 模式',
    'bool',
    'rules',
    '后端兼容脚本生成模式，与 expand 组合使用；现代 Mihomo 通常保持默认。',
    { targets: clash },
  ),
  field(
    'new_name',
    'Clash 新字段名',
    'bool',
    'rules',
    '旧 Clash 字段名兼容控制；expand=false 时后端仍可能强制新字段。',
    { targets: clash, profile: 'standard' },
  ),
  field(
    'groups',
    '自定义策略组',
    'base64url',
    'rules',
    '输入后端策略组定义，组之间用 @ 分隔；面板自动编码。config 非空时可能被外部配置取代。',
    { targets: configs, profile: 'standard', multiline: true },
  ),
  field(
    'ruleset',
    '自定义规则集',
    'base64url',
    'rules',
    '输入后端规则集定义，多条用 @ 分隔；面板自动编码。config 非空时可能被外部配置取代。',
    { targets: configs, profile: 'standard', multiline: true },
  ),
  field(
    'provider_proxy_direct',
    'Provider 直连更新',
    'bool',
    'provider',
    '在生成的 Clash Provider 中设置 proxy: DIRECT；仅对远程 Provider 生效。',
    { targets: clash, profile: 'extended' },
  ),
  field(
    'provider_headers',
    '转发请求头名称',
    'text',
    'provider',
    '逗号分隔，例如 X-Subscription-Key。值在下方 JSON 中填写；仅预览/下载请求携带这些头。',
    { targets: ['clash', 'stash'], profile: 'extended' },
  ),
  field('ua', '源订阅 User-Agent', 'text', 'expert', '指定后端下载源订阅时使用的 User-Agent。', {
    profile: 'standard',
  }),
  field('agekey', 'Age 解密密钥', 'secret', 'expert', '用于后端解密 Age 订阅；会进入生成 URL，请谨慎分享。', {
    profile: 'standard',
  }),
  field('token', '后端访问 Token', 'secret', 'expert', '仅 Standard 的 API 模式鉴权；会进入生成 URL。', {
    profile: 'standard',
  }),
  field('filter_script', '节点过滤脚本', 'text', 'expert', '后端脚本格式；需要后端允许脚本执行且通过授权。', {
    profile: 'standard',
    multiline: true,
  }),
];

export const SECTIONS = [
  ['output', '输出'],
  ['nodes', '节点处理'],
  ['connection', '连接'],
  ['rules', '规则'],
  ['provider', 'Provider'],
  ['expert', '进阶'],
].map(([key, label]) => ({ key, label }));

export function targetsFor(profile) {
  return TARGETS.filter((t) => !t.profile || t.profile === profile);
}
export function parametersFor(profile, target) {
  return PARAMETERS.filter(
    (p) =>
      (!p.profile || p.profile === profile) &&
      (!p.targets || p.targets.includes(target)) &&
      !(profile === 'extended' && target === 'surge' && p.key === 'classic'),
  );
}
export function cleanOptions(profile, target, options = {}) {
  const allowed = new Set(parametersFor(profile, target).map((p) => p.key));
  return Object.fromEntries(Object.entries(options).filter(([key]) => allowed.has(key)));
}
