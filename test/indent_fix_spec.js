/* global describe, it */

const { strictEqual, deepStrictEqual } = require('assert');
const { analyze } = require('../static/indent-fix');

const types = result => result ? result.issues.map(issue => issue.type) : [];

describe('indentation fixing', function(){
	it('leaves well-indented code alone', function(){
		strictEqual(analyze('def f():\n    if x:\n        return 1\n'), null);
		strictEqual(analyze('function f() {\n  return 1;\n}\n'), null);
		strictEqual(analyze('int main() {\n\treturn 0;\n}\n'), null);
		strictEqual(analyze(''), null);
	});

	it('replaces non-breaking spaces in indentation only', function(){
		const result = analyze('def f():\n\u00a0\u00a0\u00a0\u00a0return "a\u00a0b"\n');
		deepStrictEqual(types(result), ['fake-spaces']);
		strictEqual(result.fixed, 'def f():\n    return "a\u00a0b"\n');
	});

	it('converts tabs mixed with spaces at the paste\'s indent width', function(){
		const result = analyze('def f():\n    if x:\n\t\treturn 1\n    return 2\n');
		deepStrictEqual(types(result), ['mixed-tabs']);
		strictEqual(result.issues[0].unit, 4);
		strictEqual(result.fixed, 'def f():\n    if x:\n        return 1\n    return 2\n');
		strictEqual(analyze('if (a) {\n  b();\n\tc();\n}').fixed, 'if (a) {\n  b();\n  c();\n}');
	});

	it('expands spaces before a tab to the next tab stop', function(){
		strictEqual(analyze('x:\n  \ty\n').fixed, 'x:\n    y\n');
	});

	it('keeps tabs where they are required or conventional', function(){
		const makefile = 'all: build\n\tgo build ./...\n\nclean:\n\trm -rf bin\n  # comment\n';
		strictEqual(analyze(makefile), null);
		strictEqual(analyze('func f() {\n\tx := 1\n  y()\n}', { language: 'go' }), null);
	});

	it('removes indentation shared by every line', function(){
		const result = analyze('    def f():\n        return 1\n\n    print(f())\n');
		deepStrictEqual(types(result), ['extra-indent']);
		strictEqual(result.issues[0].width, 4);
		strictEqual(result.fixed, 'def f():\n    return 1\n\nprint(f())\n');
	});

	it('fixes several problems in order', function(){
		const result = analyze('\u00a0\u00a0def f():\n\t\u00a0\u00a0return 1\n');
		deepStrictEqual(types(result), ['fake-spaces', 'mixed-tabs', 'extra-indent']);
		strictEqual(result.fixed, 'def f():\n  return 1\n');
	});

	it('preserves Windows line endings and is idempotent', function(){
		const result = analyze('  a\r\n  \tb\r\n');
		strictEqual(result.fixed, 'a\r\n  b\r\n');
		strictEqual(analyze(result.fixed), null);
	});

	it('treats a Makefile with comments before a recipe as a Makefile', function(){
		strictEqual(analyze('all:\n# note\n\t@echo ok\n  # note\n'), null);
	});

	it('never removes indentation inside multiline strings', function(){
		strictEqual(analyze('  const value = `\n  text\n  `;\n'), null);
		strictEqual(analyze('    s = """\n    body\n    """\n'), null);
	});

	it('drops a zero-width BOM from indentation', function(){
		strictEqual(analyze('x:\n\ufeff    y\n').fixed, 'x:\n    y\n');
	});
});
