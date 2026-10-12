// Local-only smoke-test entry; the core router imports preview.ts directly.
import { injectMeta, renderPreviewPng } from '../src/preview';

export default {
  async fetch(request: Request): Promise<Response> {
    const opts = await request.json() as {key: string, ext?: string, data: string, url: string, imageUrl: string};
    if (new URL(request.url).pathname === '/meta') {
      return new Response(injectMeta('<head></head>', opts), {headers: {'content-type': 'text/html'}});
    }
    const png = await renderPreviewPng(opts.key, opts.ext, opts.data, new URL(request.url).host);
    return new Response(new Uint8Array(png).buffer, {headers: {'content-type': 'image/png'}});
  },
};
