import { endpoint, base64 } from './converter.js';

export async function fetchText(url, headers = {}, timeout = 25000) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeout), cache: 'no-store', credentials: 'omit' });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}：${/<!doctype|<html/i.test(text) ? '后端返回了验证或错误页面，请先在浏览器检查后端地址。' : text.slice(0, 180) || response.statusText}`);
  if (/<!doctype|<html/i.test(text)) throw new Error('返回的是网页，请检查 Cloudflare 验证或后端地址。');
  return { text, response };
}

export async function readVersion(backend) {
  const response = await fetch(`${endpoint(backend)}/version`, { signal: AbortSignal.timeout(10000), cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const raw = await response.text();
  if (/just a moment|cf-chl-|cloudflare.*ray id|verify you are human/i.test(raw)) throw new Error('Cloudflare 验证页面');
  const plain = raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/subconverter|\bv\d+\.\d+/i.test(plain)) throw new Error('未识别的版本响应');
  return plain.slice(0, 220);
}

export async function createShortLink(service, longUrl) {
  const form = new FormData();
  form.append('longUrl', base64(longUrl));
  const response = await fetch(`${endpoint(service)}/short`, { method: 'POST', body: form, credentials: 'omit', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`短链服务 HTTP ${response.status}`);
  let data;
  try { data = await response.json(); } catch { throw new Error('短链服务返回的不是 JSON，请检查验证页面。'); }
  if (data.Code !== 1 || typeof data.ShortUrl !== 'string' || !/^https?:\/\//.test(data.ShortUrl)) throw new Error(data.Message || '短链服务未返回有效链接。');
  return data.ShortUrl;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* HTTP LAN fallback */ }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.append(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('复制失败，请手动选择链接复制。');
}
