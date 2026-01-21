const STORAGE_PREFIX = 'faceid-template:';

export function saveTemplate(wallet, template) {
  const key = `${STORAGE_PREFIX}${wallet.toLowerCase()}`;
  const data = Array.from(template.descriptor);
  const payload = {
    descriptor: data,
    nonce: template.nonce,
    version: template.version,
  };
  localStorage.setItem(key, JSON.stringify(payload));
}

export function loadTemplate(wallet) {
  const key = `${STORAGE_PREFIX}${wallet.toLowerCase()}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      descriptor: new Float32Array(parsed.descriptor),
      nonce: parsed.nonce,
      version: parsed.version ?? 1,
    };
  } catch (error) {
    return null;
  }
}
