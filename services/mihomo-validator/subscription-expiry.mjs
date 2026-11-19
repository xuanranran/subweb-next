import { parse } from 'yaml';

const MAX_BYTES = 2 * 1024 * 1024;
const EXPIRY_LABEL = /(?:到期(?:时间|日期)?|过期(?:时间|日期)?|有效期(?:至|截止)?|有效至|截止(?:时间|日期)?|expir(?:e[sd]?|y|ation)(?:\s*(?:time|date))?)\s*[:：=]?\s*/i;

export function subStoreSubscription(source) {
  try {
    const url = new URL(source);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || source.length > 4096) return null;
    const match = /^(.*)\/download\/([^/]+)(?:\/[^/]+)?\/?$/.exec(url.pathname);
    if (!match || match[2] === 'collection') return null;
    const name = decodeURIComponent(match[2]);
    if (!name || /[/\\\0]/.test(name) || ['.', '..'].includes(name)) return null;
    url.pathname = `${match[1]}/api/sub/${encodeURIComponent(name)}`;
    url.search = ''; url.hash = '';
    return { api: url.href, name };
  } catch { return null; }
}

function decodeBase64(value) {
  try {
    const encoded = value.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return '';
    const binary = atob(encoded + '='.repeat((4 - encoded.length % 4) % 4));
    return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch { return ''; }
}

function decodeName(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function subscriptionNodeNames(content) {
  if (typeof content !== 'string' || content.length > MAX_BYTES) return [];
  let text = content.trim();
  // Standard / URL-safe Base64 subscription wrappers contain UTF-8 protocol links.
  if (/^[A-Za-z\d+/_=\s-]+$/.test(text)) text = decodeBase64(text);
  if (!text || /<!doctype|<html/i.test(text)) return [];
  if (!/^[a-z][a-z\d+.-]*:\/\//im.test(text)) {
    try {
      const data = parse(text, { maxAliasCount: 0 });
      const nodes = Array.isArray(data) ? data : data?.proxies || data?.outbounds || data?.servers;
      return Array.isArray(nodes)
        ? nodes.slice(0, 10000).flatMap((node) => typeof (node?.name ?? node?.tag ?? node?.remarks) === 'string'
          ? [node.name ?? node.tag ?? node.remarks] : []) : [];
    } catch { return []; }
  }
  return text.split(/\r?\n/).slice(0, 10000).flatMap((line) => {
    const uri = line.trim();
    if (/^ssr:\/\//i.test(uri)) {
      const decoded = decodeBase64(uri.slice(6));
      const query = decoded.split('/?')[1] || '';
      const remarks = new URLSearchParams(query).get('remarks');
      return remarks ? [decodeBase64(remarks.replace(/ /g, '+'))] : [];
    }
    if (/^vmess:\/\//i.test(uri)) {
      try { return [JSON.parse(decodeBase64(uri.slice(8))).ps || '']; } catch { return []; }
    }
    const hash = uri.indexOf('#');
    return hash >= 0 ? [decodeName(uri.slice(hash + 1))] : [];
  });
}

function dateInName(name) {
  const label = EXPIRY_LABEL.exec(name);
  if (!label) return null;
  const value = name.slice(label.index + label[0].length).trim();
  if (/^(?:永久|长期|无限期|不限|无期限|never|unlimited|forever)/i.test(value))
    return { text: '长期有效', source: 'node' };
  const match = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?)?(?!\d)/i.exec(value);
  if (!match) return null;
  const [, y, m, d, h, minute, second, zone] = match;
  const check = new Date(Date.UTC(+y, +m - 1, +d, +(h || 0), +(minute || 0), +(second || 0)));
  if (+y < 1900 || +y > 9999 || check.getUTCFullYear() !== +y || check.getUTCMonth() !== +m - 1 ||
      check.getUTCDate() !== +d || check.getUTCHours() !== +(h || 0) ||
      check.getUTCMinutes() !== +(minute || 0) || check.getUTCSeconds() !== +(second || 0)) return null;
  if (zone && zone !== 'Z' && !/^[+-](?:0\d|1[0-4]):?[0-5]\d$/.test(zone)) return null;
  const pad = (part) => String(part).padStart(2, '0');
  return { text: `${y}-${pad(m)}-${pad(d)}${h === undefined ? '' : ` ${pad(h)}:${minute}${second === undefined ? '' : `:${second}`}`}${zone ? ` ${zone}` : ''}`, source: 'node' };
}

export function extractSubscriptionExpiry(userinfo, content = '') {
  const expire = String(userinfo || '').match(/(?:^|;)\s*expire\s*=\s*(\d+)\s*(?=;|$)/i)?.[1];
  if (expire && Number.isSafeInteger(+expire) && +expire > 0) {
    const date = new Date(+expire * 1000);
    if (Number.isFinite(date.getTime()) && date.getFullYear() <= 9999) {
      const pad = (part) => String(part).padStart(2, '0');
      return { text: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`, source: 'header', timestamp: +expire };
    }
  }
  const candidates = subscriptionNodeNames(content).map(dateInName).filter(Boolean);
  const unique = [...new Map(candidates.map((candidate) => [candidate.text, candidate])).values()];
  // A collection may include several account dates. Do not guess which one is the subscription expiry.
  return unique.length === 1 ? unique[0] : unique.length > 1 ? { source: 'node', ambiguous: true } : null;
}

export function subscriptionTraffic(upload = 0, download, total) {
  const values = [upload, download, total];
  if (!values.every((value) => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER)) return null;
  const used = upload + download;
  return used <= Number.MAX_SAFE_INTEGER ? { used, total } : null;
}

export function extractSubscriptionTraffic(userinfo) {
  if (typeof userinfo !== 'string') return null;
  const fields = new Map(userinfo.split(';').map((item) => {
    const [key, value] = item.trim().split('=', 2);
    return [key.trim().toLowerCase(), value?.trim()];
  }));
  const number = (key) => {
    const value = fields.get(key);
    return /^\+?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : NaN;
  };
  return subscriptionTraffic(fields.has('upload') ? number('upload') : 0, number('download'), number('total'));
}

export function mergeSubscriptionInfo(first, second) {
  // Quota and expiry can come from different sources. A timestamp outranks a node label.
  const expiry = [first, second].find((info) => info?.source === 'header')
    ?? [first, second].find((info) => info?.text)
    ?? [first, second].find((info) => info?.ambiguous || info?.missing);
  const traffic = first?.traffic ?? second?.traffic;
  if (!expiry && !traffic) return null;
  return { ...expiry, ...(traffic ? { traffic } : {}) };
}
