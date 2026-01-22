const relayerUrl = import.meta.env.VITE_RELAYER_URL;

export async function submitProof(payload) {
  if (!relayerUrl) {
    throw new Error('Relayer not configured');
  }
  const response = await fetch(relayerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Relayer request failed');
  }
  return response.json();
}

export async function fetchProofs({ limit = 25, offset = 0, wallet, from, to } = {}) {
  if (!relayerUrl) {
    throw new Error('Relayer not configured');
  }
  const url = new URL(relayerUrl);
  url.searchParams.set('limit', `${limit}`);
  url.searchParams.set('offset', `${offset}`);
  if (wallet) {
    url.searchParams.set('wallet', wallet);
  }
  if (from) {
    url.searchParams.set('from', from);
  }
  if (to) {
    url.searchParams.set('to', to);
  }
  const response = await fetch(url.toString());
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Relayer request failed');
  }
  const payload = await response.json();
  return { data: payload.data || [], count: payload.count ?? null };
}
