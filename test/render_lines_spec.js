/* global describe, it */

const { strictEqual, ok } = require('assert');
const { readFileSync } = require('fs');
const { runInNewContext } = require('vm');
const hljs = require('highlight.js');

const context = { $: () => {} }; // Do not run page-ready handlers in Node.
runInNewContext(readFileSync(require.resolve('../static/application.js'), 'utf8'), context);

function render(html) {
	let output;
	context.haste.prototype.renderLines.call({
		$code: { html: value => { output = value; } },
		$linenos: { html: () => {} },
		fitKeySpacer: () => {}
	}, html);
	return output;
}

describe('highlighted line rendering', function() {
	it('preserves multiline highlighting, blank lines and escaped text', function() {
		const html = hljs.highlight('/* first\n\n<&> last */\n', { language: 'rust' }).value;
		const out = render(html);
		strictEqual((out.match(/class="line"/g) || []).length, 4);
		ok(out.includes('<span class="line"><span class="hljs-comment">/* first</span></span>'));
		ok(out.includes('<span class="line"><br/></span>'));
		ok(out.includes('<span class="line"><span class="hljs-comment">&lt;&amp;&gt; last */</span></span>'));
	});

	it('falls back to escaped plain lines before nested multiline highlighting multiplies the DOM', function() {
		const text = '/*'.repeat(300) + '\nx <&>\n'.repeat(1000) + '*/'.repeat(300);
		const out = render(hljs.highlight(text, { language: 'rust' }).value);
		ok(out.length < 100000, `rendered ${out.length} characters from ${text.length}`);
		strictEqual((out.match(/class="line"/g) || []).length, 2001);
		strictEqual((out.match(/hljs-/g) || []).length, 0);
		strictEqual((out.match(/x &lt;&amp;&gt;/g) || []).length, 1000);
		ok(out.includes('/*'.repeat(300)));
		ok(out.includes('*/'.repeat(300)));
	});
});
