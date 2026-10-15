import { endpoint } from './converter.js';

export function supportsMihomoValidation(target, options = {}) {
  return ['clash', 'clashr'].includes(target) &&
    ![true, 'true'].includes(options.list) && ![true, 'true'].includes(options.script);
}

export async function validateMihomoConfig(service, config, token = '', signal) {
  const address = endpoint(service);
  if (!config.trim()) throw new Error('转换结果为空，无法校验。');
  if (new TextEncoder().encode(config).length > 4 * 1024 * 1024)
    throw new Error('配置超过 4 MiB，无法提交校验。');
  let response;
  try { response = await fetch(`${address}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ config }),
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000),
  }); } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('校验服务响应超时，未完成校验。');
    if (error instanceof TypeError)
      throw new Error('无法连接校验服务，请检查服务地址、来源白名单、HTTPS 和浏览器本地网络权限。');
    throw error;
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error('校验服务未返回 JSON，请检查服务地址或验证页面。'); }
  if (!response.ok) throw new Error(result.error || `校验服务 HTTP ${response.status}`);
  if (result.engine !== 'mihomo' || result.mode !== 'config-test' || typeof result.valid !== 'boolean' ||
      typeof result.version !== 'string' || typeof result.output !== 'string')
    throw new Error('校验服务响应格式不正确。');
  return result;
}
