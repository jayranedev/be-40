const STORAGE_PREFIX = 'faceid-template:';

export function saveTemplate(wallet, descriptor) {
  const key = `${STORAGE_PREFIX}${wallet.toLowerCase()}`;
  const data = Array.from(descriptor);
  localStorage.setItem(key, JSON.stringify({ descriptor: data }));
}

export function loadTemplate(wallet) {
  const key = `${STORAGE_PREFIX}${wallet.toLowerCase()}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return new Float32Array(parsed.descriptor);
  } catch (error) {
    return null;
  }
}
