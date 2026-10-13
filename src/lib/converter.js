import { PROFILES, parametersFor, targetsFor } from './backends.js';

export function endpoint(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error('请输入完整的后端地址。');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('后端地址须为 HTTP(S)，且不含账号、查询参数或片段。');
  }
  return url.href.replace(/\/+$/, '');
}

export function base64(text, urlSafe = false) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary);
  return urlSafe ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : encoded;
}

export function sourceLines(text) {
  return String(text)
    .split(/[\r\n|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeSources(text, profile, target, options = {}) {
  const lines = sourceLines(text);
  if (!lines.length) throw new Error('请先添加订阅链接或节点。');
  for (const [index, line] of lines.entries()) {
    let rest = line;
    if (profile === 'extended' && /^(?:%3c)?(?:provider|tag|interval|proxy_direct|node)%3a/i.test(rest)) {
      try {
        rest = decodeURIComponent(rest);
      } catch {
        throw new Error(`第 ${index + 1} 条：前缀编码无效。`);
      }
    }
    const prefixes = {};
    let match;
    let bracketed = false;
    while ((match = /^(<?)(provider|tag|interval|proxy_direct):([^,]*),>?/.exec(rest))) {
      if (match[1]) bracketed = true;
      if (bracketed && profile !== 'extended') throw new Error('带尖括号的订阅前缀仅支持 Extended。');
      if (prefixes[match[2]] !== undefined) throw new Error(`第 ${index + 1} 条：前缀 ${match[2]} 重复。`);
      prefixes[match[2]] = match[3].trim();
      rest = rest.slice(match[0].length);
    }
    if (bracketed && rest.endsWith('>')) rest = rest.slice(0, -1);
    if (Object.keys(prefixes).some((k) => k !== 'tag') && profile !== 'extended') {
      throw new Error(`第 ${index + 1} 条：订阅前缀请使用 Extended 后端。`);
    }
    if (Object.values(prefixes).some((v) => !v)) throw new Error(`第 ${index + 1} 条：订阅前缀不能为空。`);
    const remote = /^https?:\/\//i.test(rest);
    if (
      prefixes.provider &&
      (!remote || !['clash', 'clashr', 'quanx', 'surge', 'stash', 'loon', 'surfboard'].includes(target))
    ) {
      throw new Error(`第 ${index + 1} 条：Provider 命名需要支持远程订阅的客户端和 HTTP(S) 链接。`);
    }
    if (prefixes.interval !== undefined) {
      if (!/^\d+$/.test(prefixes.interval) || Number(prefixes.interval) > 2147483647)
        throw new Error(`第 ${index + 1} 条：Provider 间隔须为 0～2147483647 的整数秒。`);
      if (
        !remote ||
        !['clash', 'clashr', 'quanx', 'surge', 'stash'].includes(target) ||
        options.list === true ||
        options.list === 'true'
      )
        throw new Error(
          'Provider 间隔仅支持远程 Clash、ClashR、Quantumult X、Surge、Stash，且不能仅输出节点。',
        );
      if (['surge', 'stash'].includes(target) && Number(prefixes.interval) === 0)
        throw new Error('Surge / Stash 的 Provider 间隔必须大于 0。');
    }
    if (prefixes.proxy_direct !== undefined) {
      if (
        !['true', 'false', '1', '0'].includes(prefixes.proxy_direct) ||
        !remote ||
        !['clash', 'clashr'].includes(target) ||
        options.list === true ||
        options.list === 'true'
      )
        throw new Error('proxy_direct 前缀仅支持远程 Clash / ClashR Provider，值为 true / false / 1 / 0。');
    }
    if (rest.startsWith('node:')) {
      if (profile !== 'extended' || !['clash', 'clashr'].includes(target))
        throw new Error('node: HTTP(S) 节点仅支持 Extended 的 Clash / ClashR。');
      let node;
      try {
        node = new URL(rest.slice(5));
      } catch {
        throw new Error('node: 后面须为 HTTP(S) 节点地址。');
      }
      // URL.port omits an explicitly specified default port, so inspect the source authority too.
      const explicitPort = /^https?:\/\/(?:\[[^\]]+\]|[^/:?#@]+):\d+\/?$/i.test(rest.slice(5));
      if (
        !['http:', 'https:'].includes(node.protocol) ||
        !explicitPort ||
        node.username ||
        node.password ||
        node.search ||
        node.hash ||
        node.pathname !== '/' ||
        ['provider', 'interval', 'proxy_direct'].some((k) => k in prefixes)
      )
        throw new Error('node: 地址须含显式端口，且不能含账号、路径、查询参数或 Provider 前缀。');
    } else if (!/^[a-z][a-z\d+.-]*:\/\/\S+$/i.test(rest)) {
      throw new Error(`第 ${index + 1} 条：需要完整订阅 URL 或节点协议链接。`);
    }
    if (remote) {
      try {
        new URL(rest);
      } catch {
        throw new Error(`第 ${index + 1} 条：订阅 URL 无效。`);
      }
    }
  }
  return lines.join('|');
}

export function forwardedHeaders(names, json) {
  if (!names?.trim()) return {};
  const list = names.split(',').map((s) => s.trim());
  if (names.length > 1024 || list.length > 16 || !list.length)
    throw new Error('请求头名称最多 16 个、总长不超过 1024 字符。');
  let values;
  try {
    values = JSON.parse(json || '{}');
  } catch {
    throw new Error('请求头值须为 JSON 对象。');
  }
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw new Error('请求头值须为 JSON 对象。');
  const entries = Object.entries(values);
  const result = {};
  for (const name of list) {
    if (
      !/^[!#$%&'*+.^_`|~\da-z-]+$/i.test(name) ||
      /^(host|cookie|user-agent|origin|referer|connection|keep-alive|content-length|accept-encoding|proxy-authenticate|proxy-authorization|forwarded|te|trailer|transfer-encoding|upgrade|x-age-public-key|if-match|if-none-match|if-modified-since|if-unmodified-since|if-range|range)$/i.test(
        name,
      ) ||
      /^(x-forwarded-|cf-|sec-|x-real-ip|x-client-ip|x-original-|x-envoy-|true-client-ip|fastly-|fly-)/i.test(
        name,
      )
    )
      throw new Error(`请求头 ${name} 不允许转发，请使用自定义头名称。`);
    if (Object.keys(result).some((k) => k.toLowerCase() === name.toLowerCase()))
      throw new Error('请求头名称重复。');
    const entry = entries.find(([k]) => k.toLowerCase() === name.toLowerCase());
    if (
      !entry ||
      typeof entry[1] !== 'string' ||
      !entry[1] ||
      new TextEncoder().encode(entry[1]).length > 8192 ||
      /[\r\n\0\x7f]/.test(entry[1])
    )
      throw new Error(`请在 JSON 中填写 ${name} 的有效字符串值（不超过 8192 字节）。`);
    result[name] = entry[1];
  }
  return result;
}

export function buildConversion({
  backend,
  profile,
  target,
  sources,
  config = '',
  ver = '',
  options = {},
  headerValues = '',
  explain = false,
}) {
  if (!PROFILES[profile]) throw new Error('请选择后端类型。');
  if (!targetsFor(profile).some((t) => t.value === target)) throw new Error('所选后端不支持这个客户端。');
  const url = new URL(`${endpoint(backend)}/sub`);
  url.searchParams.set('target', target);
  url.searchParams.set('url', normalizeSources(sources, profile, target, options));
  if (config.trim()) {
    let template;
    try {
      template = new URL(config.trim());
    } catch {
      throw new Error('远程配置须为完整的 HTTP(S) URL。');
    }
    if (!['http:', 'https:'].includes(template.protocol)) throw new Error('远程配置只支持 HTTP(S)。');
    url.searchParams.set('config', config.trim());
  }
  if (target === 'surge' && ver !== '') {
    if (!['2', '3', '4', '5'].includes(String(ver))) throw new Error('Surge 版本须为 2～5。');
    url.searchParams.set('ver', String(ver));
  }
  for (const param of parametersFor(profile, target)) {
    let value = options[param.key];
    if (value === '' || value === undefined || value === null) continue;
    if (param.kind === 'bool') {
      if (![true, false, 'true', 'false'].includes(value)) throw new Error(`${param.label} 的值无效。`);
      value = String(value);
    } else {
      value = String(value).trim();
      if (!value) continue;
      if (param.kind === 'integer' && (!/^\d+$/.test(value) || Number(value) > 2147483647))
        throw new Error(`${param.label} 须为 0～2147483647 的整数。`);
      if (param.kind.startsWith('base64')) value = base64(value, param.kind === 'base64url');
    }
    url.searchParams.set(param.key, value);
  }
  if (
    profile === 'extended' &&
    [true, 'true'].includes(options.provider_proxy_direct) &&
    [true, 'true'].includes(options.list)
  )
    throw new Error('仅输出节点时无法使用 Provider 直连更新。');
  const headers = forwardedHeaders(url.searchParams.get('provider_headers'), headerValues);
  if (explain) {
    if (profile !== 'extended') throw new Error('转换诊断仅支持 Extended。');
    url.searchParams.set('explain', 'true');
  }
  return { url: url.href, headers };
}
