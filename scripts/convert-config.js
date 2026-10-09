// Run only on a trusted local JS configuration. Refuses to overwrite the output.
const fs = require('fs');
const path = require('path');
const input = process.argv[2] || 'config.js';
const output = process.argv[3] || 'config.json';
const config = require(path.resolve(input));
if (!['file', 'redis'].includes(config.storage?.type || 'file')) {
	throw new Error('Rust supports file and Redis storage; migrate other adapters explicitly before switching.');
}
fs.writeFileSync(output, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
