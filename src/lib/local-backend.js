export function currentSiteBackend(location) {
  try {
    const url = new URL(typeof location === 'string' ? location : location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
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
