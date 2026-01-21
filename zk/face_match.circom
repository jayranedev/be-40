pragma circom 2.1.6;

include "circomlib/poseidon.circom";
include "circomlib/comparators.circom";

template FaceMatch(n) {
    signal input liveEmbedding[n];
    signal input enrolledEmbedding[n];
    signal input nonce;
    signal input version;
    signal input distanceThreshold;

    signal output faceCommitment;

    component poseidon = Poseidon(n + 2);
    for (var i = 0; i < n; i++) {
        poseidon.inputs[i] <== enrolledEmbedding[i];
    }
    poseidon.inputs[n] <== nonce;
    poseidon.inputs[n + 1] <== version;
    faceCommitment <== poseidon.out;

    signal sum[n + 1];
    sum[0] <== 0;
    for (var j = 0; j < n; j++) {
        signal diff;
        signal diffSquared;
        diff <== liveEmbedding[j] - enrolledEmbedding[j];
        diffSquared <== diff * diff;
        sum[j + 1] <== sum[j] + diffSquared;
    }

    signal thresholdPlusOne;
    thresholdPlusOne <== distanceThreshold + 1;

    component lt = LessThan(252);
    lt.in[0] <== sum[n];
    lt.in[1] <== thresholdPlusOne;
    lt.out === 1;
}

component main = FaceMatch(128);
