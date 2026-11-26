const CLIENT_ID = 'PEGAR_CLIENT_ID_AQUI';
const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'streaming',
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state'
];

const STATE_KEY = 'spotify_pkce_state';
const VERIFIER_KEY = 'spotify_pkce_verifier';
const TOKEN_KEY = 'spotify_tokens';

function randomString(length) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(array, byte => chars[byte % chars.length]).join('');
}

function base64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return base64url(hash);
}

async function login() {
  const verifier = randomString(64);
  const challenge = await sha256(verifier);
  const state = randomString(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES.join(' '),
    redirect_uri: REDIRECT_URI,
    state: state,
    code_challenge_method: 'S256',
    code_challenge: challenge
  });

  window.location.href = 'https://accounts.spotify.com/authorize?' + params.toString();
}

function parseCallback() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('error')) throw new Error(params.get('error'));
  const code = params.get('code');
  if (!code) return null;
  const state = params.get('state');
  if (state !== sessionStorage.getItem(STATE_KEY)) throw new Error('State inválido');
  history.replaceState({}, document.title, window.location.pathname);
  return code;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: sessionStorage.getItem(VERIFIER_KEY)
  });
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  if (!response.ok) throw new Error('No se pudo obtener el token (' + response.status + ')');
  const data = await response.json();
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  return saveTokens(data);
}

function getTokens() {
  const raw = sessionStorage.getItem(TOKEN_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveTokens(data) {
  const previous = getTokens();
  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || (previous && previous.refresh_token),
    expires_at: Date.now() + ((data.expires_in || 3600) - 60) * 1000
  };
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  return tokens;
}

async function getValidAccessToken() {
  const tokens = getTokens();
  if (!tokens || !tokens.access_token) return null;
  if (Date.now() < tokens.expires_at) return tokens.access_token;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: CLIENT_ID
  });
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  if (!response.ok) {
    logout();
    return null;
  }
  const updated = saveTokens(await response.json());
  return updated.access_token;
}

function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
}
