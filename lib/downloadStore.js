const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, '..', 'commands', 'cache');
const DB_PATH = path.join(CACHE_DIR, 'metadata.json');
const BASE_URL = process.env.DOWNLOAD_BASE_URL || 'https://example.com/download';

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, '{}');

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function generateId(len = 10) {
  return crypto.randomBytes(len).toString('base64url').slice(0, len);
}

function saveFile(sourcePath, filename, format) {
  const id = generateId();
  const ext = path.extname(filename) || (format === 'mp3' ? '.mp3' : '.mp4');
  const storedName = `${id}${ext}`;
  const storedPath = path.join(CACHE_DIR, storedName);

  fs.copyFileSync(sourcePath, storedPath);
  const size = fs.statSync(storedPath).size;

  const db = readDb();
  db[id] = {
    id,
    filename,
    storedName,
    format,
    size,
    createdAt: Date.now(),
  };
  writeDb(db);

  return { id, size, url: `${BASE_URL}/${id}` };
}

module.exports = { saveFile, readDb, CACHE_DIR };