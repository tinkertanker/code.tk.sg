import hljs from 'highlight.js';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import font from '../../lib/fonts/DejaVuSansMono.ttf';
import fontBold from '../../lib/fonts/DejaVuSansMono-Bold.ttf';
import logo from '../../static/tinkercademy.png';

const FOREGROUND = '#839496';
const FONT_SIZE = (1200 - 96) / (40 * 0.602 + 2.5);
const LINE_HEIGHT = Math.round(FONT_SIZE * 1.4);
const LINE_LIMIT = Math.floor((900 - 96 - 48) / LINE_HEIGHT);
const logoUrl = `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(logo)))}`;
let initialized: Promise<void> | undefined;

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Rust converts UTF-16 slices (and highlight.js's split surrogate tokens) lossily.
function unicode(value: string): string {
  return value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g,
    pair => pair.length === 2 ? pair : '\uFFFD');
}

export function injectMeta(indexHtml: string, opts: {key: string, data: string, url: string, imageUrl: string}): string {
  let description = opts.data.replace(/\s+/g, ' ').trim();
  if (description.length > 200) description = unicode(description.slice(0, 199)) + '…';
  const title = `code.tk.sg - ${opts.key}`;
  const tags = [
    ['property', 'og:site_name', 'code.tk.sg'],
    ['property', 'og:type', 'article'],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['property', 'og:url', opts.url],
    ['property', 'og:image', opts.imageUrl],
    ['property', 'og:image:type', 'image/png'],
    ['property', 'og:image:width', '1200'],
    ['property', 'og:image:height', '900'],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', title],
    ['name', 'twitter:description', description],
    ['name', 'twitter:image', opts.imageUrl],
  ].map(([attr, name, value]) => `\t\t<meta ${attr}="${name}" content="${escape(value)}" />`).join('\n');
  return indexHtml.replaceAll('</head>', () => `${tags}\n\t</head>`);
}

const languages: Record<string, string> = {
  rb: 'ruby', py: 'python', pl: 'perl', html: 'xml', htm: 'xml', js: 'javascript',
  vbs: 'vbscript', pas: 'delphi', dpr: 'delphi', cc: 'cpp', m: 'objectivec',
  sm: 'smalltalk', sh: 'bash', erl: 'erlang', hs: 'haskell', md: 'markdown', txt: '',
  coffee: 'coffeescript', cs: 'csharp', kt: 'kotlin', lsp: 'lisp', mk: 'makefile',
  phptemp: 'php-template', pyrepl: 'python-repl', rs: 'rust', sc: 'scala',
};

const colours: Record<string, string> = {};
for (const [colour, scopes] of [
  ['#586e75', 'comment quote tag'],
  ['#859900', 'keyword selector-tag addition code template-tag'],
  ['#2aa198', 'number string meta-string literal doctag regexp'],
  ['#268bd2', 'title section name selector-id selector-class'],
  ['#b58900', 'attribute attr variable template-variable type'],
  ['#cb4b16', 'symbol bullet subst operator punctuation meta selector-attr selector-pseudo link'],
  ['#dc322f', 'built_in deletion'],
]) {
  for (const scope of scopes.split(' ')) colours[scope] = colour;
}

function tokenise(html: string): [string, string][][] {
  const lines: [string, string][][] = [[]];
  const stack = [FOREGROUND];
  // Only highlight.js output reaches here: escaped text and nested spans.
  for (const match of html.matchAll(/<span class="([^"]*)">|<\/span>|([^<]+)/g)) {
    if (match[1] !== undefined) {
      const colour = match[1].split(/\s+/).map(scope => colours[scope.replace(/^hljs-/, '')]).find(Boolean);
      stack.push(colour ?? stack[stack.length - 1]);
    } else if (match[0] === '</span>') {
      if (stack.length > 1) stack.pop();
    } else {
      const text = match[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
      text.split('\n').forEach((part, i) => {
        if (i) lines.push([]);
        if (part) lines[lines.length - 1].push([part, stack[stack.length - 1]]);
      });
    }
  }
  return lines;
}

function buildSvg(key: string, ext: string | undefined, data: string): string {
  // Bound highlighting before running any language grammar, even for huge pastes.
  const snippet = data.split('\n', LINE_LIMIT).map(line =>
    unicode(line.replace(/\r$/, '').replace(/\t/g, '    ').slice(0, 2000))).join('\n');
  const language = ext === undefined ? undefined : (Object.hasOwn(languages, ext) ? languages[ext] : ext);
  const high = language === '' ? {value: escape(snippet), language: undefined}
    : language && hljs.getLanguage(language) ? hljs.highlight(snippet, {language})
      : hljs.highlightAuto(snippet);
  const totalLines = 1 + (data.match(/\n/g)?.length ?? 0);
  const count = `${totalLines} line${totalLines === 1 ? '' : 's'}`;
  const label = high.language ? `${high.language} · ${count}` : count;
  const codeX = 48 + FONT_SIZE * 2.5;
  let body = '';
  tokenise(unicode(high.value)).slice(0, LINE_LIMIT).forEach((runs, i) => {
    const y = Math.round(96 + 24 + (i + 0.75) * LINE_HEIGHT);
    body += `<text x="${Math.round(codeX - FONT_SIZE * 0.9)}" y="${y}" fill="#586e75" text-anchor="end">${i + 1}</text>`;
    const clipped = runs.reduce((n, [text]) => n + Array.from(text).length, 0) > 40;
    let remaining = clipped ? 39 : 40;
    let colour = FOREGROUND;
    body += `<text x="${Math.round(codeX)}" y="${y}" xml:space="preserve">`;
    for (const [text, c] of runs) {
      if (!remaining) break;
      const chunk = Array.from(text).slice(0, remaining);
      remaining -= chunk.length;
      colour = c;
      body += `<tspan fill="${c}">${escape(chunk.join(''))}</tspan>`;
    }
    if (clipped) body += `<tspan fill="${colour}">…</tspan>`;
    body += '</text>';
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
width="1200" height="900" viewBox="0 0 1200 900">
<rect width="100%" height="100%" fill="#000000"/>
<rect width="100%" height="96" fill="#073642"/>
<image x="48" y="24" width="48" height="48" xlink:href="${logoUrl}"/>
<g font-family="DejaVu Sans Mono" font-size="28">
<text x="112" y="58" fill="#eee8d5">code.tk.sg/${escape(key)}</text>
<text x="1152" y="58" fill="#93a1a1" text-anchor="end">${escape(label)}</text>
</g>
<g font-family="DejaVu Sans Mono" font-weight="bold" font-size="${FONT_SIZE.toFixed(1)}">${body}</g>
<rect y="820" width="100%" height="80" fill="url(#fade)"/>
<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000"/>
</linearGradient></defs></svg>`;
}

export async function renderPreviewPng(key: string, ext: string | undefined, data: string, host: string): Promise<Uint8Array> {
  // Keep Rust's fixed brand in the image; host only affects caller-supplied metadata URLs.
  void host;
  initialized ??= initWasm(wasm);
  await initialized;
  const renderer = new Resvg(buildSvg(key, ext, data), {
    font: {fontBuffers: [new Uint8Array(font), new Uint8Array(fontBold)], defaultFontFamily: 'DejaVu Sans Mono', loadSystemFonts: false},
  });
  try {
    const image = renderer.render();
    try { return image.asPng(); } finally { image.free(); }
  } finally {
    renderer.free();
  }
}
