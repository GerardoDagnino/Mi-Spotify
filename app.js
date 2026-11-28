let player = null;
let deviceId = null;
let currentContext = null;
let shuffleState = false;
let repeatState = 'off';
let seeking = false;
let repeatRestarting = false;
let localCatalog = null;
const OWNER_EMAIL = 'gerardoangecala@gmail.com';
const OWNER_KEY = 'mi_spotify_owner';
const DEFAULT_PROXY = 'https://flat-poetry-5513.gerardoangecala.workers.dev';

function isOwnerBrowser() {
  return localStorage.getItem(OWNER_KEY) === OWNER_EMAIL;
}

function getProxyUrl() {
  return (localStorage.getItem('spotify_proxy') || DEFAULT_PROXY).trim().replace(/\/$/, '');
}

function isForbidden(error) {
  return /403|Forbidden/i.test(error.message || '');
}

function activateOwner() {
  const email = prompt('Correo de Spotify para activar el catálogo en este navegador:');
  if (!email) return;
  if (email.trim().toLowerCase() === OWNER_EMAIL) {
    localStorage.setItem(OWNER_KEY, OWNER_EMAIL);
    alert('Catálogo activado en este navegador.');
  } else {
    alert('El correo no coincide con el dueño de la página.');
  }
}

function showRestrictedNotice(container) {
  const notice = document.createElement('div');
  notice.className = 'offline-notice';
  notice.textContent = 'Esta red bloquea api.spotify.com. El catálogo guardado solo está activo en el navegador de ' + OWNER_EMAIL + '.';
  container.prepend(notice);
}

function cacheGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function cacheSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {}
}

function showOfflineNotice(container, message) {
  const notice = document.createElement('div');
  notice.className = 'offline-notice';
  notice.textContent = 'Modo sin conexión con la API: ' + message + '. Mostrando datos guardados en este navegador.';
  container.prepend(notice);
}

async function getLocalCatalog() {
  if (!isOwnerBrowser()) return { playlists: [] };
  if (localCatalog) return localCatalog;
  try {
    const response = await fetch('catalog.json?v=2');
    localCatalog = response.ok ? await response.json() : { playlists: [] };
  } catch (error) {
    localCatalog = { playlists: [] };
  }
  return localCatalog;
}

async function exportCatalog() {
  const button = document.getElementById('export-btn');
  button.disabled = true;
  button.textContent = 'Exportando…';
  try {
    const playlists = await loadAllPlaylists();
    const catalog = { playlists: [] };
    for (const playlist of playlists) {
      let rows = [];
      let restricted = false;
      try {
        rows = await loadAllPlaylistItems(playlist.id, document.getElementById('tracks'));
      } catch (error) {
        if (isForbidden(error)) restricted = true;
        else throw error;
      }
      catalog.playlists.push({
        id: playlist.id,
        name: playlist.name,
        uri: playlist.uri,
        restricted: restricted,
        tracks: rows.map(row => asTrack(row.item) || asTrack(row.track)).filter(Boolean)
      });
      document.getElementById('device-info').textContent = 'Exportando… ' + catalog.playlists.length + '/' + playlists.length;
    }
    const blob = new Blob([JSON.stringify(catalog, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'catalog.json';
    link.click();
    URL.revokeObjectURL(link.href);
    document.getElementById('device-info').textContent = 'Catálogo descargado: súbelo a GitHub como catalog.json';
  } catch (error) {
    document.getElementById('device-info').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Exportar';
  }
}

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
  document.getElementById('export-btn').addEventListener('click', exportCatalog);
  document.getElementById('owner-btn').addEventListener('click', activateOwner);
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
    if (me.email && me.email.toLowerCase() === OWNER_EMAIL) {
      localStorage.setItem(OWNER_KEY, OWNER_EMAIL);
    }
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
  const url = path === '/v1' || path.startsWith('/v1/')
    ? 'https://api.spotify.com' + path
    : 'https://api.spotify.com/v1' + path;
  const init = {
    ...options,
    headers: {
      'Authorization': 'Bearer ' + token,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  };
  let response;
  try {
    response = await fetch(url, init);
  } catch (directError) {
    const proxy = getProxyUrl();
    if (!proxy) {
      throw new Error('No se pudo conectar con api.spotify.com (' + directError.name + ': ' + directError.message + '). Si es una red de trabajo, configura el proxy.');
    }
    try {
      response = await fetch(proxy + '?url=' + encodeURIComponent(url), init);
    } catch (proxyError) {
      throw new Error('Firewall y proxy bloqueados: ' + proxyError.message);
    }
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
  let items;
  try {
    items = await loadAllPlaylists();
    cacheSet('spotify_playlists', items);
  } catch (error) {
    items = isOwnerBrowser() ? cacheGet('spotify_playlists', []) : [];
    if (!items.length) {
      const catalog = await getLocalCatalog();
      items = catalog.playlists || [];
    }
    if (isOwnerBrowser()) showOfflineNotice(container, error.message);
    else showRestrictedNotice(container);
  }
  try {
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
  let rows;
  try {
    rows = await loadAllPlaylistItems(playlist.id, container);
    cacheSet('spotify_tracks_' + playlist.id, rows);
  } catch (error) {
    rows = isOwnerBrowser() ? cacheGet('spotify_tracks_' + playlist.id, []) : [];
    if (!rows.length) {
      const catalog = await getLocalCatalog();
      const saved = (catalog.playlists || []).find(item => item.id === playlist.id);
      if (saved && saved.restricted) {
        container.textContent = 'Spotify no permite exportar esta playlist: es de otro usuario.';
        return;
      }
      rows = (saved && saved.tracks || []).map(track => ({ item: track }));
    }
    if (!rows.length && isForbidden(error)) {
      container.textContent = 'Spotify solo permite ver el contenido de playlists que creaste o donde eres colaborador.';
      return;
    }
    if (isOwnerBrowser()) showOfflineNotice(container, error.message);
    else showRestrictedNotice(container);
  }
  const tracks = rows.map(row => asTrack(row.item) || asTrack(row.track)).filter(Boolean);
  if (!tracks.length) {
    container.textContent = 'No hay canciones disponibles para esta playlist.';
    return;
  }
  container.innerHTML = '';
  tracks.forEach((track, index) => {
    container.appendChild(createTrackRow(track, index + 1, () => playContext(currentContext, track.uri)));
  });
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
    const catalog = await getLocalCatalog();
    const found = [];
    const needle = query.toLowerCase();
    for (const playlist of catalog.playlists || []) {
      for (const track of playlist.tracks || []) {
        const artistNames = (track.artists || []).map(artist => artist.name).join(' ');
        const haystack = (track.name + ' ' + artistNames + ' ' + ((track.album && track.album.name) || '')).toLowerCase();
        if (haystack.includes(needle)) found.push(track);
      }
    }
    container.innerHTML = '';
    if (isOwnerBrowser()) showOfflineNotice(container, 'búsqueda en el catálogo guardado');
    else {
      showRestrictedNotice(container);
      return;
    }
    if (!found.length) {
      container.appendChild(document.createTextNode('No hay resultados en el catálogo guardado.'));
      return;
    }
    container.appendChild(createSection('Canciones guardadas'));
    found.slice(0, 100).forEach((track, index) => {
      container.appendChild(createTrackRow(track, index + 1, () => playUris([track.uri])));
    });
  }
}

async function playUris(uris) {
  if (!deviceId) {
    document.getElementById('device-info').textContent = 'El reproductor aún no está listo.';
    return;
  }
  try {
    await api('/v1/me/player/play?device_id=' + encodeURIComponent(deviceId), {
      method: 'PUT',
      body: JSON.stringify({ uris: uris })
    });
  } catch (error) {
    setDeviceInfo('Red bloqueada: inicia la canción desde tu móvil eligiendo este navegador como dispositivo; luego usa los controles.');
  }
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
  const states = ['off', 'track', 'context'];
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

function handleTrackRepeat(state) {
  if (repeatState !== 'track' || repeatRestarting) return;
  if (!state.paused || !state.duration) return;
  if (state.duration - state.position > 2500) return;
  repeatRestarting = true;
  player.seek(0)
    .then(() => player.togglePlay())
    .catch(error => setDeviceInfo(error.message))
    .finally(() => setTimeout(() => { repeatRestarting = false; }, 800));
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
  try {
    await api('/v1/me/player/play?device_id=' + encodeURIComponent(deviceId), {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  } catch (error) {
    setDeviceInfo('Red bloqueada: inicia la canción desde tu móvil eligiendo este navegador como dispositivo; luego usa los controles.');
  }
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
    updatePlaybackButtons();
    handleTrackRepeat(state);
  });

  ['initialization_error', 'authentication_error', 'account_error', 'playback_error'].forEach(event => {
    player.addListener(event, error => setDeviceInfo(error.message || event));
  });

  player.setVolume(0.8);
  updatePlaybackButtons();
  player.connect();
}
