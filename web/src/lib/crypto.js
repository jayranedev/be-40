export function randomHex(bytes = 16) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256HexBytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function makeCommitment({ embeddingPrime, nonce, version }) {
  return sha256Hex(`${embeddingPrime}:${nonce}:${version}`);
}

export async function makeCommitmentFromEmbedding({ descriptor, nonce, version }) {
  const vector = descriptor instanceof Float32Array ? descriptor : new Float32Array(descriptor);
  const bytes = new Uint8Array(vector.buffer);
  const embeddingHash = await sha256HexBytes(bytes);
  return sha256Hex(`${embeddingHash}:${nonce}:${version}`);
}

export function mockEmbeddingPrime() {
  return randomHex(64);
}
