#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v circom >/dev/null 2>&1; then
  echo "circom is not installed. Install circom (https://docs.circom.io/getting-started/installation/) and retry." >&2
  exit 1
fi

npm install

node scripts/compute_commitment.js input.example.json input.json

circom face_identity.circom --r1cs --wasm --sym -l node_modules
node face_identity_js/generate_witness.js face_identity_js/face_identity.wasm input.json witness.wtns

npx snarkjs powersoftau new bn128 12 pot12_0000.ptau -v
npx snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau --name="demo" -v -e="face-identity-demo"
npx snarkjs powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau -v

npx snarkjs groth16 setup face_identity.r1cs pot12_final.ptau face_identity_0000.zkey
npx snarkjs zkey export verificationkey face_identity_0000.zkey verification_key.json
npx snarkjs groth16 prove face_identity_0000.zkey witness.wtns proof.json public.json
npx snarkjs groth16 verify verification_key.json public.json proof.json
