const fs = require('fs');
const path = require('path');
const hljs = require('highlight.js');
const { Resvg } = require('@resvg/resvg-js');

// Builds link previews (Open Graph tags and a rendered PNG snippet) for pastes

const WIDTH = 1200;
const HEIGHT = 630;
const PADDING = 48;
const HEADER_HEIGHT = 96;
const COLS = 68;
const CHAR_WIDTH = 0.602; // DejaVu Sans Mono advance width, in ems
const GUTTER = 2.5; // line number column, in ems

// Size the code so that `cols` characters fill the width
const layoutFor = ({ cols = COLS, height = HEIGHT } = {}) => {
	const fontSize = (WIDTH - PADDING * 2) / (cols * CHAR_WIDTH + GUTTER);
	const lineHeight = Math.round(fontSize * 1.4);
	return {
		cols, height, fontSize, lineHeight,
		gutter: fontSize * GUTTER,
		lines: Math.floor((height - HEADER_HEIGHT - PADDING) / lineHeight)
	};
};
const DESCRIPTION_LENGTH = 200;
const CACHE_SIZE = 200;

const FONT_FILE = path.join(__dirname, 'fonts', 'DejaVuSansMono.ttf');
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'static', 'tinkercademy.png')).toString('base64');

// Mirrors static/solarized_dark.css
const BACKGROUND = '#000000';
const FOREGROUND = '#839496';
const COLOURS = {};
const palette = {
	'#586e75': ['comment', 'quote', 'tag'],
	'#859900': ['keyword', 'selector-tag', 'addition', 'code', 'template-tag'],
	'#2aa198': ['number', 'string', 'meta-string', 'literal', 'doctag', 'regexp'],
	'#268bd2': ['title', 'section', 'name', 'selector-id', 'selector-class'],
	'#b58900': ['attribute', 'attr', 'variable', 'template-variable', 'type'],
	'#cb4b16': ['symbol', 'bullet', 'subst', 'operator', 'punctuation', 'meta', 'selector-attr', 'selector-pseudo', 'link'],
	'#dc322f': ['built_in', 'deletion']
};
for (const colour in palette) for (const scope of palette[colour]) COLOURS[scope] = colour;

// Same as haste.extensionMap in static/application.js
const EXTENSIONS = {
	rb: 'ruby', py: 'python', pl: 'perl', php: 'php', scala: 'scala', go: 'go',
	xml: 'xml', html: 'xml', htm: 'xml', css: 'css', js: 'javascript', vbs: 'vbscript',
	lua: 'lua', pas: 'delphi', java: 'java', cpp: 'cpp', cc: 'cpp', m: 'objectivec',
	vala: 'vala', sql: 'sql', sm: 'smalltalk', lisp: 'lisp', ini: 'ini',
	diff: 'diff', bash: 'bash', sh: 'bash', tex: 'tex', erl: 'erlang', hs: 'haskell',
	md: 'markdown', txt: '', coffee: 'coffeescript', json: 'json', swift: 'swift',
	apache: 'apache', c: 'c', cs: 'csharp', dpr: 'delphi', graphql: 'graphql',
	http: 'http', kt: 'kotlin', less: 'less', lsp: 'lisp', mk: 'makefile',
	nginx: 'nginx', phptemp: 'php-template', properties: 'properties',
	pyrepl: 'python-repl', r: 'r', rs: 'rust', sc: 'scala', scss: 'scss',
	shell: 'shell', ts: 'typescript', vbnet: 'vbnet', wasm: 'wasm', yaml: 'yaml'
};

const escapeXml = s => s
	.replace(/&/g, '&amp;')
	.replace(/</g, '&lt;')
	.replace(/>/g, '&gt;')
	.replace(/"/g, '&quot;');

const unescapeHtml = s => s
	.replace(/&lt;/g, '<')
	.replace(/&gt;/g, '>')
	.replace(/&quot;/g, '"')
	.replace(/&#x27;/g, '\'')
	.replace(/&amp;/g, '&');

// Only the visible lines are highlighted, so large pastes stay cheap. Lines are
// clipped when drawn rather than here, so clipping cannot leave a string or
// bracket open and change how the following lines are highlighted.
const LINE_LIMIT = 2000;
const snippetOf = (data, { lines }) => data
	.split('\n', lines)
	.map(line => line.replace(/\r$/, '').replace(/\t/g, '    ').slice(0, LINE_LIMIT))
	.join('\n');

// Resolve an extension like the client does: '' for plain text, a known
// highlight.js language, or undefined for auto-detection
const languageFor = extension => {
	if (extension === undefined) return undefined;
	const lang = Object.prototype.hasOwnProperty.call(EXTENSIONS, extension) ? EXTENSIONS[extension] : extension;
	return lang === '' || hljs.getLanguage(lang) ? lang : undefined;
};

// Highlight like the client does, returning the HTML and detected language
const highlight = (text, lang) => {
	if (lang === '') return { value: escapeXml(text), language: null };
	return lang ? hljs.highlight(text, { language: lang }) : hljs.highlightAuto(text);
};

const colourFor = (classes, parent) => {
	for (const cls of classes.split(/\s+/)) {
		const colour = COLOURS[cls.replace(/^hljs-/, '')];
		if (colour) return colour;
	}
	return parent;
};

// Turn highlight.js HTML into lines of [text, colour] runs
const tokenise = html => {
	const lines = [[]];
	const stack = [FOREGROUND];
	const pattern = /<span class="([^"]*)">|<\/span>|([^<]+)/g;
	let match;
	while ((match = pattern.exec(html))) {
		if (match[1] !== undefined) stack.push(colourFor(match[1], stack[stack.length - 1]));
		else if (match[2] === undefined) { if (stack.length > 1) stack.pop(); }
		else {
			const parts = unescapeHtml(match[2]).split('\n');
			parts.forEach((part, i) => {
				if (i > 0) lines.push([]);
				if (part) lines[lines.length - 1].push([part, stack[stack.length - 1]]);
			});
		}
	}
	return lines;
};

const renderLine = (runs, x, y, cols) => {
	let remaining = cols;
	let spans = '';
	for (const [text, colour] of runs) {
		if (remaining <= 0) break;
		let chunk = Array.from(text);
		if (chunk.length > remaining) chunk = chunk.slice(0, Math.max(remaining - 1, 0)).concat('…');
		remaining -= chunk.length;
		spans += `<tspan fill="${colour}">${escapeXml(chunk.join(''))}</tspan>`;
	}
	return `<text x="${x}" y="${y}" xml:space="preserve">${spans}</text>`;
};

const buildSvg = (key, data, extension, options) => {
	const layout = layoutFor(options);
	const snippet = snippetOf(data, layout);
	const high = highlight(snippet, languageFor(extension));
	const lines = tokenise(high.value).slice(0, layout.lines);
	const codeX = PADDING + layout.gutter;
	const totalLines = data.split('\n').length;
	const label = [high.language, `${totalLines} line${totalLines === 1 ? '' : 's'}`].filter(Boolean).join(' · ');

	let body = '';
	lines.forEach((runs, i) => {
		const y = Math.round(HEADER_HEIGHT + PADDING / 2 + (i + 0.75) * layout.lineHeight);
		body += `<text x="${Math.round(codeX - layout.fontSize * 0.9)}" y="${y}" fill="#586e75" text-anchor="end">${i + 1}</text>`;
		body += renderLine(runs, Math.round(codeX), y, layout.cols);
	});

	return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
width="${WIDTH}" height="${layout.height}" viewBox="0 0 ${WIDTH} ${layout.height}">
<rect width="100%" height="100%" fill="${BACKGROUND}"/>
<rect width="100%" height="${HEADER_HEIGHT}" fill="#073642"/>
<image x="${PADDING}" y="24" width="48" height="48" xlink:href="${LOGO}"/>
<g font-family="DejaVu Sans Mono" font-size="28">
<text x="${PADDING + 64}" y="58" fill="#eee8d5">code.tk.sg/${escapeXml(key)}</text>
<text x="${WIDTH - PADDING}" y="58" fill="#93a1a1" text-anchor="end">${escapeXml(label)}</text>
</g>
<g font-family="DejaVu Sans Mono" font-size="${layout.fontSize.toFixed(1)}">${body}</g>
<rect y="${layout.height - 80}" width="100%" height="80" fill="url(#fade)"/>
<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${BACKGROUND}" stop-opacity="0"/><stop offset="1" stop-color="${BACKGROUND}"/>
</linearGradient></defs>
</svg>`;
};

const cache = new Map();

const renderPng = svg => new Resvg(svg, {
	font: { fontFiles: [FONT_FILE], loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans Mono' }
}).render().asPng();

// Render (and cache) the PNG preview for a paste; pastes never change once saved
const renderImage = (key, data, extension) => {
	// Key on the resolved language so unknown extensions share one entry
	const cacheKey = `${key}.${languageFor(extension) ?? '*'}`;
	if (cache.has(cacheKey)) return cache.get(cacheKey);
	const png = renderPng(buildSvg(key, data, extension));
	cache.set(cacheKey, png);
	if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
	return png;
};

// A plain-text excerpt for og:description
const describe = data => {
	const text = data.replace(/\s+/g, ' ').trim();
	return text.length > DESCRIPTION_LENGTH ? text.slice(0, DESCRIPTION_LENGTH - 1) + '…' : text;
};

// Insert Open Graph and Twitter card tags into the index page
const injectMeta = (html, { key, data, url, image }) => {
	const title = `code.tk.sg - ${key}`;
	const tags = [
		['property', 'og:site_name', 'code.tk.sg'],
		['property', 'og:type', 'article'],
		['property', 'og:title', title],
		['property', 'og:description', describe(data)],
		['property', 'og:url', url],
		['property', 'og:image', image],
		['property', 'og:image:type', 'image/png'],
		['property', 'og:image:width', String(WIDTH)],
		['property', 'og:image:height', String(HEIGHT)],
		['name', 'twitter:card', 'summary_large_image'],
		['name', 'twitter:title', title],
		['name', 'twitter:description', describe(data)],
		['name', 'twitter:image', image]
	].map(([attr, name, content]) => `\t\t<meta ${attr}="${name}" content="${escapeXml(content)}" />`).join('\n');
	return html.replace('</head>', `${tags}\n\t</head>`);
};

module.exports = { renderImage, renderPng, injectMeta, buildSvg, describe };
