pragma circom 2.1.6;

include "circomlib/poseidon.circom";

// Proves knowledge of a face embedding that hashes to a registered commitment.
// The face embedding is computed off-chain from the user's face image.
// The commitment is Poseidon(embedding..., salt).
// Public input: expectedCommitment
// Private inputs: embedding[], salt

template FaceIdentity(EMBEDDING_DIM) {
    signal input embedding[EMBEDDING_DIM];
    signal input salt;
    signal input expectedCommitment;

    signal hashInputs[EMBEDDING_DIM + 1];
    for (var i = 0; i < EMBEDDING_DIM; i++) {
        hashInputs[i] <== embedding[i];
    }
    hashInputs[EMBEDDING_DIM] <== salt;

    component hasher = Poseidon(EMBEDDING_DIM + 1);
    for (var j = 0; j < EMBEDDING_DIM + 1; j++) {
        hasher.inputs[j] <== hashInputs[j];
    }

    hasher.out === expectedCommitment;
}

component main = FaceIdentity(128);
