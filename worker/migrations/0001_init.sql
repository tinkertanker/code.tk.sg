CREATE TABLE documents (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER          -- unix seconds; NULL = never expires
);
CREATE INDEX documents_expires_at ON documents(expires_at);
