export const EMBEDDING_SCALE_NUMBER = 10000;
export const EMBEDDING_SCALE = BigInt(EMBEDDING_SCALE_NUMBER);
export const EMBEDDING_LENGTH = 128;
export const MATCH_THRESHOLD = 0.5;
const thresholdScaled = BigInt(Math.round(MATCH_THRESHOLD * EMBEDDING_SCALE_NUMBER));
export const DISTANCE_THRESHOLD = thresholdScaled * thresholdScaled;
export const FIELD_SIZE = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
);
export const DEFAULT_WASM_URL = '/zk/face_match.wasm';
export const DEFAULT_ZKEY_URL = '/zk/face_match.zkey';
