import { buildPoseidon } from 'circomlibjs';
import { EMBEDDING_SCALE_NUMBER, FIELD_SIZE } from './zkConfig.js';

let poseidonPromise;

function ensurePoseidon() {
  if (!poseidonPromise) {
    poseidonPromise = buildPoseidon();
  }
  return poseidonPromise;
}

export function randomHex(bytes = 16) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function toFieldElement(value) {
  let element = typeof value === 'bigint' ? value : BigInt(value);
  if (element < 0n) {
    element = (element % FIELD_SIZE + FIELD_SIZE) % FIELD_SIZE;
  } else if (element >= FIELD_SIZE) {
    element = element % FIELD_SIZE;
  }
  return element;
}

export function toFieldFromHex(hexValue) {
  const normalized = hexValue.startsWith('0x') ? hexValue : `0x${hexValue}`;
  return toFieldElement(BigInt(normalized));
}

export function quantizeEmbedding(descriptor) {
  const vector = descriptor instanceof Float32Array ? descriptor : new Float32Array(descriptor);
  return Array.from(vector, (value) => {
    const scaled = Math.round(value * EMBEDDING_SCALE_NUMBER);
    return toFieldElement(BigInt(scaled));
  });
}

async function poseidonHash(inputs) {
  const poseidon = await ensurePoseidon();
  const hash = poseidon(inputs);
  return BigInt(poseidon.F.toString(hash));
}

function toHex32(value) {
  return value.toString(16).padStart(64, '0');
}

export async function makeCommitment({ embeddingPrime, nonce, version }) {
  const hash = await poseidonHash([
    toFieldFromHex(embeddingPrime),
    toFieldFromHex(nonce),
    toFieldElement(version),
  ]);
  return toHex32(hash);
}

export async function makeCommitmentFromEmbedding({ descriptor, nonce, version }) {
  const embedding = quantizeEmbedding(descriptor);
  const hash = await poseidonHash([
    ...embedding,
    toFieldFromHex(nonce),
    toFieldElement(version),
  ]);
  return toHex32(hash);
}

export function mockEmbeddingPrime() {
  return randomHex(64);
}
