let player = null;
let deviceId = null;
let currentContext = null;

window.onSpotifyWebPlaybackSDKReady = setupPlayer;

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('redirect-uri').textContent = REDIRECT_URI;
  document.getElementById('login-btn').addEventListener('click', login);
  document.getElementById('play-btn').addEventListener('click', () => {
    if (player) player.togglePlay();
  });
  document.getElementById('prev-btn').addEventListener('click', () => {
    if (player) player.previousTrack();
  });
  document.getElementById('next-btn').addEventListener('click', () => {
    if (player) player.nextTrack();
  });

  try {
    const code = parseCallback();
    if (code) await exchangeCode(code);
  } catch (error) {
    document.getElementById('login-error').textContent = 'No se pudo iniciar sesión: ' + error.message;
  }

  if (getTokens()) {
    await showApp();
  }
});

async function showApp() {
  document.getElementById('login-screen').hidden = true;
  document.getElementById('app-screen').hidden = false;
  document.getElementById('player-bar').hidden = false;

  const userArea = document.getElementById('user-area');
  userArea.innerHTML = '';
  try {
    const me = await api('/v1/me');
    const name = document.createElement('span');
    name.textContent = me.display_name || me.id;
    userArea.appendChild(name);
  } catch (error) {
    const label = document.createElement('span');
    label.textContent = 'Tu cuenta';
    userArea.appendChild(label);
  }
  const logoutButton = document.createElement('button');
  logoutButton.textContent = 'Salir';
  logoutButton.addEventListener('click', () => {
    logout();
    location.reload();
  });
  userArea.appendChild(logoutButton);
  await loadPlaylists();
}

async function api(path, options = {}) {
  const token = await getValidAccessToken();
  const response = await fetch('https://api.spotify.com/v1' + path, {
    ...options,
    headers: {
      'Authorization': 'Bearer ' + token,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  if (response.status === 204) return null;
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      if (body.error && body.error.message) detail = body.error.message;
    } catch (error) {}
    throw new Error(detail);
  }
  return response.json();
}

async function loadPlaylists() {
  const container = document.getElementById('playlists');
  container.innerHTML = '';
  try {
    const data = await api('/v1/me/playlists?limit=50');
    if (!data.items.length) {
      container.textContent = 'No tienes playlists.';
      return;
    }
    for (const item of data.items) {
      const button = document.createElement('button');
      button.className = 'playlist-item';
      button.textContent = item.name;
      button.addEventListener('click', () => loadTracks(item));
      container.appendChild(button);
    }
  } catch (error) {
    container.textContent = 'Error: ' + error.message;
  }
}

async function loadTracks(playlist) {
  currentContext = playlist.uri;
  document.getElementById('playlist-title').textContent = playlist.name;
  const container = document.getElementById('tracks');
  container.innerHTML = '';
  try {
    const data = await api('/v1/playlists/' + playlist.id + '/tracks?limit=100&fields=items(track(id,name,artists(name),uri)),total');
    if (!data.items.length) {
      container.textContent = 'Esta playlist está vacía.';
      return;
    }
    data.items.forEach((item, index) => {
      if (!item.track) return;
      const row = document.createElement('div');
      row.className = 'track';
      const info = document.createElement('span');
      const artists = item.track.artists.map(artist => artist.name).join(', ');
      info.textContent = (index + 1) + '. ' + item.track.name + ' - ' + artists;
      const play = document.createElement('button');
      play.textContent = 'Reproducir';
      play.addEventListener('click', () => playContext(currentContext, item.track.uri));
      row.append(info, play);
      container.appendChild(row);
    });
  } catch (error) {
    container.textContent = 'Error: ' + error.message;
  }
}

async function playContext(contextUri, trackUri) {
  if (!deviceId) {
    document.getElementById('device-info').textContent = 'El reproductor aún no está listo.';
    return;
  }
  const body = { context_uri: contextUri };
  if (trackUri) body.offset = { uri: trackUri };
  await api('/v1/me/player/play?device_id=' + encodeURIComponent(deviceId), {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

function setDeviceInfo(message) {
  document.getElementById('device-info').textContent = message;
}

function setupPlayer() {
  player = new Spotify.Player({
    name: 'Mi Spotify en GitHub',
    getOAuthToken: callback => {
      getValidAccessToken().then(token => callback(token)).catch(() => callback(''));
    },
    volume: 0.8
  });

  player.addListener('ready', event => {
    deviceId = event.device_id;
    setDeviceInfo('Listo: reproduce en este navegador');
    api('/v1/me/player', {
      method: 'PUT',
      body: JSON.stringify({ device_ids: [deviceId], play: false })
    }).catch(error => setDeviceInfo(error.message));
  });

  player.addListener('not_ready', () => setDeviceInfo('Reproductor desconectado'));

  player.addListener('player_state_changed', state => {
    if (!state || !state.track_window || !state.track_window.current_track) return;
    const track = state.track_window.current_track;
    document.getElementById('track-info').textContent = track.name + ' - ' + track.artists[0].name;
    document.getElementById('play-btn').textContent = state.paused ? 'Reproducir' : 'Pausar';
  });

  ['initialization_error', 'authentication_error', 'account_error', 'playback_error'].forEach(event => {
    player.addListener(event, error => setDeviceInfo(error.message || event));
  });

  player.connect();
}
