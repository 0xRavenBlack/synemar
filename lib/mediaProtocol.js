const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { Readable } = require('stream');

const MEDIA_TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.opus': 'audio/opus'
};

function isAllowedMediaPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext in MEDIA_TYPES;
}

function register(protocol) {
  protocol.handle('media', async (request) => {
  try {
    const u = new URL(request.url);
    const filePath = u.searchParams.get('path') || decodeURIComponent(u.pathname);
    if (!filePath || typeof filePath !== 'string') return new Response('Bad request', { status: 400 });
    if (!isAllowedMediaPath(filePath)) return new Response('Forbidden', { status: 403 });
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return new Response('Not found', { status: 404 });
    if (stats.size <= 0) return new Response('Empty file', { status: 400 });

    const ext = path.extname(filePath).toLowerCase();
    const type = MEDIA_TYPES[ext] || 'video/mp4';
    const size = stats.size;

    const range = request.headers.get('range');
    let start = 0, end = size - 1, status = 200;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        if (m[1] === '') {
          const suffix = parseInt(m[2] || '0', 10);
          if (suffix <= 0) return new Response('Range not satisfiable', { status: 416 });
          end = size - 1;
          start = Math.max(0, end - suffix + 1);
        } else {
          start = parseInt(m[1], 10);
          end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
        }
        if (start >= size) return new Response('Range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        status = 206;
      }
    }
    const length = end - start + 1;
    const stream = Readable.toWeb(fsSync.createReadStream(filePath, { start, end }));
    const headers = {
      'Content-Type': type,
      'Content-Length': String(length),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'private, max-age=0'
    };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(stream, { status, headers });
  } catch (err) {
    console.error('media protocol error:', err && err.message);
    return new Response('Not found', { status: 404 });
  }
  });
}

module.exports = { register, VIDEO_TYPES: MEDIA_TYPES };