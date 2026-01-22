# Face Auth Circuit

This circuit proves knowledge of a face embedding that matches an on-chain commitment.

Public inputs:
- `wallet`
- `nonce`
- `commitment`

Private inputs:
- `embedding[128]` (quantized field elements)

Circuit:
- `embeddingHash` is computed by pairwise Poseidon(2) reduction over 128 inputs.
- `commitment = Poseidon(embeddingHash, wallet, nonce)`

## Build artifacts

You need `circom` and `snarkjs` installed.

```
circom face_auth.circom --r1cs --wasm --sym -o build
snarkjs powersoftau new bn128 14 pot14_0000.ptau -v
snarkjs powersoftau contribute pot14_0000.ptau pot14_0001.ptau --name="First contribution" -v
snarkjs powersoftau prepare phase2 pot14_0001.ptau pot14_final.ptau -v
snarkjs groth16 setup build/face_auth.r1cs pot14_final.ptau face_auth_0000.zkey
snarkjs zkey contribute face_auth_0000.zkey face_auth.zkey --name="Key contribution" -v
snarkjs zkey export verificationkey face_auth.zkey face_auth.vkey.json
```

Copy to `web/public/zk/`:

```
face_auth.wasm
face_auth.zkey
face_auth.vkey.json
```
