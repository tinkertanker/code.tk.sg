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

	it('returns plain text when nothing matches', function(){
		const result = detect.highlightAuto(hljs, 'hello');
		strictEqual(result.language, undefined);
		strictEqual(result.value, 'hello');
	});

	it('escapes HTML in plain text', function(){
		strictEqual(detect.highlightAuto(hljs, '<b>').value.includes('<b>'), false);
	});
});
