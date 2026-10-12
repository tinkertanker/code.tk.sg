import about from '../../about.md';
import { key } from './keys';

export class Store {
  constructor(private db: D1Database, private expire: number) {}

  async get(id: string, renew = false): Promise<string | null> {
    if (id === 'about') return about;
    const now = Math.floor(Date.now() / 1000);
    const row = renew && this.expire > 0
      ? await this.db.prepare(`UPDATE documents SET expires_at = CASE
          WHEN expires_at IS NULL THEN NULL ELSE ? END
          WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)
          RETURNING data`).bind(now + this.expire, id, now).first<{ data: string }>()
      : await this.db.prepare(`SELECT data FROM documents WHERE key = ?
          AND (expires_at IS NULL OR expires_at > ?)`).bind(id, now).first<{ data: string }>();
    return row?.data || null;
  }

  async save(data: string, length: number): Promise<string | null> {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const id = key(length);
      if (id === 'about') continue;
      const expiry = this.expire > 0 ? Math.floor(Date.now() / 1000) + this.expire : null;
      const result = await this.db.prepare(`INSERT INTO documents (key, data, expires_at)
        VALUES (?, ?, ?) ON CONFLICT DO NOTHING`).bind(id, data, expiry).run();
      if (result.meta.changes > 0) return id;
    }
    return null;
  }

  // Delete in batches so a large backlog can't exceed D1's per-query limits
  async cleanup(batch = 1000, maxBatches = 100): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    let deleted = 0;
    for (let i = 0; i < maxBatches; i++) {
      const result = await this.db.prepare(`DELETE FROM documents WHERE key IN
        (SELECT key FROM documents WHERE expires_at <= ? LIMIT ?)`).bind(now, batch).run();
      deleted += result.meta.changes;
      if (result.meta.changes < batch) break;
    }
    return deleted;
  }
}
