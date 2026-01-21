# Face match ZK circuit

This directory contains the Circom circuit used to prove a face match within a
distance threshold while keeping the enrolled and live embeddings private.

## Circuit overview

`face_match.circom` checks that:

1. The enrolled embedding + nonce + version hashes to the on-chain commitment via Poseidon.
2. The squared L2 distance between the live and enrolled embedding vectors is
   less than or equal to the public `distanceThreshold`.

Public signals (in order):

1. `faceCommitment`
2. `distanceThreshold`

Private inputs:

- `liveEmbedding[128]` (scaled integers)
- `enrolledEmbedding[128]` (scaled integers)
- `nonce`
- `version`

## Build artifacts

```bash
circom face_match.circom --r1cs --wasm --sym
snarkjs groth16 setup face_match.r1cs pot12_final.ptau face_match_0000.zkey
snarkjs zkey contribute face_match_0000.zkey face_match.zkey
snarkjs zkey export verificationkey face_match.zkey verification_key.json
snarkjs zkey export solidityverifier face_match.zkey FaceMatchVerifier.sol
```

Place `face_match.wasm` and `face_match.zkey` in `web/public/zk/` so the web UI
can generate proofs using `snarkjs`.
