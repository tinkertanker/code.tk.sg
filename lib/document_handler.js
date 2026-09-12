const winston = require('winston');
const Busboy = require('busboy');

// For handling serving stored documents

const DocumentHandler = function(options){
	if (!options) options = new Object;
	this.keyLength = options.keyLength || DocumentHandler.defaultKeyLength;
	this.maxLength = options.maxLength; // none by default
	this.store = options.store;
	this.keyGenerator = options.keyGenerator;
};

DocumentHandler.defaultKeyLength = 10;

// Handle retrieving a document
DocumentHandler.prototype.handleGet = async function(key, res, skipExpire){
	const data = await this.store.get(key, skipExpire);

	//when data is null it means there was either no data or an error
	if (!data){
		winston.warn('document not found', { key: key });
		res.status(404).json({ message: 'Document not found.' });
		return;
	}
	winston.verbose('retrieved document', { key: key });
	res.status(200).json({ data: data, key: key });
	return;
};

// Handle retrieving the raw version of a document
DocumentHandler.prototype.handleGetRaw = async function(key, res, skipExpire){
	const data = await this.store.get(key, skipExpire);

	if (!data){
		winston.warn('raw document not found', { key: key });
		res.status(404).json({ message: 'Document not found.' });
		return;
	}
	winston.verbose('retrieved raw document', { key: key });
	res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'}); 
	res.end(data);
};

// Handle adding a new Document
DocumentHandler.prototype.handlePost = function (req, res){
	let _this = this;
	let buffer = '';
	let cancelled = false;
	let parser;
	let chunks = [];
	let bytes = 0;
	const fail = (status, message) => {
		if (cancelled) return;
		cancelled = true;
		buffer = '';
		chunks = [];
		if (parser){ req.unpipe(parser); parser.destroy(); }
		res.status(status).json({ message });
		req.resume();
	};
	const tooLarge = () => fail(413, 'Document exceeds maximum length.');

	let onSuccess = async function (){
		if (cancelled) return;
		//check length
		if (!buffer.length){
			cancelled = true;
			winston.warn('document with no length was POSTed');
			res.status(411).json({ message: 'Length required.' });
			return;
		}
		if (_this.maxLength && Buffer.byteLength(buffer) > _this.maxLength){
			cancelled = true;
			winston.warn('document >maxLength', { maxLength: _this.maxLength });
			res.status(413).json({ message: 'Document exceeds maximum length.' });
			return;
		}
		//and save
		const key = await _this.chooseKey();
		const success = await _this.store.set(key, buffer);
		if (!success){
			winston.verbose('error adding document');
			res.status(500).json({ message: 'Internal server error occured while adding document.' });
			return;
		}
		winston.verbose('added document', { key: key });
		res.status(200).json({ key: key });
	};
	const finish = () => onSuccess().catch(() => fail(500, 'Unable to save document.'));
	req.on('error', () => fail(400, 'Invalid request.'));
	req.on('aborted', () => fail(400, 'Request aborted.'));
	const ct = req.headers['content-type'] || '';
	if (ct.split(';')[0].trim().toLowerCase() === 'multipart/form-data'){
		try {
			parser = Busboy({ headers: req.headers, limits: {
				fieldSize: this.maxLength ? this.maxLength + 1 : Infinity,
				fields: 1, files: 0, parts: 2
			} });
		} catch (_) { fail(400, 'Invalid multipart request.'); return; }
		parser.on('error', () => fail(400, 'Invalid multipart request.'));
		parser.on('fieldsLimit', tooLarge);
		parser.on('filesLimit', () => fail(400, 'File uploads are not supported.'));
		parser.on('partsLimit', tooLarge);
		parser.on('field', (name, value, info) => {
			if (cancelled) return;
			if (info.valueTruncated || (this.maxLength && Buffer.byteLength(value) > this.maxLength)){ tooLarge(); return; }
			if (name !== 'data'){ fail(400, 'Expected a data field.'); return; }
			buffer = value;
		});
		parser.on('close', finish);
		req.pipe(parser);
	} else {
		req.on('data', chunk => {
			if (cancelled) return;
			bytes += chunk.length;
			if (this.maxLength && bytes > this.maxLength){ tooLarge(); return; }
			chunks.push(chunk);
		});
		req.on('end', () => {
			if (cancelled) return;
			buffer = Buffer.concat(chunks).toString('utf8');
			chunks = [];
			finish();
		});
	}
};

//keep choosing keys until one isn't taken
DocumentHandler.prototype.chooseKey = async function(){
	let key = this.acceptableKey();
	let data = await this.store.get(key, true); //don't bump expirations on key searching
	if (data) return this.chooseKey();
	return key;
};

DocumentHandler.prototype.acceptableKey = function(){
	return this.keyGenerator.createKey(this.keyLength);
};

module.exports = DocumentHandler;
