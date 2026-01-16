const STORAGE_KEY = 'faceid-state';

export const defaultState = {
  identities: {},
  sessions: {},
};

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { ...defaultState };
  } catch (error) {
    return { ...defaultState };
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function upsertIdentity(state, wallet, identity) {
  const next = { ...state, identities: { ...state.identities } };
  next.identities[wallet.toLowerCase()] = identity;
  saveState(next);
  return next;
}

export function getIdentity(state, wallet) {
  return state.identities[wallet.toLowerCase()] || null;
}

export function addSession(state, owner, session) {
  const key = owner.toLowerCase();
  const existing = state.sessions[key] || [];
  const next = {
    ...state,
    sessions: {
      ...state.sessions,
      [key]: [...existing, session],
    },
  };
  saveState(next);
  return next;
}

export function listSessions(state, owner) {
  return state.sessions[owner.toLowerCase()] || [];
}

export function revokeSession(state, owner, sessionPubKey) {
  const key = owner.toLowerCase();
  const updated = (state.sessions[key] || []).map((session) => {
    if (session.sessionPubKey === sessionPubKey) {
      return { ...session, active: false };
    }
    return session;
  });
  const next = {
    ...state,
    sessions: {
      ...state.sessions,
      [key]: updated,
    },
  };
  saveState(next);
  return next;
}
