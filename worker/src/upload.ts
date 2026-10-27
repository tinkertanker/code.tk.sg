import { MultipartParser, MaxFileSizeExceededError, getMultipartBoundary } from '@mjackson/multipart-parser';

export class UploadError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const tooLarge = () => new UploadError(413, 'Document exceeds maximum length.');
const invalidForm = () => new UploadError(400, 'Invalid multipart request.');
const encoder = new TextEncoder();
const utf8 = new TextDecoder('utf-8', { ignoreBOM: true, fatal: false });

export async function upload(request: Request, limit: number): Promise<string> {
  const contentType = request.headers.get('content-type') || '';
  const multipart = contentType.split(';')[0].trim().toLowerCase() === 'multipart/form-data';
  const boundary = multipart ? getMultipartBoundary(contentType) : undefined;
  // RFC 2046 bchars: 1–70 ASCII characters, with no trailing space. This also
  // keeps the parser's byte-sized search skips from overflowing to zero.
  if (multipart && (!boundary || !/^[0-9A-Za-z'()+_,./:=? -]{0,69}[0-9A-Za-z'()+_,./:=?-]$/.test(boundary))) throw invalidForm();
  const parser = boundary ? new MultipartParser(boundary, { maxFileSize: limit || Infinity }) : null;
  const opening = boundary ? encoder.encode(`--${boundary}`) : null;
  let preamble = new Uint8Array(0);
  let started = false;
  let total = 0;
  let seen = false;
  let data = '';
  const chunks: Uint8Array[] = [];
  const reader = request.body?.getReader();
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (limit > 0 && total > limit + (multipart ? 16 * 1024 : 0)) throw tooLarge();
      if (!parser) { chunks.push(value); continue; }
      let chunk = value;
      // The parser requires an initial boundary; MIME permits an ignored preamble.
      if (!started && opening) {
        const combined = new Uint8Array(preamble.length + chunk.length);
        combined.set(preamble); combined.set(chunk, preamble.length);
        let offset = -1;
        // Resume where the previous chunk's scan stopped (a boundary may straddle chunks)
        for (let i = Math.max(0, preamble.length - opening.length - 3); i <= combined.length - opening.length - 2; i++) {
          if (i !== 0 && !(combined[i - 2] === 13 && combined[i - 1] === 10)) continue;
          const end = i + opening.length;
          if (!(combined[end] === 13 && combined[end + 1] === 10)
            && !(combined[end] === 45 && combined[end + 1] === 45)) continue;
          if (opening.every((b, j) => combined[i + j] === b)) { offset = i; break; }
        }
        if (offset < 0) {
          preamble = combined;
          continue;
        }
        chunk = combined.subarray(offset);
        started = true;
        preamble = new Uint8Array(0);
      }
      for (const part of parser.write(chunk)) {
        if (seen) throw tooLarge();
        seen = true;
        if (part.filename !== undefined) throw new UploadError(400, 'File uploads are not supported.');
        if (part.name !== 'data') throw new UploadError(400, 'Expected a data field.');
        const charset = part.headers.contentType?.charset?.toLowerCase() || 'utf-8';
        data = decode(part.bytes, charset);
      }
      // A closing boundary ends the form; CRLF/epilogue may arrive in later chunks.
      // This parser's finish() checks completion without mutating its state.
      let complete = false;
      try { parser.finish(); complete = true; } catch { /* incomplete until another chunk or EOF */ }
      if (complete) {
        void reader.cancel().catch(() => {});
        break;
      }
    }
    if (parser) parser.finish();
    else {
      const buffer = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
      data = utf8.decode(buffer);
    }
    if (!data) throw new UploadError(411, 'Length required.');
    if (limit > 0 && encoder.encode(data).length > limit) throw tooLarge();
    return data;
  } catch (error) {
    // Do not wait for EOF (or for cancellation of the producer) on rejection.
    void reader?.cancel().catch(() => {});
    if (error instanceof UploadError) throw error;
    if (error instanceof MaxFileSizeExceededError) throw tooLarge();
    throw multipart ? invalidForm() : new UploadError(400, 'Invalid request.');
  } finally {
    reader?.releaseLock();
  }
}

function decode(bytes: Uint8Array, charset: string): string {
  if (['utf-8', 'utf8'].includes(charset)) return utf8.decode(bytes);
  if (['latin1', 'ascii', 'us-ascii', 'iso-8859-1', 'iso8859-1', 'iso88591',
    'iso_8859-1', 'windows-1252', 'iso_8859-1:1987', 'cp1252', 'x-cp1252'].includes(charset)) {
    return Array.from(bytes, b => String.fromCharCode(b)).join('');
  }
  if (['utf16le', 'utf-16le', 'ucs2', 'ucs-2'].includes(charset)) {
    return new TextDecoder('utf-16le', { ignoreBOM: true, fatal: false }).decode(bytes.subarray(0, bytes.length - bytes.length % 2));
  }
  if (charset === 'base64') return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
  throw invalidForm();
}
