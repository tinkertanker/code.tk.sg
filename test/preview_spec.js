/* global describe, it */

const { strictEqual, ok } = require('assert');
const preview = require('../lib/preview');

describe('link previews', function(){
	it('escapes paste content in the meta tags', function(){
		const html = preview.injectMeta('<head></head>', {
			key: 'abc', data: '"><script>alert(1)</script>', url: 'https://code.tk.sg/abc', image: 'https://code.tk.sg/preview/abc.png'
		});
		ok(!html.includes('<script>'));
		ok(html.includes('content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"'));
		ok(html.includes('<meta property="og:image" content="https://code.tk.sg/preview/abc.png" />'));
	});

	it('collapses whitespace and truncates descriptions', function(){
		strictEqual(preview.describe('a\n\n\tb  c'), 'a b c');
		strictEqual(preview.describe('x'.repeat(500)).length, 200);
	});

	it('renders highlighted code as a PNG', function(){
		const svg = preview.buildSvg('abc', 'def f():\n\treturn "<hi>"\n', 'py');
		ok(svg.includes('fill="#859900">def</tspan>'));
		ok(svg.includes('&lt;hi&gt;'));
		const png = preview.renderImage('abc', 'print(1)', 'py');
		strictEqual(png.subarray(1, 4).toString(), 'PNG');
	});

	it('leaves txt pastes unhighlighted', function(){
		const svg = preview.buildSvg('abc', 'def f(): pass', 'txt');
		ok(svg.includes('<tspan fill="#839496">def f(): pass</tspan>'));
	});
});
