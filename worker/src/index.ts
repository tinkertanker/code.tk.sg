import type { Env } from './env';
import { Store } from './store';
import { upload, UploadError } from './upload';
import { rateLimit } from './ratelimit';
import { injectMeta, renderPreviewPng } from './preview';
export { RateLimiter } from './ratelimit';

const error = (status: number, message: string) => Response.json({ message }, { status });

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const read = method === 'GET' || method === 'HEAD';
  const store = new Store(env.DB, Number(env.EXPIRE));
  let path = url.pathname.replace(/^\/(documents|raw|preview)(?=\/|$)/i, prefix => prefix.toLowerCase());
  if (/^\/(documents|raw|preview)(\/|$)/.test(path)) path = path.replace(/\/$/, '');

  if (path === '/documents' && method === 'POST') {
    try {
      const data = await upload(request, Number(env.MAX_LENGTH));
      const key = await store.save(data, Number(env.KEY_LENGTH));
      return key ? Response.json({ key }) : error(503, 'Unable to save document.');
    } catch (e) {
      if (e instanceof UploadError) return error(e.status, e.message);
      console.error('Document save failed', e);
      return error(500, 'Internal server error occured while adding document.');
    }
  }
  const api = path.match(/^\/(documents|raw)\/([^/]+)$/);
  if (api) {
    if (!read) return new Response(null, { status: 404 });
    const key = decodeURIComponent(api[2]).split('.')[0];
    // Rust routes HEAD through the GET handler, including its renewal.
    const data = await store.get(key, true).catch(() => null);
    if (!data) return error(404, 'Document not found.');
    return api[1] === 'documents' ? Response.json({ key, data })
      : new Response(data, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const preview = path.match(/^\/preview\/([^/]+)$/);
  if (preview) {
    const file = decodeURIComponent(preview[1]);
    if (!read || !file.endsWith('.png')) return new Response(null, { status: 404 });
    const [key, ext] = file.slice(0, -4).split('.');
    const data = await store.get(key).catch(() => null);
    if (!data) return new Response(null, { status: 404 });
    try {
      const png = await renderPreviewPng(key, ext, data, request.headers.get('host') || url.host);
      return new Response(png as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } });
    } catch (e) {
      console.error('Preview rendering failed', e);
      return new Response(null, { status: 500 });
    }
  }
  if (!read) return new Response(null, { status: 404 });

  // Existing static files win; Worker-first preserves the shared rate limit.
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) {
    const response = new Response(asset.body, asset);
    response.headers.set('cache-control', `public, max-age=${env.STATIC_MAX_AGE}`);
    return response;
  }
  const id = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, ''));
  if (id.includes('/')) return new Response(null, { status: 404 });
  const [key, ext] = id.split('.');
  const data = await store.get(key).catch(() => null);
  const index = await env.ASSETS.fetch(new Request(new URL('/index.html', url), { method: 'GET' }));
  if (!index.ok) return new Response(null, { status: 500 });
  let html = await index.text();
  if (data) {
    const host = request.headers.get('host') || url.host;
    const origin = `${url.protocol}//${host}`;
    const file = encodeURIComponent(ext === undefined ? key : `${key}.${ext}`);
    html = injectMeta(html, { key, data, url: `${origin}/${file}`, imageUrl: `${origin}/preview/${file}.png` });
  }
  return new Response(html, { headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': `public, max-age=${data ? 300 : env.STATIC_MAX_AGE}`,
  } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const rate = await rateLimit(request, env);
    let response: Response;
    if (rate.limited) response = new Response('Too many requests, please try again later.', { status: 429 });
    else {
      try { response = await route(request, env); }
      catch (e) {
        console.error('Request failed', e);
        response = new Response(null, { status: e instanceof URIError ? 400 : 500 });
      }
    }
    response = new Response(request.method === 'HEAD' ? null : response.body, response);
    rate.headers.forEach((value, name) => response.headers.set(name, value));
    return response;
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await new Store(env.DB, Number(env.EXPIRE)).cleanup();
  },
} satisfies ExportedHandler<Env>;
