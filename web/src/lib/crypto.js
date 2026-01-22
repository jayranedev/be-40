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

let poseidonPromise;

const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const EMBEDDING_SIZE = 128;
const EMBEDDING_SCALE = 1000000n;

async function getPoseidon() {
  if (!poseidonPromise) {
    poseidonPromise = import('circomlibjs').then((mod) => mod.buildPoseidon());
  }
  return poseidonPromise;
}

function toField(value) {
  const modded = value % FIELD_MODULUS;
  return modded >= 0n ? modded : modded + FIELD_MODULUS;
}

export function addressToField(address) {
  const hex = address.toLowerCase().replace(/^0x/, '');
  return toField(BigInt(`0x${hex}`));
}

export function nonceToField(nonceHex) {
  return toField(BigInt(`0x${nonceHex}`));
}

export function quantizeEmbeddingToField(descriptor) {
  const vector = descriptor instanceof Float32Array ? descriptor : new Float32Array(descriptor);
  if (vector.length !== EMBEDDING_SIZE) {
    throw new Error(`Embedding must be ${EMBEDDING_SIZE} values.`);
  }
  return Array.from(vector, (value) => {
    const scaled = BigInt(Math.round(value * Number(EMBEDDING_SCALE)));
    return toField(scaled);
  });
}

export function bigIntToHex32(value) {
  const hex = value.toString(16).padStart(64, '0');
  return hex.slice(-64);
}

export async function poseidonHash(inputs) {
  const poseidon = await getPoseidon();
  const result = poseidon(inputs);
  return BigInt(poseidon.F.toString(result));
}

export async function poseidonHashEmbedding(descriptor) {
  const values = quantizeEmbeddingToField(descriptor);
  if (values.length % 2 !== 0) {
    throw new Error('Embedding length must be even for pairwise hash.');
  }
  let level = values;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(await poseidonHash([level[i], level[i + 1]]));
    }
    level = next;
  }
  return level[0];
}

export async function makeCommitmentFromEmbedding({ descriptor, wallet, nonce }) {
  const embeddingHash = await poseidonHashEmbedding(descriptor);
  const walletField = addressToField(wallet);
  const nonceField = nonceToField(nonce);
  const commitmentField = await poseidonHash([embeddingHash, walletField, nonceField]);
  return bigIntToHex32(commitmentField);
}

export function mockEmbeddingPrime() {
  return randomHex(64);
}
