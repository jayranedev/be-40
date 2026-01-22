pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";

template FaceAuth(n) {
    signal input wallet;
    signal input nonce;
    signal input commitment;
    signal input embedding[n];

    component level1[64];
    for (var i = 0; i < 64; i++) {
        level1[i] = Poseidon(2);
        level1[i].inputs[0] <== embedding[2 * i];
        level1[i].inputs[1] <== embedding[2 * i + 1];
    }

    component level2[32];
    for (var j = 0; j < 32; j++) {
        level2[j] = Poseidon(2);
        level2[j].inputs[0] <== level1[2 * j].out;
        level2[j].inputs[1] <== level1[2 * j + 1].out;
    }

    component level3[16];
    for (var k = 0; k < 16; k++) {
        level3[k] = Poseidon(2);
        level3[k].inputs[0] <== level2[2 * k].out;
        level3[k].inputs[1] <== level2[2 * k + 1].out;
    }

    component level4[8];
    for (var m = 0; m < 8; m++) {
        level4[m] = Poseidon(2);
        level4[m].inputs[0] <== level3[2 * m].out;
        level4[m].inputs[1] <== level3[2 * m + 1].out;
    }

    component level5[4];
    for (var p = 0; p < 4; p++) {
        level5[p] = Poseidon(2);
        level5[p].inputs[0] <== level4[2 * p].out;
        level5[p].inputs[1] <== level4[2 * p + 1].out;
    }

    component level6[2];
    for (var q = 0; q < 2; q++) {
        level6[q] = Poseidon(2);
        level6[q].inputs[0] <== level5[2 * q].out;
        level6[q].inputs[1] <== level5[2 * q + 1].out;
    }

    component level7 = Poseidon(2);
    level7.inputs[0] <== level6[0].out;
    level7.inputs[1] <== level6[1].out;
    signal embeddingHash;
    embeddingHash <== level7.out;

    component commitmentHasher = Poseidon(3);
    commitmentHasher.inputs[0] <== embeddingHash;
    commitmentHasher.inputs[1] <== wallet;
    commitmentHasher.inputs[2] <== nonce;

    commitment === commitmentHasher.out;
}

component main { public [wallet, nonce, commitment] } = FaceAuth(128);
