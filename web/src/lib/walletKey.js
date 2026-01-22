const encoder = new TextEncoder();

function toHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function derivePassphraseFromSignature({ signature, wallet }) {
  const payload = `${wallet.toLowerCase()}:${signature}`;
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(payload));
  return toHex(new Uint8Array(digest));
}
