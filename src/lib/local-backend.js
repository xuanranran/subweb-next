// Visibility follows the user's address list, not DNS resolution or backend identity.
export const LOCAL_BACKEND_NETWORKS = Object.freeze([
  '::/128',
  '::1/128',
  '2001::/32',
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '255.255.255.255/32',
]);

function parseIP(host) {
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host.includes(':')) {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
    const octets = host.split('.').map(Number);
    if (octets.some((part) => part > 255)) return null;
    return { bits: 32, value: octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n) };
  }
  if (!/^[0-9a-f:]+$/i.test(host)) return null;
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 2 && missing < 1) || (halves.length === 1 && missing !== 0)) return null;
  const words = [...left, ...Array(missing).fill('0'), ...right];
  if (words.some((word) => !/^[0-9a-f]{1,4}$/i.test(word))) return null;
  return { bits: 128, value: BigInt('0x' + words.map((word) => word.padStart(4, '0')).join('')) };
}

const networks = LOCAL_BACKEND_NETWORKS.map((cidr) => {
  const [host, prefix] = cidr.split('/');
  const address = parseIP(host);
  const shift = BigInt(address.bits - Number(prefix));
  return { bits: address.bits, shift, prefix: address.value >> shift };
});

export function currentSiteBackend(location) {
  try {
    const url = new URL(typeof location === 'string' ? location : location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const address = parseIP(url.hostname);
    if (
      !address ||
      !networks.some(
        (network) => network.bits === address.bits && address.value >> network.shift === network.prefix,
      )
    )
      return null;
    return {
      id: 'local',
      text: '本地后端',
      value: url.origin,
      profile: 'standard',
      local: true,
    };
  } catch {
    return null;
  }
}

export function versionProfile(version) {
  const text = String(version || '').trim();
  if (/^SubConverter-Extended\b/i.test(text)) return 'extended';
  if (/^subconverter(?:\s|$)/i.test(text)) return 'standard';
  return null;
}
