/* global it, describe, afterEach */

const assert = require('assert');

const winston = require('winston');
winston.remove(winston.transports.Console);

const RedisDocumentStore = require('../lib/document_stores/redis');

describe('redis_document_store', function(){
	let store;

	afterEach(async function(){
		if (store) await store.client.quit();
	});

	describe('set', function(){

		it('should be able to set a key and have an expiration set', async function(){
			store = new RedisDocumentStore({ expire: 10 });
			await store.set('hello1', 'world');
			assert.ok(await store.client.ttl('hello1') > 1);
		});

		it('should not set an expiration when told not to', async function(){
			store = new RedisDocumentStore({ expire: 10 });
			await store.set('hello2', 'world', true);
			assert.equal(-1, await store.client.ttl('hello2'));
		});

		it('should not set an expiration when expiration is off', async function(){
			store = new RedisDocumentStore({ expire: false });
			await store.set('hello3', 'world');
			assert.equal(-1, await store.client.ttl('hello3'));
		});

	});

});
