// Phase-2 integration placeholder. The preview owner replaces this module.
export async function renderPreviewPng(
  _key: string, _ext: string | undefined, _data: string, _host: string,
): Promise<Uint8Array> {
  throw new Error('Preview renderer pending phase-2 integration');
}

export function injectMeta(indexHtml: string, opts: {
  key: string; data: string; url: string; imageUrl: string;
}): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let description = opts.data.replace(/\s+/g, ' ').trim();
  if (description.length > 200) description = description.slice(0, 199) + '…';
  const tags = [
    ['property', 'og:site_name', 'code.tk.sg'],
    ['property', 'og:type', 'article'],
    ['property', 'og:title', `code.tk.sg - ${opts.key}`],
    ['property', 'og:description', description],
    ['property', 'og:url', opts.url],
    ['property', 'og:image', opts.imageUrl],
    ['property', 'og:image:type', 'image/png'],
    ['property', 'og:image:width', '1200'],
    ['property', 'og:image:height', '900'],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', `code.tk.sg - ${opts.key}`],
    ['name', 'twitter:description', description],
    ['name', 'twitter:image', opts.imageUrl],
  ].map(([attr, name, value]) => `<meta ${attr}="${name}" content="${escape(value)}" />`).join('\n');
  return indexHtml.replace('</head>', `${tags}\n</head>`);
}
