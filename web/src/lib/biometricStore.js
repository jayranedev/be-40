const STORAGE_PREFIX = 'faceid-template:';
const STORAGE_ENCRYPTED_PREFIX = 'faceid-template-enc:';
const encoder = new TextEncoder();

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

function toBase64(bytes) {
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(passphrase, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptTemplate({ descriptor, passphrase }) {
  const vector = descriptor instanceof Float32Array ? descriptor : new Float32Array(descriptor);
  const bytes = new Uint8Array(vector.buffer);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, bytes);
  return {
    v: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptTemplate({ payload, passphrase }) {
  const salt = fromBase64(payload.salt);
  const iv = fromBase64(payload.iv);
  const data = fromBase64(payload.data);
  const cryptoKey = await deriveKey(passphrase, salt);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, data);
  return new Float32Array(plaintext);
}

export async function saveEncryptedTemplate({ wallet, descriptor, passphrase }) {
  const key = `${STORAGE_ENCRYPTED_PREFIX}${wallet.toLowerCase()}`;
  const payload = await encryptTemplate({ descriptor, passphrase });
  localStorage.setItem(key, JSON.stringify(payload));
  return payload;
}

export async function loadEncryptedTemplate({ wallet, passphrase }) {
  const key = `${STORAGE_ENCRYPTED_PREFIX}${wallet.toLowerCase()}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return await decryptTemplate({ payload: parsed, passphrase });
  } catch (error) {
    return null;
  }
}

export function hasTemplate(wallet) {
  const key = `${STORAGE_PREFIX}${wallet.toLowerCase()}`;
  return Boolean(localStorage.getItem(key));
}

export function hasEncryptedTemplate(wallet) {
  const key = `${STORAGE_ENCRYPTED_PREFIX}${wallet.toLowerCase()}`;
  return Boolean(localStorage.getItem(key));
}
