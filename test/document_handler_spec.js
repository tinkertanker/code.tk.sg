/* global describe, it */

const { strictEqual } = require('assert');
const DocumentHandler = require('../lib/document_handler');
const Generator = require('../lib/key_generators/random');
const { PassThrough } = require('stream');

describe('upload limits', function(){
	function upload(type, limit = 4){
		const req = new PassThrough();
		req.headers = { 'content-type': type };
		const result = { saves: [], status: null };
		result.done = new Promise(resolve => {
			const res = { status(code){ result.status = code; return this; }, json(body){ result.body = body; resolve(); } };
			const handler = new DocumentHandler({ maxLength: limit, keyGenerator: { createKey: () => 'key' }, store: {
				get: async () => null,
				set: async (key, value) => { result.saves.push(value); return true; }
			} });
			handler.handlePost(req, res);
		});
		return { req, result };
	}

	it('rejects oversized raw uploads before the request ends', async function(){
		const { req, result } = upload('text/plain');
		req.write('12345');
		strictEqual(result.status, 413);
		req.end();
		await result.done;
		strictEqual(result.saves.length, 0);
	});

	it('preserves UTF-8 split across chunks at the byte limit', async function(){
		const { req, result } = upload('text/plain');
		const bytes = Buffer.from('éab');
		req.write(bytes.subarray(0, 1));
		req.end(bytes.subarray(1));
		await result.done;
		strictEqual(result.status, 200);
		strictEqual(result.saves[0], 'éab');
	});

	it('rejects a multibyte body over the byte limit', async function(){
		const { req, result } = upload('text/plain');
		req.end('éabc');
		await result.done;
		strictEqual(result.status, 413);
	});

	it('returns 400 for a missing multipart boundary', async function(){
		const { req, result } = upload('multipart/form-data');
		req.end();
		await result.done;
		strictEqual(result.status, 400);
	});

	for (const [value, status] of [['1234', 200], ['12345', 413]]){
		it(`handles multipart field size ${value.length}`, async function(){
			const { req, result } = upload('multipart/form-data; boundary=test');
			req.end(`--test\r\nContent-Disposition: form-data; name="data"\r\n\r\n${value}\r\n--test--\r\n`);
			await result.done;
			strictEqual(result.status, status);
			strictEqual(result.saves.length, status === 200 ? 1 : 0);
		});
	}

	it('rejects truncated multipart input without saving', async function(){
		const { req, result } = upload('multipart/form-data; boundary=test');
		req.end('--test\r\nContent-Disposition: form-data; name="data"\r\n\r\nabc');
		await result.done;
		strictEqual(result.status, 400);
		strictEqual(result.saves.length, 0);
	});

	it('rejects duplicate fields without saving the first', async function(){
		const { req, result } = upload('multipart/form-data; boundary=test');
		req.end('--test\r\nContent-Disposition: form-data; name="data"\r\n\r\na\r\n--test\r\nContent-Disposition: form-data; name="data"\r\n\r\nb\r\n--test--\r\n');
		await result.done;
		strictEqual(result.status, 413);
		strictEqual(result.saves.length, 0);
	});
});

describe('DocumentHandler', function(){

	describe('random', function(){
		it('should choose a key of the proper length', function(){
			let gen = new Generator();
			let dh = new DocumentHandler({ keyLength: 6, keyGenerator: gen });
			strictEqual(6, dh.acceptableKey().length);
		});

		it('should choose a default key length', function(){
			let gen = new Generator();
			let dh = new DocumentHandler({ keyGenerator: gen });
			strictEqual(dh.keyLength, DocumentHandler.defaultKeyLength);
		});
	});

});
