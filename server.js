const winston = require('winston');
const fs = require('fs');
const st = require('st');
const app = require('express')();
const expressRateLimit = require('express-rate-limit');

// Paste routes do not use query parameters; do not parse untrusted queries.
app.set('query parser', false);

const DocumentHandler = require('./lib/document_handler');
const HasteUtils = require('./lib/util');
const preview = require('./lib/preview');

const utils = new HasteUtils();

(async function(){

	//"out-of-box" support - copy example config if it doesn't exist
	if (!fs.existsSync('./config.js')){
		await fs.promises.copyFile('./example.config.js', './config.js').catch(err => {
			winston.error('failed to copy example config', {error: err});
			process.exit(1);
		});
	}
	//load config and set some defaults
	const config = require('./config');

	config.host = process.env.HOST || config.host || '127.0.0.1';
	config.port = process.env.PORT || config.port || 7777;

	//set up logger
	winston.add(new winston.transports.Console({
		level: config.logging.level,
		format: winston.format.combine(
			winston.format.colorize(),
			winston.format.printf(info => `${info.level}: ${info.message} ${utils.stringifyJSONMessagetoLogs(info)}`)
		),
	}));

	//defaulting storage type to file
	if (!config.storage){
		config.storage = {
			type: 'file',
			path: './data'
		};
	}
	if (!config.storage.type) config.storage.type = 'file';

	let Store = require(`./lib/document_stores/${config.storage.type}`);
	let preferredStore = new Store(config.storage);

	//send the static documents into the preferred store, skipping expirations
	for (const name in config.documents){
		let path = config.documents[name];
		winston.info('loading static document', { name: name, path: path });
		let data = fs.readFileSync(path, 'utf8');
		if (data){
			await preferredStore.set(name, data, doc => winston.debug('loaded static document', { success: doc }), true);
		}
		else {
			winston.warn('failed to load static document', { name: name, path: path });
		}
	}

	//pick up a key generator
	let pwOptions = config.keyGenerator || new Object;
	pwOptions.type = pwOptions.type || 'random';
	let Gen = require(`./lib/key_generators/${pwOptions.type}`);
	let keyGenerator = new Gen(pwOptions);

	//configure the document handler
	let documentHandler = new DocumentHandler({
		store: preferredStore,
		maxLength: config.maxLength,
		keyLength: config.keyLength,
		keyGenerator: keyGenerator
	});

	//rate limit all requests
	if (config.rateLimits) app.use(expressRateLimit(config.rateLimits));

	//try API first

	//get raw documents
	app.get('/raw/:id', async (req, res) => {
		const key = req.params.id.split('.')[0];
		const skipExpire = Boolean(config.documents[key]);
		return await documentHandler.handleGetRaw(key, res, skipExpire);
	});

	//add documents
	app.post('/documents', async (req, res) => {
		return await documentHandler.handlePost(req, res);
	});

	//get documents
	app.get('/documents/:id', async (req, res) =>  {
		const key = req.params.id.split('.')[0];
		const skipExpire = Boolean(config.documents[key]);
		return await documentHandler.handleGet(key, res, skipExpire);
	});

	//link preview image for a paste, e.g. /preview/key.png or /preview/key.py.png
	app.get('/preview/:file', async (req, res, next) => {
		if (!req.params.file.endsWith('.png')) return next();
		const [key, extension] = req.params.file.slice(0, -4).split('.', 2);
		const data = await preferredStore.get(key, true).catch(() => null);
		if (!data) return next();
		try {
			const png = preview.renderImage(key, data, extension);
			res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
			res.end(png);
		} catch (err) {
			winston.error('failed to render preview', { key: key, error: err.message });
			res.status(500).end();
		}
	});

	//try static next
	app.use(st({
		path: './static',
		passthrough: true,
		index: false
	}));

	//then we can loop back - and everything else should be a token,
	//so serve the index with link preview tags for the paste
	const indexHtml = fs.readFileSync('./static/index.html', 'utf8');
	app.get('/:id', async (req, res, next) => {
		const [key, extension] = req.params.id.split('.', 2);
		//serve the plain page if the paste is missing or the store fails
		const data = await preferredStore.get(key, true).catch(() => null);
		if (!data){
			req.sturl = '/';
			return next();
		}
		const base = config.baseUrl || `${req.protocol}://${req.get('host')}`;
		const file = extension ? `${key}.${extension}` : key;
		res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
		res.send(preview.injectMeta(indexHtml, {
			key: key,
			data: data,
			url: `${base}/${encodeURIComponent(file)}`,
			image: `${base}/preview/${encodeURIComponent(file)}.png`
		}));
	});

	//and match index
	app.use(st({
		content: { maxAge: config.staticMaxAge },
		path: './static',
		index: 'index.html'
	}));

	app.listen(config.port, config.host, () => winston.info(`listening on ${config.host}:${config.port}`));

})();
