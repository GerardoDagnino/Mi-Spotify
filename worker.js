const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

addEventListener('fetch', event => {
  event.respondWith(handle(event.request));
});

async function handle(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  if (!target || !target.startsWith('https://api.spotify.com/')) {
    return new Response('Invalid target', { status: 400, headers: CORS });
  }

  const headers = new Headers();
  const auth = request.headers.get('Authorization');
  const contentType = request.headers.get('Content-Type');
  if (auth) headers.set('Authorization', auth);
  if (contentType) headers.set('Content-Type', contentType);

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body
  });

  const out = new Headers(CORS);
  const responseContentType = response.headers.get('Content-Type');
  if (responseContentType) out.set('Content-Type', responseContentType);

  return new Response(response.body, { status: response.status, headers: out });
}
