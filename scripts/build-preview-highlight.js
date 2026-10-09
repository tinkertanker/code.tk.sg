// Build the same complete highlight.js registry used by the former Node server.
// Only this syntax engine remains JavaScript; QuickJS runs it inside Rust.
const fs = require('fs');
const path = require('path');
const root = path.dirname(require.resolve('highlight.js/lib/core'));
let bundle = 'var hljs = (function(){var module = {exports:{}}; var exports = module.exports;\n';
bundle += fs.readFileSync(path.join(root, 'core.js'), 'utf8');
bundle += '\nreturn module.exports;})();\n';
const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
for (const match of index.matchAll(/registerLanguage\('([^']+)', require\('\.\/languages\/([^']+)'\)\)/g)) {
	bundle += `(function(){var module = {exports:{}}; var exports = module.exports;\n${fs.readFileSync(path.join(root, 'languages', match[2] + '.js'), 'utf8')}\nhljs.registerLanguage(${JSON.stringify(match[1])}, module.exports);})();\n`;
}
bundle += String.raw`function highlightSnippet(text, lang) {
var result = lang && hljs.getLanguage(lang) ? hljs.highlight(text, {language: lang}) : hljs.highlightAuto(text);
// Match Node's UTF-8 conversion when highlighting splits a surrogate pair across spans.
result.value = result.value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, function(value) {
return value.length === 2 ? value : "\uFFFD";
});
return JSON.stringify({value: result.value, language: result.language || null});
}`;
fs.writeFileSync(path.join(__dirname, '../lib/preview-highlight.js'), bundle);
