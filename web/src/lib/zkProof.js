import { groth16 } from 'snarkjs';
import { DISTANCE_THRESHOLD, DEFAULT_WASM_URL, DEFAULT_ZKEY_URL } from './zkConfig.js';
import { quantizeEmbedding, toFieldElement, toFieldFromHex } from './crypto.js';

function toBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  return BigInt(value);
}

export function buildFaceMatchInputs({
  liveDescriptor,
  enrolledDescriptor,
  nonce,
  version,
  distanceThreshold = DISTANCE_THRESHOLD,
}) {
  return {
    liveEmbedding: quantizeEmbedding(liveDescriptor).map((value) => value.toString()),
    enrolledEmbedding: quantizeEmbedding(enrolledDescriptor).map((value) => value.toString()),
    nonce: toFieldFromHex(nonce).toString(),
    version: toFieldElement(version).toString(),
    distanceThreshold: toBigInt(distanceThreshold).toString(),
  };
}

export async function generateFaceProof({
  liveDescriptor,
  enrolledDescriptor,
  nonce,
  version,
  distanceThreshold,
  wasmUrl = DEFAULT_WASM_URL,
  zkeyUrl = DEFAULT_ZKEY_URL,
}) {
  const input = buildFaceMatchInputs({
    liveDescriptor,
    enrolledDescriptor,
    nonce,
    version,
    distanceThreshold,
  });
  const { proof, publicSignals } = await groth16.fullProve(input, wasmUrl, zkeyUrl);
  return { proof, publicSignals };
}

export function formatProofForSolidity(proof) {
  const a = [toBigInt(proof.pi_a[0]), toBigInt(proof.pi_a[1])];
  const b = [
    [toBigInt(proof.pi_b[0][1]), toBigInt(proof.pi_b[0][0])],
    [toBigInt(proof.pi_b[1][1]), toBigInt(proof.pi_b[1][0])],
  ];
  const c = [toBigInt(proof.pi_c[0]), toBigInt(proof.pi_c[1])];
  return { a, b, c };
}
