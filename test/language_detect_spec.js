/* global describe, it */

const { strictEqual, ok } = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const detect = require('../static/language-detect');
const samples = require('./fixtures/language_samples');

// Load the browser bundle exactly as the page does.
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/highlight.min.js'), 'utf8') + ';this.hljs = hljs;', context);
const hljs = context.hljs;

describe('language detection', function(){
	it('only auto-detects bundled languages', function(){
		detect.AUTO_LANGUAGES.forEach(language => ok(hljs.getLanguage(language), language));
	});

	it('bundles the extra modern languages', function(){
		['dart', 'dockerfile', 'elixir', 'powershell', 'nix', 'protobuf', 'julia'].forEach(language => ok(hljs.getLanguage(language), language));
	});

	Object.keys(samples).forEach(language => {
		samples[language].forEach((code, i) => {
			it(`detects ${language} sample ${i + 1}`, function(){
				strictEqual(detect.highlightAuto(hljs, code).language, language);
			});
		});
	});

	[
		'hello',
		'Hi all,\n\nPlease remember to submit your project by Friday. Ask Sam if you need help.',
		'name,age,city\nAlice,30,Singapore\nBob,25,London',
		'from here we walk to the shop',
	].forEach(text => {
		it(`leaves ${JSON.stringify(text.slice(0, 20))} as plain text`, function(){
			strictEqual(detect.highlightAuto(hljs, text).language, undefined);
		});
	});

	it('escapes HTML in plain text', function(){
		strictEqual(detect.highlightAuto(hljs, '<b>&').value, '&lt;b&gt;&amp;');
	});

	it('escapes HTML in highlighted code', function(){
		const result = detect.highlightAuto(hljs, 'def f():\n    return "<img src=x onerror=alert(1)>"');
		strictEqual(result.language, 'python');
		ok(!result.value.includes('<img'));
	});

	it('stays fast on large pathological pastes', function(){
		this.timeout(20000);
		['\n', '[', 'select 1;\n', 'func a(\n', '"\\(a'].forEach(unit => {
			const start = Date.now();
			detect.highlightAuto(hljs, unit.repeat(Math.ceil(400000 / unit.length)));
			ok(Date.now() - start < 5000, `${JSON.stringify(unit)} took ${Date.now() - start}ms`);
		});
	});
});
