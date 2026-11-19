import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { extractSubscriptionExpiry, extractSubscriptionTraffic, mergeSubscriptionInfo, subStoreSubscription, subscriptionTraffic } from './subscription-expiry.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const blocked = new BlockList();
for (const [address, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) {
  blocked.addSubnet(address, bits, 'ipv4');
}
for (const [address, bits] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  blocked.addSubnet(address, bits, 'ipv6');
}
const globalIPv6 = new BlockList();
globalIPv6.addSubnet('2000::', 3, 'ipv6');

export function publicSubscriptionUrl(source) {
  try {
    const url = new URL(source);
    if (source.length > 4096 || url.protocol !== 'https:' || url.port || url.username || url.password ||
        isIP(url.hostname.replace(/^\[|\]$/g, '')) || !url.hostname.includes('.')) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

export function isPublicAddress({ address, family }) {
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && globalIPv6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

const fakeIPv4 = new BlockList();
fakeIPv4.addSubnet('198.18.0.0', 15, 'ipv4');

async function publicUserinfo(url, signal, resolveFakeDns) {
  let addresses = await lookup(url.hostname, { all: true });
  signal.throwIfAborted();
  if (resolveFakeDns && addresses.length && addresses.every(({ address, family }) => family === 4 && fakeIPv4.check(address))) {
    // Some local proxy setups return synthetic IPs. Resolve only the hostname, never the subscription URL.
    const query = new URL('https://cloudflare-dns.com/dns-query');
    query.searchParams.set('name', url.hostname);
    query.searchParams.set('type', 'A');
    const response = await fetch(query, { headers: { Accept: 'application/dns-json' }, signal, redirect: 'error' });
    const answer = JSON.parse(await readText(response));
    addresses = (Array.isArray(answer.Answer) ? answer.Answer : [])
      .filter((record) => record.type === 1 && isIP(record.data) === 4)
      .map((record) => ({ address: record.data, family: 4 }));
  }
  if (!addresses.length || !addresses.every(isPublicAddress)) return null;
  const destination = addresses.find(({ family }) => family === 4) ?? addresses[0];
  const readHeader = (method) => new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method, signal, agent: false, headers: { 'User-Agent': 'Clash' },
      // Pin the checked IP while retaining the original host for TLS and HTTP.
      lookup: (_, options, callback) => {
        if (options.all) callback(null, [destination]);
        else callback(null, destination.address, destination.family);
      },
    }, (response) => {
      const ok = response.statusCode >= 200 && response.statusCode < 300;
      resolve(ok ? response.headers['subscription-userinfo'] : null);
      response.destroy();
    });
    req.on('error', reject);
    req.end();
  });
  const head = await readHeader('HEAD');
  const info = mergeSubscriptionInfo(extractSubscriptionExpiry(head), { traffic: extractSubscriptionTraffic(head) });
  if (info?.timestamp && info.traffic) return info;
  try {
    const get = await readHeader('GET');
    const fallback = mergeSubscriptionInfo(extractSubscriptionExpiry(get), { traffic: extractSubscriptionTraffic(get) });
    return mergeSubscriptionInfo(fallback, info);
  } catch (error) {
    if (info) return info;
    throw error;
  }
}

async function readText(response) {
  if (!response.ok) { await response.body?.cancel(); throw new Error('resource-unavailable'); }
  const reader = response.body?.getReader();
  if (!reader) return '';
  let text = '', size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('resource-too-large');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel(); }
}

export async function lookupSubStoreExpiry(source, signal, fetcher = fetch) {
  const target = subStoreSubscription(source);
  if (!target) throw Object.assign(new Error('只支持单个 Sub-Store 订阅的导出链接。'), { status: 400 });
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  const request = (url, headers = {}) => fetcher(url, {
    headers, signal: timeout, credentials: 'omit', cache: 'no-store', redirect: 'follow',
  });
  const readRemoteExpiry = async (url, ua = 'Clash') => {
    const response = await request(url, { 'User-Agent': ua });
    const userinfo = response.headers.get('subscription-userinfo');
    const header = extractSubscriptionExpiry(userinfo);
    const traffic = extractSubscriptionTraffic(userinfo);
    if (header && response.ok) {
      await response.body?.cancel();
      return mergeSubscriptionInfo(header, { traffic });
    }
    return mergeSubscriptionInfo(extractSubscriptionExpiry('', await readText(response)), { traffic });
  };
  // Only read this named subscription, never the list of subscriptions or global settings.
  const payload = JSON.parse(await readText(await request(target.api)));
  const sub = payload?.status === 'success' && payload.data?.name === target.name ? payload.data : null;
  if (!sub) return null;
  const override = extractSubscriptionExpiry(sub.subUserinfo);
  let traffic = extractSubscriptionTraffic(sub.subUserinfo);
  if (override) return { ...mergeSubscriptionInfo(override, { traffic }), via: 'substore-info' };
  // Local/script subscriptions can keep account information at a separate URL.
  // Its header overrides node contents, just like Sub-Store's own subscription card.
  if (typeof sub.subUserinfo === 'string') {
    try {
      const infoUrl = new URL(sub.subUserinfo.trim());
      if (['http:', 'https:'].includes(infoUrl.protocol) && !infoUrl.username && !infoUrl.password && infoUrl.href !== source) {
        infoUrl.hash = '';
        const info = await readRemoteExpiry(infoUrl.href);
        if (info?.text) return { ...info, via: 'substore-info' };
        traffic = info?.traffic ?? traffic;
      }
    } catch { timeout.throwIfAborted(); }
  }
  if (sub.source === 'local') {
    const info = extractSubscriptionExpiry('', sub.content);
    return mergeSubscriptionInfo(info && { ...info, via: 'substore' }, { traffic });
  }
  const sources = [...new Set(String(sub.url || '').split(/\r?\n/).flatMap((line) => {
    try {
      const url = new URL(line.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return [];
      url.hash = ''; // Sub-Store's fragment arguments are metadata, never scripts to execute here.
      return url.href === source ? [] : [url.href];
    } catch { return []; }
  }))];
  if (!sources.length || sources.length > 4) return mergeSubscriptionInfo(null, { traffic });
  const results = [];
  for (const url of sources) {
    timeout.throwIfAborted();
    try {
      const ua = typeof sub.ua === 'string' && sub.ua.length <= 512 && !/[\r\n\0]/.test(sub.ua) ? sub.ua : 'Clash';
      const info = await readRemoteExpiry(url, ua || 'Clash');
      if (!info) return null; // An aggregate is not known when any of its sources is unknown.
      if (sources.length === 1) return mergeSubscriptionInfo({ ...info, via: 'substore' }, { traffic });
      if (info.ambiguous) return mergeSubscriptionInfo({ ...info, traffic: undefined, via: 'substore' }, { traffic });
      if (!info.text) return mergeSubscriptionInfo(null, { traffic });
      results.push({ text: info.text, source: info.source, timestamp: info.timestamp });
    } catch { timeout.throwIfAborted(); return mergeSubscriptionInfo(null, { traffic }); }
  }
  const unique = [...new Map(results.map((info) => [info.timestamp || info.text, info])).values()];
  const expiry = unique.length === 1 ? { ...unique[0], via: 'substore' }
    : { source: 'node', ambiguous: true, via: 'substore' };
  return mergeSubscriptionInfo(expiry, { traffic });
}

export async function lookupSubscriptionInfo(source, signal, { subStore = false, fetcher = fetch, resolveFakeDns = false } = {}) {
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  const target = subStore ? subStoreSubscription(source) : null;
  if (!target) {
    const url = publicSubscriptionUrl(source);
    return url ? publicUserinfo(url, timeout, resolveFakeDns) : null;
  }
  const flowUrl = new URL(target.api);
  flowUrl.pathname = flowUrl.pathname.replace(/\/([^/]+)$/, '/flow/$1');
  let info = null;
  try {
    const response = await fetcher(flowUrl, { signal: timeout, credentials: 'omit', cache: 'no-store', redirect: 'error' });
    const payload = JSON.parse(await readText(response));
    const data = payload?.status === 'success' ? payload.data : null;
    if (data) {
      const expiry = extractSubscriptionExpiry(`expire=${data.expires}`);
      const traffic = subscriptionTraffic(data.usage?.upload, data.usage?.download, data.total);
      info = mergeSubscriptionInfo(expiry && { ...expiry, via: 'substore-info' }, { traffic });
    }
  } catch { signal.throwIfAborted(); }
  if (info?.timestamp && info.traffic) return info;
  try {
    return mergeSubscriptionInfo(info, await lookupSubStoreExpiry(source, timeout, fetcher));
  } catch (error) {
    signal.throwIfAborted();
    if (info) return info;
    throw error;
  }
}
