let player = null;
let deviceId = null;
let currentContext = null;
let shuffleState = false;
let repeatState = 'off';
let seeking = false;

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
  document.getElementById('progress').addEventListener('input', event => {
    seeking = true;
    document.getElementById('current-time').textContent = formatTime(Number(event.target.value));
  });
  document.getElementById('progress').addEventListener('change', event => {
    if (player) player.seek(Number(event.target.value)).catch(error => setDeviceInfo(error.message));
    seeking = false;
  });
  setInterval(updateProgressFromPlayer, 1000);

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
    throw new Error('Fallo de red/CORS en ' + url + ': ' + error.message);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (!response.ok) {
    let detail = response.status + ' ' + response.statusText;
    try {
      const body = JSON.parse(text);
      if (body.error && body.error.message) detail = body.error.message;
    } catch (error) {}
    throw new Error(detail + ' (' + path + ')');
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

async function loadPlaylists() {
  const container = document.getElementById('playlists');
  container.innerHTML = '';
  try {
    const items = await loadAllPlaylists();
    if (!items.length) {
      container.textContent = 'No tienes playlists.';
      return;
    }
    for (const item of items) {
      const button = document.createElement('button');
      button.className = 'playlist-item';
      button.textContent = item.name;
      button.addEventListener('click', () => {
        document.querySelectorAll('.playlist-item.active').forEach(active => active.classList.remove('active'));
        button.classList.add('active');
        loadTracks(item);
      });
      container.appendChild(button);
    }
  } catch (error) {
    container.textContent = 'Error: ' + error.message;
  }
}

async function loadAllPlaylists() {
  const all = [];
  let offset = 0;
  while (true) {
    const data = await api('/v1/me/playlists?limit=50&offset=' + offset);
    const rows = data.items || [];
    all.push(...rows);
    if (!data.next || rows.length < 50) break;
    offset += rows.length;
  }
  return all;
}

async function loadAllPlaylistItems(playlistId, container) {
  const all = [];
  const fields = 'items(item(id,name,artists(name),uri,album(name,images),duration_ms)),total,next';
  let offset = 0;
  while (true) {
    const data = await api('/v1/playlists/' + encodeURIComponent(playlistId) + '/items?limit=50&offset=' + offset + '&fields=' + encodeURIComponent(fields));
    const rows = data.items || [];
    all.push(...rows);
    const total = data.total || all.length;
    container.textContent = 'Cargando canciones… ' + all.length + '/' + total;
    if (!data.next || rows.length < 50) break;
    offset += rows.length;
  }
  return all;
}

async function loadTracks(playlist) {
  currentContext = playlist.uri;
  document.getElementById('playlist-title').textContent = playlist.name;
  const container = document.getElementById('tracks');
  container.innerHTML = '';
  try {
    const rows = await loadAllPlaylistItems(playlist.id, container);
    const tracks = rows.map(row => asTrack(row.item) || asTrack(row.track)).filter(Boolean);
    if (!tracks.length) {
      container.textContent = 'Esta playlist está vacía.';
      return;
    }
    container.innerHTML = '';
    tracks.forEach((track, index) => {
      container.appendChild(createTrackRow(track, index + 1, () => playContext(currentContext, track.uri)));
    });
  } catch (error) {
    container.textContent = error.message.includes('403')
      ? 'Spotify solo permite ver el contenido de playlists que creaste o donde eres colaborador.'
      : 'Error: ' + error.message;
  }
}

function createSection(title) {
  const heading = document.createElement('h3');
  heading.className = 'result-section';
  heading.textContent = title;
  return heading;
}

function asTrack(value) {
  return value && typeof value === 'object' && value.uri ? value : null;
}

function createTrackRow(track, index, onPlay) {
  const row = document.createElement('div');
  row.className = 'track';

  const number = document.createElement('span');
  number.className = 'track-index';
  number.textContent = index;

  const art = document.createElement('img');
  art.className = 'track-art';
  art.alt = '';
  const images = (track.album && track.album.images) || track.images || [];
  if (images.length) art.src = images[images.length - 1].url;

  const info = document.createElement('div');
  info.className = 'track-info-row';
  const title = document.createElement('strong');
  title.textContent = track.name;
  const subtitle = document.createElement('small');
  const artists = (track.artists || []).map(artist => artist.name).join(', ');
  subtitle.textContent = artists || (track.album && track.album.name) || 'Spotify';
  info.append(title, subtitle);

  const duration = document.createElement('span');
  duration.className = 'track-duration';
  duration.textContent = track.duration_ms ? formatTime(track.duration_ms) : '';

  const play = document.createElement('button');
  play.className = 'small';
  play.textContent = 'Reproducir';
  play.addEventListener('click', onPlay);

  row.append(number, art, info, duration, play);
  return row;
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

function updateProgress(position, duration) {
  if (seeking) return;
  const bar = document.getElementById('progress');
  bar.max = Math.max(duration || 0, 1);
  bar.value = position || 0;
  document.getElementById('current-time').textContent = formatTime(position || 0);
  document.getElementById('duration-time').textContent = formatTime(duration || 0);
}

async function updateProgressFromPlayer() {
  if (!player) return;
  try {
    const state = await player.getCurrentState();
    if (state) updateProgress(state.position, state.duration);
  } catch (error) {}
}

async function searchTracks() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;
  currentContext = null;
  document.getElementById('playlist-title').textContent = 'Resultados para "' + query + '"';
  const container = document.getElementById('tracks');
  container.innerHTML = 'Buscando…';
  try {
    const data = await api('/v1/search?q=' + encodeURIComponent(query) + '&type=track,album,artist&limit=10');
    const tracks = data.tracks.items;
    const albums = data.albums.items;
    const artists = data.artists.items;
    if (!tracks.length && !albums.length && !artists.length) {
      container.textContent = 'No se encontraron resultados.';
      return;
    }
    container.innerHTML = '';

    if (tracks.length) {
      container.appendChild(createSection('Canciones'));
      tracks.forEach((track, index) => {
        container.appendChild(createTrackRow(track, index + 1, () => playUris([track.uri])));
      });
    }
    if (albums.length) {
      container.appendChild(createSection('Álbumes'));
      albums.forEach((album, index) => {
        container.appendChild(createTrackRow({
          name: album.name,
          artists: album.artists,
          album: { images: album.images },
          uri: album.uri
        }, index + 1, () => playContext(album.uri)));
      });
    }
    if (artists.length) {
      container.appendChild(createSection('Artistas'));
      artists.forEach((artist, index) => {
        const row = createTrackRow({ name: artist.name, uri: artist.uri }, index + 1, () => {
          document.getElementById('search-input').value = artist.name;
          searchTracks();
        });
        row.querySelector('.track-info-row small').textContent = 'Artista';
        row.querySelector('button').textContent = 'Buscar';
        container.appendChild(row);
      });
    }
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
    updateProgress(state.position, state.duration);
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
