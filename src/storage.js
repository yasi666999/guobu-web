import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { paths } from './db.js';

const MIME_EXTENSIONS = {
  'text/html': '.html',
  'application/xhtml+xml': '.html',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/json': '.json',
  'text/csv': '.csv',
  'text/plain': '.txt',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/tiff': '.tiff',
  'image/webp': '.webp',
};

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function extensionFor(mimeType, originalName = '') {
  const fromName = extname(originalName).toLowerCase();
  if (fromName && fromName.length <= 10) return fromName;
  const cleanMime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return MIME_EXTENSIONS[cleanMime] || '.bin';
}

export function saveSnapshot(buffer, { mimeType, originalName, url, prefix = 'raw' }) {
  const hash = sha256(buffer);
  const now = new Date();
  let urlPath = '';
  try {
    urlPath = new URL(url || 'https://invalid.local/file').pathname;
  } catch {
    urlPath = '';
  }
  const ext = extensionFor(mimeType, originalName || urlPath);
  const folder = join(paths.data, prefix, String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
  mkdirSync(folder, { recursive: true });
  const filePath = join(folder, `${hash}${ext}`);
  if (!existsSync(filePath)) writeFileSync(filePath, buffer);
  return { hash, filePath, byteSize: buffer.length, mimeType: String(mimeType || '').split(';')[0].trim() || 'application/octet-stream' };
}

export function readSnapshot(filePath) {
  return readFileSync(filePath);
}

export function resolvePublicFile(requestPath) {
  const normalized = normalize(decodeURIComponent(requestPath)).replace(/^([/\\])+/, '');
  const resolved = resolve(paths.public, normalized);
  if (resolved !== paths.public && !resolved.startsWith(`${paths.public}${sep}`)) return null;
  return resolved;
}
