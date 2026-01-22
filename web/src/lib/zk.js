import { groth16 } from 'snarkjs';
import {
  addressToField,
  nonceToField,
  poseidonHash,
  poseidonHashEmbedding,
  quantizeEmbeddingToField,
} from './crypto.js';

const wasmPath = import.meta.env.VITE_ZK_WASM_PATH || '/zk/face_auth.wasm';
const zkeyPath = import.meta.env.VITE_ZK_ZKEY_PATH || '/zk/face_auth.zkey';
const vkeyPath = import.meta.env.VITE_ZK_VKEY_PATH || '/zk/face_auth.vkey.json';

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
}

export async function generateAuthProof({ descriptor, wallet, commitment, nonce }) {
  const embeddingField = quantizeEmbeddingToField(descriptor);
  const embeddingHash = await poseidonHashEmbedding(descriptor);
  const walletField = addressToField(wallet);
  const nonceField = nonceToField(nonce);
  const computedCommitment = await poseidonHash([embeddingHash, walletField, nonceField]);
  const commitmentHex = commitment?.startsWith('0x') ? commitment.slice(2) : commitment;
  const expectedCommitment = commitmentHex
    ? BigInt(`0x${commitmentHex}`)
    : computedCommitment;
  if (expectedCommitment !== computedCommitment) {
    throw new Error('Commitment mismatch. Recompute enrollment commitment.');
  }
  const input = {
    wallet: walletField.toString(),
    nonce: nonceField.toString(),
    commitment: expectedCommitment.toString(),
    embedding: embeddingField.map((value) => value.toString()),
  };
  const { proof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);
  return { proof, publicSignals, input };
}

export async function verifyAuthProof({ proof, publicSignals }) {
  const vkey = await loadJson(vkeyPath);
  return groth16.verify(vkey, publicSignals, proof);
}

export async function exportProofCalldata({ proof, publicSignals }) {
  const calldata = await groth16.exportSolidityCallData(proof, publicSignals);
  const args = calldata
    .replace(/[\[\]\s"]/g, '')
    .split(',')
    .map((value) => BigInt(value));
  const a = [args[0], args[1]];
  const b = [
    [args[2], args[3]],
    [args[4], args[5]],
  ];
  const c = [args[6], args[7]];
  const input = [args[8], args[9], args[10]];
  return { a, b, c, input };
}
