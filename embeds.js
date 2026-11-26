const STORAGE_KEY = 'spotify_embeds';

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('add-btn').addEventListener('click', addEmbed);
  document.getElementById('spotify-url').addEventListener('keydown', event => {
    if (event.key === 'Enter') addEmbed();
  });
  render();
});

function getEmbeds() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveEmbeds(embeds) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(embeds));
}

function toEmbedUrl(value) {
  const match = value.match(/open\.spotify\.com\/(playlist|album|track|show|episode)\/([A-Za-z0-9]+)/);
  if (!match) return null;
  return 'https://open.spotify.com/embed/' + match[1] + '/' + match[2];
}

function addEmbed() {
  const input = document.getElementById('spotify-url');
  const embedUrl = toEmbedUrl(input.value.trim());
  const error = document.getElementById('embed-error');
  if (!embedUrl) {
    error.textContent = 'Enlace no válido. Debe ser de open.spotify.com.';
    return;
  }
  error.textContent = '';
  input.value = '';
  const embeds = getEmbeds();
  embeds.push(embedUrl);
  saveEmbeds(embeds);
  render();
}

function render() {
  const container = document.getElementById('embeds');
  container.innerHTML = '';
  getEmbeds().forEach((url, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'embed-item';

    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.width = '100%';
    iframe.height = url.includes('/track/') ? '152' : '352';
    iframe.frameBorder = '0';
    iframe.allow = 'encrypted-media';
    iframe.allowFullscreen = true;

    const remove = document.createElement('button');
    remove.textContent = 'Quitar';
    remove.addEventListener('click', () => {
      const embeds = getEmbeds();
      embeds.splice(index, 1);
      saveEmbeds(embeds);
      render();
    });

    wrapper.append(remove, iframe);
    container.appendChild(wrapper);
  });
}
