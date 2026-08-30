const fs = require('fs/promises');
const path = require('path');
const mp3tags = require('../mp3tags');

const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
const MAX_COVER_BYTES = 10 * 1024 * 1024;

function bufferToArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function parseFilenameMeta(fileName) {
  const base = path.basename(fileName).replace(/\.[^.]+$/, '');
  const parts = base.split(/ - /);
  if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
    return { title: parts.slice(1).join(' - ').trim(), artist: parts[0].trim(), album: null };
  }
  return { title: base.trim(), artist: null, album: null };
}

function coverToDataUrl(picture, maxBytes = MAX_COVER_BYTES) {
  if (!picture || !picture.data || !picture.data.length) return null;
  if (picture.data.length > maxBytes) return null;
  let format = picture.format || 'image/jpeg';
  if (format.startsWith('data:')) return `data:${format};base64,${Buffer.from(picture.data).toString('base64')}`;
  if (!/^image\//.test(format)) format = `image/${format.replace(/^\./, '')}`;
  return `data:${format};base64,${Buffer.from(picture.data).toString('base64')}`;
}

async function parseTags(filePath, buffer) {
  let mp3 = null;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp3' && buffer) {
    try { mp3 = mp3tags.parseMP3(buffer); } catch (err) { /* ignore */ }
    if (mp3 && mp3.title && mp3.artist) return mp3;
  }

  try {
    const jsmediatags = require('jsmediatags');
    const read = await new Promise((resolve, reject) => {
      jsmediatags.read(filePath, {
        onSuccess: resolve,
        onError: (err) => reject(err)
      });
    });
    const tags = (read && read.tags) || {};
    const meta = {
      title: tags.title || tags.trackTitle || (mp3 && mp3.title) || null,
      artist: tags.artist || tags.albumArtist || (mp3 && mp3.artist) || null,
      album: tags.album || (mp3 && mp3.album) || null,
      picture: tags.picture
        ? { format: tags.picture.format || 'image/jpeg', data: tags.picture.data }
        : (mp3 && mp3.picture) || null
    };
    if (meta.title || meta.artist || meta.picture) return meta;
    return mp3 || null;
  } catch (err) {
    return mp3 || null;
  }
}

async function buildAudioPayload(filePath) {
  const stats = await fs.stat(filePath);
  if (stats.size > MAX_AUDIO_BYTES) throw new Error('File is too large to load');
  const buffer = await fs.readFile(filePath);
  const tags = await parseTags(filePath, buffer).catch(() => null);
  const meta = tags || parseFilenameMeta(filePath);
  return {
    path: filePath,
    fileName: path.basename(filePath),
    meta: {
      title: meta.title || null,
      artist: meta.artist || null,
      album: meta.album || null,
      coverDataUrl: coverToDataUrl(meta.picture)
    },
    buffer: bufferToArrayBuffer(buffer)
  };
}

module.exports = { parseFilenameMeta, coverToDataUrl, parseTags, bufferToArrayBuffer, buildAudioPayload };