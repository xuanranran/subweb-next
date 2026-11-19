import { endpoint, forwardedHeaders, sourceLines } from './converter.js';
import { extractSubscriptionExpiry, extractSubscriptionTraffic, mergeSubscriptionInfo, subscriptionNodeNames, subscriptionTraffic, subStoreSubscription } from '../../services/mihomo-validator/subscription-expiry.mjs';
export { extractSubscriptionExpiry, subscriptionNodeNames };

const MAX_BYTES = 2 * 1024 * 1024;

export function subscriptionSources(input) {
  const seen = new Set();
  return sourceLines(input).flatMap((line, index) => {
    let rest = line;
    if (/^(?:%3c|<)?(?:provider|tag|interval|proxy_direct)%3a/i.test(rest)) {
      try { rest = decodeURIComponent(rest); } catch { return []; }
    }
    let label = '';
    let match;
    let bracketed = false;
    while ((match = /^(<?)(provider|tag|interval|proxy_direct):([^,]*),>?/i.exec(rest))) {
      if (match[1]) bracketed = true;
      if (match[2].toLowerCase() === 'provider') label = match[3].trim();
      rest = rest.slice(match[0].length);
    }
    if (bracketed && rest.endsWith('>')) rest = rest.slice(0, -1);
    try {
      const url = new URL(rest);
      if (!['http:', 'https:'].includes(url.protocol) || seen.has(url.href)) return [];
      seen.add(url.href);
      return [{ url: url.href, label: label || subStoreSubscription(url.href)?.name || `订阅 ${index + 1} · ${url.hostname}` }];
    } catch { return []; }
  });
}

async function readInfo(url, headers, signal) {
  const response = await fetch(url, {
    headers, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error('subscription-unavailable'); }
  const userinfo = response.headers.get('subscription-userinfo');
  const traffic = extractSubscriptionTraffic(userinfo);
  const headerExpiry = extractSubscriptionExpiry(userinfo);
  if (headerExpiry) { await response.body?.cancel(); return mergeSubscriptionInfo(headerExpiry, { traffic }); }
  const reader = response.body?.getReader();
  if (!reader) return mergeSubscriptionInfo(null, { traffic });
  let size = 0;
  let text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        if (traffic) return { traffic };
        throw new Error('subscription-too-large');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { await reader.cancel(); }
  if (/<!doctype|<html/i.test(text)) throw new Error('subscription-html');
  return mergeSubscriptionInfo(extractSubscriptionExpiry(userinfo, text), { traffic });
}

export async function readSubscriptionInfo(source, settings, signal) {
  const headers = forwardedHeaders(settings.options?.provider_headers, settings.headerValues);
  const subStore = subStoreSubscription(source);
  const canQueryService = settings.service && (subStore || new URL(source).protocol === 'https:');
  let result;
  let readable = false;
  try {
    // Source headers have priority and avoid backend-side node filtering when CORS allows access.
    result = await readInfo(source, headers, signal);
    readable = true;
    if (result?.text && (result.traffic || !canQueryService)) return result;
  } catch { /* Browser CORS / local-network restrictions can require the selected converter. */ }
  signal.throwIfAborted();
  const url = new URL(`${endpoint(settings.backend)}/sub`);
  for (const [name, value] of Object.entries({ target: 'mixed', url: source, list: 'true',
    append_info: 'true', fdn: 'false', emoji: 'false', remove_emoji: 'false',
    include: '.*', exclude: '^$', rename: '^$@' })) url.searchParams.set(name, value);
  // Explicit no-op filters also override backend defaults that commonly remove account-status nodes.
  // Do not forward templates, rename, include/exclude, or other conversion filters into an information query.
  for (const name of ['ua', 'agekey', 'token', 'provider_headers'])
    if (settings.options?.[name]) url.searchParams.set(name, settings.options[name]);
  let failure;
  try {
    result = mergeSubscriptionInfo(result, await readInfo(url.href, headers, signal));
    readable = true;
  } catch (error) { failure = error; }
  signal.throwIfAborted();
  if (result?.text && (result.traffic || !canQueryService)) return result;
  if (canQueryService) {
    try {
      const response = await fetch(`${endpoint(settings.service)}/subscription-info`, {
        method: 'POST', headers: { 'Content-Type': 'application/json',
          ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}) },
        body: JSON.stringify({ source }), credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
      });
      const payload = await response.json();
      if (!response.ok || payload.kind !== 'subscription-expiry') throw new Error('lookup-unavailable');
      const info = payload.info;
      if (info === null) return result || (subStore ? { missing: true, source: 'substore' } : null);
      const traffic = info?.traffic ? subscriptionTraffic(0, info.traffic.used, info.traffic.total) : null;
      // The service may run in UTC. Header timestamps must be formatted in the browser's timezone.
      let expiry = null;
      if (info?.source === 'header') expiry = extractSubscriptionExpiry(`expire=${info.timestamp}`);
      if (info?.source === 'node') {
        if (info.ambiguous === true) expiry = { source: 'node', ambiguous: true };
        else if (typeof info.text === 'string' && info.text.length <= 100) expiry = { source: 'node', text: info.text };
      }
      if (expiry && ['substore', 'substore-info'].includes(info.via)) expiry.via = info.via;
      if (!expiry && !traffic) throw new Error('lookup-invalid');
      return mergeSubscriptionInfo(result, mergeSubscriptionInfo(expiry, { traffic }));
    } catch { signal.throwIfAborted(); }
  }
  if (subStore) {
    return result || { missing: true, unavailable: true, source: 'substore' };
  }
  if (!readable && failure) throw failure;
  return result;
}

export function formatTraffic(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${Number(value.toFixed(2))} ${units[unit]}`;
}
