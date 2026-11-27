let player = null;
let deviceId = null;
let currentContext = null;
let shuffleState = false;
let repeatState = 'off';

window.onSpotifyWebPlaybackSDKReady = setupPlayer;

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('redirect-uri').textContent = REDIRECT_URI;
  document.getElementById('login-btn').addEventListener('click', login);
  document.getElementById('login-minimal-btn').addEventListener('click', loginMinimal);
  document.getElementById('play-btn').addEventListener('click', () => {
    if (player) player.togglePlay();
  });
  document.getElementById('prev-btn').addEventListener('click', () => {
    if (player) player.previousTrack();
  });
  document.getElementById('next-btn').addEventListener('click', () => {
    if (player) player.nextTrack();
  });
  document.getElementById('shuffle-btn').addEventListener('click', toggleShuffle);
  document.getElementById('repeat-btn').addEventListener('click', cycleRepeat);
  document.getElementById('search-btn').addEventListener('click', searchTracks);
  document.getElementById('search-input').addEventListener('keydown', event => {
    if (event.key === 'Enter') searchTracks();
  });
  document.getElementById('volume').addEventListener('input', event => {
    if (player) player.setVolume(Number(event.target.value) / 100);
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
  if (!token) throw new Error('Sesión caducada: vuelve a entrar con Spotify.');
  let response;
  try {
    const url = path === '/v1' || path.startsWith('/v1/')
      ? 'https://api.spotify.com' + path
      : 'https://api.spotify.com/v1' + path;
    response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': 'Bearer ' + token,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
  } catch (error) {
    throw new Error('Fallo de red/CORS al llamar ' + path + ': ' + error.message);
  }
  if (response.status === 204) return null;
  if (!response.ok) {
    let detail = response.status + ' ' + response.statusText;
    try {
      const body = await response.json();
      if (body.error && body.error.message) detail = body.error.message;
    } catch (error) {}
    throw new Error(detail + ' (' + path + ')');
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
    const tracks = data.items.filter(item => item.track && item.track.uri).map(item => item.track);
    if (!tracks.length) {
      container.textContent = 'Esta playlist está vacía.';
      return;
    }
    tracks.forEach((track, index) => {
      container.appendChild(createTrackRow(track, index + 1, () => playContext(currentContext, track.uri)));
    });
  } catch (error) {
    container.textContent = 'Error: ' + error.message;
  }
}

function createTrackRow(track, index, onPlay) {
  const row = document.createElement('div');
  row.className = 'track';
  const info = document.createElement('span');
  const artists = (track.artists || []).map(artist => artist.name).join(', ');
  info.textContent = index + '. ' + track.name + ' - ' + artists;
  const play = document.createElement('button');
  play.textContent = 'Reproducir';
  play.addEventListener('click', onPlay);
  row.append(info, play);
  return row;
}

async function searchTracks() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;
  currentContext = null;
  document.getElementById('playlist-title').textContent = 'Resultados para "' + query + '"';
  const container = document.getElementById('tracks');
  container.innerHTML = 'Buscando…';
  try {
    const data = await api('/v1/search?q=' + encodeURIComponent(query) + '&type=track&limit=20');
    const tracks = data.tracks.items;
    if (!tracks.length) {
      container.textContent = 'No se encontraron canciones.';
      return;
    }
    container.innerHTML = '';
    tracks.forEach((track, index) => {
      container.appendChild(createTrackRow(track, index + 1, () => playUris([track.uri])));
    });
  } catch (error) {
    container.textContent = 'Error: ' + error.message;
  }
}

async function playUris(uris) {
  if (!deviceId) {
    document.getElementById('device-info').textContent = 'El reproductor aún no está listo.';
    return;
  }
  await api('/v1/me/player/play?device_id=' + encodeURIComponent(deviceId), {
    method: 'PUT',
    body: JSON.stringify({ uris: uris })
  });
}

async function toggleShuffle() {
  shuffleState = !shuffleState;
  updatePlaybackButtons();
  try {
    await api('/v1/me/player/shuffle?state=' + shuffleState, { method: 'PUT' });
  } catch (error) {
    shuffleState = !shuffleState;
    updatePlaybackButtons();
    setDeviceInfo(error.message);
  }
}

async function cycleRepeat() {
  const states = ['off', 'context', 'track'];
  const next = states[(states.indexOf(repeatState) + 1) % states.length];
  repeatState = next;
  updatePlaybackButtons();
  try {
    await api('/v1/me/player/repeat?state=' + next, { method: 'PUT' });
  } catch (error) {
    repeatState = states[(states.indexOf(repeatState) - 1 + states.length) % states.length];
    updatePlaybackButtons();
    setDeviceInfo(error.message);
  }
}

function updatePlaybackButtons() {
  document.getElementById('shuffle-btn').textContent = 'Aleatorio: ' + (shuffleState ? 'sí' : 'no');
  const labels = { off: 'no', context: 'playlist', track: 'canción' };
  document.getElementById('repeat-btn').textContent = 'Repetir: ' + labels[repeatState];
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
    shuffleState = !!state.shuffle;
    repeatState = state.repeat_mode || 'off';
    updatePlaybackButtons();
  });

  ['initialization_error', 'authentication_error', 'account_error', 'playback_error'].forEach(event => {
    player.addListener(event, error => setDeviceInfo(error.message || event));
  });

  player.setVolume(0.8);
  updatePlaybackButtons();
  player.connect();
}
