import { limiterId } from '../src/ratelimit';
import { env } from 'cloudflare:workers';
import { evictDurableObject } from 'cloudflare:test';
import { describe, it, expect, inject } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/env';
import about from '../../about.md';

function request(path: string, init: RequestInit = {}, vars: Partial<Env> = {}) {
  return worker.fetch(new Request('https://paste.example:7777' + path, init), {
    ...env, MAX_LENGTH: 32, EXPIRE: 60, ...vars,
  });
}

async function save(body: BodyInit, contentType = 'text/plain', vars: Partial<Env> = {}) {
  const response = await request('/documents', { method: 'POST', body, headers: { 'content-type': contentType } }, vars);
  expect(response.status).toBe(200);
  return (await response.json<{ key: string }>()).key;
}

describe('HTTP compatibility with real D1 and Static Assets', () => {
  it('existing storage and extension URLs', async () => {
    const response = await request('/documents/legacykey.py?unused[x]=1');
    expect(await response.json()).toEqual({ key: 'legacykey', data: 'old paste\né <&>\n' });
    const raw = await request('/raw/legacykey.txt');
    expect(raw.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await raw.text()).toBe('old paste\né <&>\n');
  });

  it('legacy route matching and unsupported methods', async () => {
    for (const path of ['/RAW/legacykey.txt', '/Raw/legacykey/', '/raw/legacykey/']) {
      expect(await (await request(path)).text()).toBe('old paste\né <&>\n');
    }
    for (const path of ['/DOCUMENTS/legacykey.py', '/documents/legacykey/']) {
      expect(await (await request(path)).json()).toEqual({ key: 'legacykey', data: 'old paste\né <&>\n' });
    }
    for (const path of ['/documents', '/documents/']) expect((await request(path)).status).toBe(200);
    const response = await request('/DOCUMENTS/', { method: 'POST', body: 'slash upload' });
    expect(response.status).toBe(200);
    const { key } = await response.json<{ key: string }>();
    expect(await (await request('/raw/' + key)).text()).toBe('slash upload');
    expect((await request('/documents/legacykey', { method: 'POST', body: 'wrong method' })).status).toBe(404);
  });

  it('upload roundtrip, phonetic keys and byte limits', async () => {
    const data = 'é' + 'x'.repeat(30);
    const key = await save(data, 'application/json');
    expect(key).toMatch(/^[a-z]{10}$/);
    const vowel = (c: string) => 'aeiouy'.includes(c);
    for (let i = 1; i < key.length; i++) expect(vowel(key[i])).not.toBe(vowel(key[i - 1]));
    expect(await (await request('/raw/' + key)).text()).toBe(data);
    const stored = await env.DB.prepare('SELECT data, expires_at FROM documents WHERE key = ?').bind(key).first<{ data: string; expires_at: number }>();
    expect(stored?.data).toBe(data);
    expect(stored!.expires_at - Math.floor(Date.now() / 1000)).toBeGreaterThan(55);
    for (const [body, status, message] of [
      ['', 411, 'Length required.'], [data + 'x', 413, 'Document exceeds maximum length.'],
    ] as const) {
      const response = await request('/documents', { method: 'POST', body });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ message });
    }
    const replacement = await request('/documents', { method: 'POST', body: new Uint8Array(11).fill(255) });
    expect(replacement.status).toBe(413); // UTF-8 replacement expansion counts too.
  });

  it('chunked UTF-8 and early raw rejection without EOF', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new Uint8Array([0xc3]));
      c.enqueue(new Uint8Array([0xa9, ...new Uint8Array(30).fill(97)])); c.close();
    } });
    const key = await save(stream);
    expect(await (await request('/raw/' + key)).text()).toBe('é' + 'a'.repeat(30));
    const neverEnds = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(33).fill(120)); } });
    const response = await request('/documents', { method: 'POST', body: neverEnds });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ message: 'Document exceeds maximum length.' });
  });

  it('multipart contract including all legacy charsets and malformed forms', async () => {
    const ct = 'multipart/form-data; boundary=test';
    const form = (parts: [string, string][], closing = true) => parts.map(([disposition, value]) =>
      `--test\r\nContent-Disposition: form-data; ${disposition}\r\n\r\n${value}\r\n`).join('') + (closing ? '--test--\r\n' : '');
    for (const [parts, status, message] of [
      [[['name="data"', 'é' + 'x'.repeat(30)]], 200, null],
      [[['name="data"', 'é' + 'x'.repeat(31)]], 413, 'Document exceeds maximum length.'],
      [[['name="wrong"', 'abc']], 400, 'Expected a data field.'],
      [[['name="data"', 'a'], ['name="data"', 'b']], 413, 'Document exceeds maximum length.'],
      [[['name="data"; filename="x.txt"', 'abc']], 400, 'File uploads are not supported.'],
    ] as [ [string, string][], number, string | null ][]) {
      const response = await request('/documents', { method: 'POST', body: form(parts), headers: { 'content-type': ct } });
      expect(response.status).toBe(status);
      if (message) expect(await response.json()).toEqual({ message });
      else {
        const { key } = await response.json<{ key: string }>();
        expect(await (await request('/raw/' + key)).text()).toBe(parts[0][1]);
      }
    }
    for (const [charset, bytes, expected] of [
      ['utf-8', [239, 187, 191, 97], '\ufeffa'],
      ['ISO-8859-1', [99, 97, 102, 233, 128], 'café\x80'],
      ['utf-16le', [255, 254, 97, 0, 233, 0, 120], '\ufeffaé'],
      ['base64', [97, 98, 99], 'YWJj'],
      ['shift_jis', [147, 250, 150, 123], null],
    ] as [string, number[], string | null][]) {
      const body = new Uint8Array([
        ...new TextEncoder().encode(`--test\r\nContent-Disposition: form-data; name="data"\r\nContent-Type: text/plain; charset=${charset}\r\n\r\n`),
        ...bytes, ...new TextEncoder().encode('\r\n--test--\r\n'),
      ]);
      const response = await request('/documents', { method: 'POST', body, headers: { 'content-type': ct } });
      expect(response.status).toBe(expected === null ? 400 : 200);
      if (expected === null) expect(await response.json()).toEqual({ message: 'Invalid multipart request.' });
      else {
        const { key } = await response.json<{ key: string }>();
        expect(new Uint8Array(await (await request('/raw/' + key)).arrayBuffer())).toEqual(new TextEncoder().encode(expected));
      }
    }
    expect((await request('/documents', { method: 'POST', body: '', headers: { 'content-type': 'multipart/form-data' } })).status).toBe(400);
    expect((await request('/documents', { method: 'POST', body: form([['name="data"', 'abc']], false), headers: { 'content-type': ct } })).status).toBe(400);
    expect((await request('/documents', { method: 'POST', body: '--test--\r\n', headers: { 'content-type': ct } })).status).toBe(411);
    const encoded = new TextEncoder().encode(form([['name="data"', 'é' + 'x'.repeat(30)]]));
    const split = new ReadableStream<Uint8Array>({ start(c) {
      for (const byte of encoded) c.enqueue(new Uint8Array([byte])); c.close();
    } });
    expect(await (await request('/raw/' + await save(split, ct))).text()).toBe('é' + 'x'.repeat(30));
  });

  it('multipart preamble and field limits reject without EOF', async () => {
    const ct = 'multipart/form-data; boundary=test';
    const valid = 'ignored preamble\r\n'.repeat(200) + '--test\r\nContent-Disposition: form-data; name="data"\r\n\r\n' + 'x'.repeat(32) + '\r\n--test--\r\n';
    const key = await save(valid, ct);
    expect(await (await request('/raw/' + key)).text()).toBe('x'.repeat(32));
    for (const body of ['x'.repeat(20 * 1024), '--test\r\nContent-Disposition: form-data; name="data"\r\n\r\n' + 'x'.repeat(33)]) {
      const neverEnds = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(body)); } });
      const response = await request('/documents', { method: 'POST', body: neverEnds, headers: { 'content-type': ct } });
      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ message: 'Document exceeds maximum length.' });
    }
  });

  it('missing, static routes and D1 failure without breaking bundled about', async () => {
    for (const path of ['/raw/notfound', '/documents/notfound']) {
      const response = await request(path);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: 'Document not found.' });
    }
    for (const path of ['/', '/notfound', '/notfound.py']) {
      const response = await request(path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<title>code.tk.sg</title>');
    }
    await env.DB.prepare('INSERT INTO documents VALUES (?, ?, NULL)').bind('application', 'must not shadow CSS').run();
    const asset = await request('/application.css');
    expect(await asset.text()).toBe(inject('css'));
    expect(asset.headers.get('cache-control')).toBe('public, max-age=86400');
    expect((await request('/nested/missing')).status).toBe(404);
    expect(await (await request('/raw/about')).text()).toBe(about);
    await env.DB.exec('DROP TABLE documents');
    expect(await (await request('/raw/about')).text()).toBe(about);
    expect((await request('/raw/legacykey')).status).toBe(404);
    const response = await request('/documents', { method: 'POST', body: 'cannot save' });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: 'Internal server error occured while adding document.' });
  });

  it('preview metadata, request host, URL encoding and content escaping', async () => {
    const page = await request('/legacykey.py');
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('public, max-age=300');
    const html = await page.text();
    expect(html).toContain('content="https://paste.example:7777/preview/legacykey.py.png"');
    expect(html).toContain('content="old paste é &lt;&amp;&gt;"');
    const key = await save('\"><script>alert(1)</script>');
    const escaped = await (await request('/' + key + '.txt', { headers: { Host: 'other.example:7777' } })).text();
    expect(escaped).toContain(`content="https://other.example:7777/${key}.txt"`);
    expect(escaped).toContain('content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(escaped).not.toContain('<script>alert(1)</script>');
    await env.DB.prepare('INSERT INTO documents VALUES (?, ?, NULL)').bind('a &"', 'encoded key').run();
    const encoded = await (await request('/a%20%26%22.py')).text();
    expect(encoded).toContain('content="https://paste.example:7777/a%20%26%22.py"');
    expect(encoded).toContain('content="code.tk.sg - a &amp;&quot;"');
  });

  // Ported unchanged but not runnable until the preview owner's module is integrated.
  it.skipIf(!inject('previewIntegrated'))('preview PNG dimensions, suffixes and Ruby astral character', async () => {
    for (const suffix of ['.py', '.txt', '.unknown', '']) {
      const response = await request('/preview/legacykey' + suffix + '.png');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const view = new DataView(bytes.buffer);
      expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 900]);
    }
    const key = await save('puts ?😀');
    const response = await request(`/preview/${key}.rb.png`);
    expect(response.status).toBe(200);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()).slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('HEAD returns headers without bodies on APIs, pages, assets and errors', async () => {
    for (const path of ['/raw/legacykey', '/documents/legacykey', '/legacykey.py', '/', '/application.css', '/raw/notfound', '/nested/missing']) {
      const get = await request(path);
      const head = await request(path, { method: 'HEAD' });
      expect(head.status).toBe(get.status);
      expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
      expect(await head.text()).toBe('');
    }
  });

  it('preview route validation and percent-encoded PNG suffixes', async () => {
    for (const path of ['/preview/notfound.png', '/preview/legacykey.jpg']) {
      expect((await request(path)).status).toBe(404);
    }
    expect((await request('/preview/legacykey.png', { method: 'POST' })).status).toBe(404);
    // Both forms reach the renderer, which is a throwing placeholder in phase 1.
    for (const path of ['/preview/legacykey.py.png', '/PREVIEW/legacykey%2Epy%2Epng/']) {
      expect((await request(path)).status).toBe(inject('previewIntegrated') ? 200 : 500);
    }
  });

  it('sliding expiry only on document and raw reads, static documents never expire', async () => {
    const original = Math.floor(Date.now() / 1000) + 20;
    const expiry = () => env.DB.prepare('SELECT expires_at FROM documents WHERE key = ?').bind('legacykey').first<number>('expires_at');
    for (const path of ['/legacykey.py', '/preview/legacykey.py.png']) {
      await request(path);
      expect(await expiry()).toBe(original);
    }
    for (const path of ['/documents/legacykey.py', '/raw/legacykey']) {
      expect((await request(path)).status).toBe(200);
      expect((await expiry())! - Math.floor(Date.now() / 1000)).toBeGreaterThan(55);
      await env.DB.prepare('UPDATE documents SET expires_at = ? WHERE key = ?').bind(original, 'legacykey').run();
    }
    await request('/raw/about'); await request('/documents/about');
    expect(await env.DB.prepare('SELECT key FROM documents WHERE key = ?').bind('about').first()).toBeNull();
  });

  it('expired rows are invisible, cron removes only expired rows, zero expiry persists', async () => {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO documents VALUES (?, ?, ?)').bind('expired', 'gone', Math.floor(Date.now() / 1000)),
      env.DB.prepare('INSERT INTO documents VALUES (?, ?, NULL)').bind('permanent', 'never expires'),
    ]);
    for (const prefix of ['/documents/', '/raw/', '/preview/']) {
      expect((await request(prefix + 'expired' + (prefix === '/preview/' ? '.png' : ''))).status).toBe(404);
    }
    expect(await (await request('/expired')).text()).not.toContain('og:image');
    const key = await save('no expiry', 'text/plain', { EXPIRE: 0 });
    expect(await env.DB.prepare('SELECT expires_at FROM documents WHERE key = ?').bind(key).first('expires_at')).toBeNull();
    await worker.scheduled({} as ScheduledController, env);
    expect(await env.DB.prepare('SELECT key FROM documents WHERE key = ?').bind('expired').first()).toBeNull();
    expect(await (await request('/raw/permanent')).text()).toBe('never expires');
    expect(await env.DB.prepare('SELECT expires_at FROM documents WHERE key = ?').bind('permanent').first('expires_at')).toBeNull();
    expect(await (await request('/raw/legacykey')).text()).toBe('old paste\né <&>\n');
  });

  it('all routes share a rate limit, CF IP is trusted and X-Forwarded-For is not', async () => {
    const vars = { RATE_MAX: 2, RATE_WINDOW_MS: 60000 };
    expect((await request('/', { headers: { 'CF-Connecting-IP': '192.0.2.1' } }, vars)).status).toBe(200);
    const second = await request('/raw/about', { headers: { 'CF-Connecting-IP': '192.0.2.1' } }, vars);
    expect(second.status).toBe(200);
    expect(second.headers.get('x-ratelimit-remaining')).toBe('0');
    const blocked = await request('/application.css', { headers: { 'CF-Connecting-IP': '192.0.2.1', 'X-Forwarded-For': '8.8.8.8' } }, vars);
    expect(blocked.status).toBe(429);
    expect(await blocked.text()).toBe('Too many requests, please try again later.');
    expect(blocked.headers.get('x-ratelimit-limit')).toBe('2');
    expect(blocked.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(Number(blocked.headers.get('x-ratelimit-reset')) * 1000).toBeGreaterThan(Date.now());
    expect((await request('/', { headers: { 'CF-Connecting-IP': '192.0.2.2' } }, vars)).status).toBe(200);
    expect((await request('/documents', { method: 'POST', body: 'blocked', headers: { 'CF-Connecting-IP': '192.0.2.1' } }, vars)).status).toBe(429);
  });

  it('window resets', async () => {
    const vars = { RATE_MAX: 1, RATE_WINDOW_MS: 500 };
    expect((await request('/', {}, vars)).status).toBe(200);
    expect((await request('/', {}, vars)).status).toBe(429);
    await new Promise(resolve => setTimeout(resolve, 600));
    expect((await request('/', {}, vars)).status).toBe(200);
  });

  it('concurrent requests share atomic counts that survive isolate eviction', async () => {
    const vars = { RATE_MAX: 2, RATE_WINDOW_MS: 60000 };
    const responses = await Promise.all(Array.from({ length: 8 }, () => request('/raw/about', {}, vars)));
    expect(responses.filter(r => r.status === 200)).toHaveLength(2);
    expect(responses.filter(r => r.status === 429)).toHaveLength(6);
    await evictDurableObject(env.RATE_LIMITER.get(limiterId(env, 'unknown')));
    expect((await request('/', {}, vars)).status).toBe(429);
  });

  it('simultaneous saves never overwrite and exhausted phonetic keyspace fails', async () => {
    const chars = 'bcdfghjklmnpqrstvwxzaeiouy';
    // Leave only two slots to force collision retries, as in the legacy AB test.
    for (const key of chars.replace(/[ab]/g, '')) {
      await env.DB.prepare('INSERT INTO documents VALUES (?, ?, NULL)').bind(key, 'occupied').run();
    }
    const saved = await Promise.all(['first', 'second'].map(async data => [await save(data, 'text/plain', { KEY_LENGTH: 1 }), data]));
    expect(new Set(saved.map(([key]) => key))).toEqual(new Set(['a', 'b']));
    const response = await request('/documents', { method: 'POST', body: 'must not replace' }, { KEY_LENGTH: 1 });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: 'Unable to save document.' });
    for (const [key, data] of saved) expect(await (await request('/raw/' + key)).text()).toBe(data);
  });
});
