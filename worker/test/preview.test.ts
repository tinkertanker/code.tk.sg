import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { injectMeta, renderPreviewPng } from '../src/preview';

const opts = {key: 'legacykey', data: 'old paste é <&>', url: 'https://code.tk.sg/legacykey.py', imageUrl: 'https://code.tk.sg/preview/legacykey.py.png'};
const render = (data: string, ext: string | undefined = 'txt') => renderPreviewPng('legacykey', ext, data, 'code.tk.sg');

describe('preview metadata compatibility', () => {
  it('injects all Rust OpenGraph and Twitter tags before the existing head closes', () => {
    const html = injectMeta('<head><title>unchanged</title></head><body>paste</body>', opts);
    const tags = [...html.matchAll(/<meta (property|name)="([^"]+)" content="([^"]*)" \/>/g)]
      .map(([, attr, name, value]) => [attr, name, value]);
    expect(tags).toEqual([
      ['property', 'og:site_name', 'code.tk.sg'],
      ['property', 'og:type', 'article'],
      ['property', 'og:title', 'code.tk.sg - legacykey'],
      ['property', 'og:description', 'old paste é &lt;&amp;&gt;'],
      ['property', 'og:url', opts.url],
      ['property', 'og:image', opts.imageUrl],
      ['property', 'og:image:type', 'image/png'],
      ['property', 'og:image:width', '1200'],
      ['property', 'og:image:height', '900'],
      ['name', 'twitter:card', 'summary_large_image'],
      ['name', 'twitter:title', 'code.tk.sg - legacykey'],
      ['name', 'twitter:description', 'old paste é &lt;&amp;&gt;'],
      ['name', 'twitter:image', opts.imageUrl],
    ]);
    expect(html).toMatch(/^<head><title>unchanged<\/title>/);
    expect(html).toMatch(/\n\t<\/head><body>paste<\/body>$/);
  });

  it('escapes user-controlled content and collapses JavaScript whitespace', () => {
    const html = injectMeta('</head>', {...opts, key: '<"&>', data: '\uFEFFa\uFEFFb\tc\r\n d\u00A0', url: 'https://other/<"&>', imageUrl: '<"&>'});
    expect(html).toContain('content="code.tk.sg - &lt;&quot;&amp;&gt;"');
    expect(html).toContain('content="a b c d"');
    expect(html).toContain('content="https://other/&lt;&quot;&amp;&gt;"');
    expect(html).toContain('content="&lt;&quot;&amp;&gt;"');
  });

  it('inserts replacement metacharacters literally without copying page scripts', () => {
    const data = "$` $' $$ $& <\"&>";
    const html = injectMeta('<head><script>bootstrap()</script></head><body>paste</body>', {...opts, data});
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html.match(/<body>/g)).toHaveLength(1);
    expect(html.match(/<\/head>/g)).toHaveLength(1);
    expect(html).toContain('property="og:description" content="$` $\' $$ $&amp; &lt;&quot;&amp;&gt;"');
    expect(html).toContain('name="twitter:description" content="$` $\' $$ $&amp; &lt;&quot;&amp;&gt;"');
  });

  it('truncates at UTF-16 boundaries including a split astral character', () => {
    for (const [data, expected] of [
      ['a'.repeat(200), 'a'.repeat(200)],
      ['a'.repeat(201), 'a'.repeat(199) + '…'],
      ['😀'.repeat(101), '😀'.repeat(99) + '�…'],
    ]) expect(injectMeta('</head>', {...opts, data})).toContain(`content="${expected}"`);
    expect(injectMeta('<body>no head</body>', opts)).toBe('<body>no head</body>');
  });
});

describe('preview PNG compatibility', () => {
  it('can initialize once for concurrent first calls', async () => {
    const images = await Promise.all([render('same'), render('same'), render('same')]);
    expect(images[1]).toEqual(images[0]);
    expect(images[2]).toEqual(images[0]);
  });

  it.each(['py', 'txt', 'unknown', undefined, 'constructor'])('renders a 1200×900 PNG for extension %s', async ext => {
    const bytes = await renderPreviewPng('legacykey', ext, opts.data, 'code.tk.sg');
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const png = PNG.sync.read(Buffer.from(bytes));
    expect([png.width, png.height]).toEqual([1200, 900]);
    const pixel = (x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
    expect(pixel(0, 0)).toEqual([7, 54, 66, 255]);
    expect(pixel(0, 96)).toEqual([0, 0, 0, 255]);
    expect(pixel(0, 899)).toEqual([0, 0, 0, 255]);
    expect(pixel(70, 45)).not.toEqual([7, 54, 66, 255]); // bundled logo, not a blank header
    expect(png.data.some((v, i) => i >= 120 * 1200 * 4 && i < 180 * 1200 * 4 && v > 0 && i % 4 !== 3)).toBe(true);
  });

  it('handles Ruby astral tokens without invalid XML or a render failure', async () => {
    const png = PNG.sync.read(Buffer.from(await render('puts ?😀', 'rb')));
    expect([png.width, png.height]).toEqual([1200, 900]);
  });

  it('maps extensions to languages and preserves the fixed Rust image brand', async () => {
    expect(await render('def greet(name):\n\treturn "hello " + name', 'py'))
      .toEqual(await render('def greet(name):\n\treturn "hello " + name', 'python'));
    expect(await render('plain text')).toEqual(await renderPreviewPng('legacykey', 'txt', 'plain text', '<other-host>'));
    expect(await render('const x = 42;', 'js')).not.toEqual(await render('const x = 42;', 'txt'));
    expect(await render('const x = 42;', 'unknown')).toEqual(await renderPreviewPng('legacykey', undefined, 'const x = 42;', 'code.tk.sg'));
  });

  it('normalizes CRLF and tabs and clips lines by Unicode scalars, not UTF-16 units', async () => {
    expect(await render('a\r\n\tb\r\n')).toEqual(await render('a\n    b\n'));
    expect(await render('😀'.repeat(39) + 'aTAIL')).toEqual(await render('😀'.repeat(39) + 'bOTHER'));
    expect(await render('a'.repeat(40))).not.toEqual(await render('a'.repeat(41)));
    expect(await render('<&> "quoted" &#x27;')).not.toEqual(await render('<&> "quoted" \''));
  });

  it('bounds the visible snippet, but counts every line including the trailing newline', async () => {
    const visible = Array.from({length: 13}, (_, i) => `line ${i}`).join('\n');
    expect(await render(visible + '\nhidden A')).toEqual(await render(visible + '\nhidden B'));
    expect(await render(visible + '\n')).not.toEqual(await render(visible));
  });
});
