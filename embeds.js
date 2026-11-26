const STORAGE_KEY = 'spotify_embeds';
const THEME_KEY = 'spotify_embed_theme';
const controllers = new Map();
let iframeApi = null;

window.onSpotifyIframeApiReady = api => {
  iframeApi = api;
  renderControllers();
};

document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add(getTheme());
  document.getElementById('theme-btn').textContent = getTheme() === 'dark' ? 'Tema claro' : 'Tema oscuro';
  document.getElementById('add-btn').addEventListener('click', addEmbed);
  document.getElementById('spotify-url').addEventListener('keydown', event => {
    if (event.key === 'Enter') addEmbed();
  });
  document.getElementById('theme-btn').addEventListener('click', toggleTheme);
  render();
});

function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'dark';
}

function getEmbeds() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveEmbeds(embeds) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(embeds));
}

function parseLink(value) {
  const match = value.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album|track|show|episode)\/([A-Za-z0-9]+)/);
  if (!match) return null;
  return { type: match[1], id: match[2], url: 'https://open.spotify.com/' + match[1] + '/' + match[2] };
}

function addEmbed() {
  const input = document.getElementById('spotify-url');
  const parsed = parseLink(input.value.trim());
  const error = document.getElementById('embed-error');
  if (!parsed) {
    error.textContent = 'Pega el enlace completo: https://open.spotify.com/album/... o /playlist/...';
    return;
  }
  error.textContent = '';
  input.value = '';
  const embeds = getEmbeds();
  embeds.push({ ...parsed, repeat: false });
  saveEmbeds(embeds);
  render();
}

function toggleTheme() {
  const theme = getTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, theme);
  document.body.classList.remove('dark', 'light');
  document.body.classList.add(theme);
  document.getElementById('theme-btn').textContent = theme === 'dark' ? 'Tema claro' : 'Tema oscuro';
  render();
}

function render() {
  controllers.forEach(controller => {
    try {
      controller.destroy();
    } catch (error) {}
  });
  controllers.clear();

  const container = document.getElementById('embeds');
  container.innerHTML = '';
  const embeds = getEmbeds();

  if (!embeds.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Aún no hay nada guardado. Pega un enlace de Spotify para empezar.';
    container.appendChild(empty);
    return;
  }

  embeds.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = 'embed-card';

    const top = document.createElement('div');
    top.className = 'card-top';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = item.type;
    const title = document.createElement('h3');
    title.id = 'title-' + index;
    title.textContent = item.id;
    const remove = document.createElement('button');
    remove.className = 'ghost small';
    remove.textContent = 'Quitar';
    remove.addEventListener('click', () => {
      const current = getEmbeds();
      current.splice(index, 1);
      saveEmbeds(current);
      render();
    });
    top.append(badge, title, remove);

    const holder = document.createElement('div');
    holder.className = 'player-holder';
    holder.id = 'embed-' + index;

    const controls = document.createElement('div');
    controls.className = 'card-controls';
    const play = document.createElement('button');
    play.className = 'primary small';
    play.textContent = 'Reproducir';
    play.addEventListener('click', () => {
      const controller = controllers.get(index);
      if (controller) controller.togglePlay();
    });
    const restart = document.createElement('button');
    restart.className = 'small';
    restart.textContent = 'Reiniciar';
    restart.addEventListener('click', () => {
      const controller = controllers.get(index);
      if (controller) controller.restart();
    });
    const repeat = document.createElement('button');
    repeat.className = 'small';
    repeat.textContent = item.repeat ? 'Repetir: sí' : 'Repetir: no';
    repeat.addEventListener('click', () => {
      const current = getEmbeds();
      current[index].repeat = !current[index].repeat;
      saveEmbeds(current);
      render();
    });
    controls.append(play, restart, repeat);

    card.append(top, holder, controls);
    container.appendChild(card);
    loadMetadata(index, item);
  });

  renderControllers();
}

function renderControllers() {
  if (!iframeApi) return;
  getEmbeds().forEach((item, index) => {
    const holder = document.getElementById('embed-' + index);
    if (!holder) return;
    iframeApi.createController(holder, {
      width: '100%',
      height: item.type === 'track' ? '152' : '352',
      url: item.url
    }, controller => {
      controllers.set(index, controller);
      controller.addListener('playback_update', event => {
        const data = event.data;
        if (!item.repeat || !data || !data.duration) return;
        if (data.isPaused && data.duration - data.position < 1500) controller.restart();
      });
    });
  });
}

async function loadMetadata(index, item) {
  try {
    const response = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent(item.url));
    if (!response.ok) return;
    const data = await response.json();
    const title = document.getElementById('title-' + index);
    if (title && data.title) title.textContent = data.title;
  } catch (error) {}
}
