# Face Identity ZK Proof (Circom + zk-SNARK)

This circuit proves a user knows a face embedding that matches a previously registered commitment, without revealing the embedding. The face image itself is **never** placed on-chain; the embedding is computed off-chain using a face recognition model and then committed inside the circuit.

## How it works

1. **Off-chain**: Compute a face embedding from a user-provided face image using a face-recognition model (e.g., FaceNet, ArcFace).
2. **Registration**: Create a commitment `C = Poseidon(embedding..., salt)` and store `C` as the user's identity anchor (e.g., in a smart contract or registry).
3. **Proof**: The user generates a zk-SNARK proof that they know an `embedding` and `salt` such that `Poseidon(embedding..., salt) == C`.
4. **Verification**: Verifier checks the proof against the public input `C`, confirming the prover has a valid face embedding without revealing it.

## Circuit

`face_identity.circom` defines a `FaceIdentity` template that:
- Accepts `embedding[128]` and `salt` as **private** inputs.
- Accepts `expectedCommitment` as a **public** input.
- Asserts `Poseidon(embedding..., salt) == expectedCommitment`.

## Example input

Create an input file like this (note: the numbers are placeholders):

```json
{
  "embedding": [
    123, 456, 789, 101, 112, 131, 415, 161,
    718, 192, 202, 212, 222, 232, 242, 252,
    262, 272, 282, 292, 303, 313, 323, 333,
    343, 353, 363, 373, 383, 393, 404, 414,
    424, 434, 444, 454, 464, 474, 484, 494,
    505, 515, 525, 535, 545, 555, 565, 575,
    585, 595, 606, 616, 626, 636, 646, 656,
    666, 676, 686, 696, 707, 717, 727, 737,
    747, 757, 767, 777, 787, 797, 808, 818,
    828, 838, 848, 858, 868, 878, 888, 898,
    909, 919, 929, 939, 949, 959, 969, 979,
    989, 999, 1009, 1019, 1029, 1039, 1049, 1059,
    1069, 1079, 1089, 1099, 1109, 1119, 1129, 1139,
    1149, 1159, 1169, 1179, 1189, 1199, 1209, 1219,
    1229, 1239, 1249, 1259, 1269, 1279, 1289, 1299,
    1309, 1319, 1329, 1339, 1349, 1359, 1369, 1379
  ],
  "salt": 42,
  "expectedCommitment": 0
}
```

Replace `expectedCommitment` with the Poseidon hash of the embedding and salt (computed off-chain). Make sure your embedding values are field elements (e.g., scale and quantize float embeddings into integers).

## Example workflow (snarkjs)

```bash
# 1) Compile the circuit
circom face_identity.circom --r1cs --wasm --sym

# 2) Generate a witness
node face_identity_js/generate_witness.js face_identity_js/face_identity.wasm input.json witness.wtns

# 3) Setup (powers of tau)
# (Use an appropriate ceremony or a trusted setup in production)

# 4) Prove and verify (Groth16 example)
# snarkjs groth16 setup face_identity.r1cs pot12_final.ptau face_identity_0000.zkey
# snarkjs groth16 prove face_identity_0000.zkey witness.wtns proof.json public.json
# snarkjs groth16 verify verification_key.json public.json proof.json
```

## Security & privacy notes

- **Never** store or share raw face images on-chain.
- Use strong salting and consider key-derivation/hardware-backed secrets for the salt.
- The embedding model and preprocessing must be consistent across registration and verification.
- Face embeddings are biometric data; handle them according to privacy regulations.

## Demo for others (step-by-step)

Use this flow to show a live demo to classmates or reviewers. It avoids exposing the face image by using a precomputed embedding.

1. **Prepare a demo embedding**
   - Use the sample `input.example.json` as a stand-in, or replace the `embedding` array with one you computed off-chain.
   - Pick a random `salt` (keep it private) and compute the Poseidon commitment off-chain.
   - Update `expectedCommitment` in the JSON to the computed value.

2. **Compile and generate proof**

```bash
# From the zk/ directory
circom face_identity.circom --r1cs --wasm --sym
node face_identity_js/generate_witness.js face_identity_js/face_identity.wasm input.example.json witness.wtns

# Example Groth16 flow
snarkjs groth16 setup face_identity.r1cs pot12_final.ptau face_identity_0000.zkey
snarkjs zkey export verificationkey face_identity_0000.zkey verification_key.json
snarkjs groth16 prove face_identity_0000.zkey witness.wtns proof.json public.json
snarkjs groth16 verify verification_key.json public.json proof.json
```

3. **What to show during the demo**
   - Show the **public commitment** (`expectedCommitment`) that was registered.
   - Show that the proof verifies successfully without revealing the face embedding.
   - Explain that the embedding would come from a face model (e.g., FaceNet/ArcFace) and the raw image never leaves the device.

4. **Talking points**
   - The verifier only learns the commitment and a valid proof, not the face data.
   - The same commitment can be checked across services without sharing biometrics.
   - This demo proves knowledge of the embedding; production systems should add liveness checks and secure enrollment.
