const fs = require('fs');

function decodeUtf16(bytes) {
  let b = bytes;
  if (b.length % 2 === 1) b = b.subarray(0, b.length - 1);
  const copy = Buffer.from(b);
  let s;
  if (copy.length >= 2 && copy[0] === 0xff && copy[1] === 0xfe) {
    s = copy.subarray(2).toString('utf16le');
  } else if (copy.length >= 2 && copy[0] === 0xfe && copy[1] === 0xff) {
    copy.swap16();
    s = copy.toString('utf16le');
  } else {
    copy.swap16();
    s = copy.toString('utf16le');
  }
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s.trim().replace(/\0+$/g, '');
}

function decodeText(bytes, enc) {
  if (!bytes || !bytes.length) return '';
  if (enc === 0) return bytes.toString('latin1').replace(/\0/g, '').trim();
  if (enc === 3) return bytes.toString('utf8').replace(/\0/g, '').trim();
  if (enc === 1 || enc === 2) return decodeUtf16(bytes);
  return bytes.toString('latin1').replace(/\0/g, '').trim();
}

function syncSafe(buf, start) {
  return (buf[start] << 21) | (buf[start + 1] << 14) | (buf[start + 2] << 7) | buf[start + 3];
}

function parseID3Frames(buffer) {
  if (buffer.length < 10 || buffer.toString('latin1', 0, 3) !== 'ID3') return null;
  const major = buffer[3];
  const flags = buffer[5];
  let tagEnd = Math.min(buffer.length, 10 + syncSafe(buffer, 6));
  if (flags & 0x10) tagEnd = Math.min(buffer.length, tagEnd + 10);
  const isV22 = major === 2;
  const frames = {};
  let i = 10;
  if (flags & 0x40) {
    if (major >= 4 && buffer.length >= 14) i = Math.min(tagEnd, 10 + syncSafe(buffer, 10));
    else if (major === 3 && buffer.length >= 14) i = Math.min(tagEnd, 14 + buffer.readUInt32BE(10));
  }
  const headerLen = isV22 ? 6 : 10;
  while (i + headerLen <= tagEnd) {
    if (buffer[i] === 0) break;
    const id = buffer.toString('latin1', i, i + (isV22 ? 3 : 4));
    if (!id || !/^[A-Z0-9]+$/.test(id)) break;
    let size;
    if (isV22) {
      size = buffer[i + 3] << 16 | buffer[i + 4] << 8 | buffer[i + 5];
    } else {
      size = major >= 4 ? syncSafe(buffer, i + 4) : buffer.readUInt32BE(i + 4);
      if (size < 0 || size > tagEnd) break;
    }
    const dataStart = i + headerLen;
    const dataEnd = Math.min(tagEnd, dataStart + size);
    if (dataEnd <= dataStart) break;
    frames[id] = buffer.subarray(dataStart, dataEnd);
    i = dataEnd;
  }
  return frames;
}

function textFrame(frames, names) {
  for (const n of names) {
    const d = frames[n];
    if (d && d.length >= 1) {
      const enc = d[0];
      const value = decodeText(d.subarray(1), enc);
      if (value) return value;
    }
  }
  return null;
}

function pictureFrame(frames, names) {
  for (const n of names) {
    const d = frames[n];
    if (!d || d.length < 4) continue;
    const enc = d[0];
    let p = 1;
    let mimeEnd = -1;
    for (let j = p; j < d.length; j++) {
      if (d[j] === 0) { mimeEnd = j; break; }
    }
    if (mimeEnd < 0) continue;
    const mime = d.subarray(p, mimeEnd).toString('latin1');
    p = mimeEnd + 1;
    if (p >= d.length) continue;
    p += 1;
    let dataStart = -1;
    if (enc === 1 || enc === 2) {
      for (let j = p; j < d.length - 1; j++) {
        if (d[j] === 0 && d[j + 1] === 0) { dataStart = j + 2; break; }
      }
    } else {
      for (let j = p; j < d.length; j++) {
        if (d[j] === 0) { dataStart = j + 1; break; }
      }
    }
    if (dataStart < 0) continue;
    const data = d.subarray(dataStart);
    if (!data.length) continue;
    return { format: mime || 'image/jpeg', data: Buffer.from(data) };
  }
  return null;
}

function parseID3v1(buffer) {
  if (buffer.length < 128) return null;
  const start = buffer.length - 128;
  if (buffer.toString('latin1', start, start + 3) !== 'TAG') return null;
  const clean = (s) => s.split('\0')[0].trim();
  const title = clean(buffer.toString('latin1', start + 3, start + 33));
  const artist = clean(buffer.toString('latin1', start + 33, start + 63));
  const album = clean(buffer.toString('latin1', start + 63, start + 93));
  return {
    title: title || null,
    artist: artist || null,
    album: album || null,
    picture: null
  };
}

function parseMP3(buffer) {
  const frames = parseID3Frames(buffer) || {};
  const mapped = {};
  const mapId = { TT2: 'TIT2', TP1: 'TPE1', TAL: 'TALB', TCO: 'TCON', TRK: 'TRCK', PIC: 'APIC' };
  for (const key of Object.keys(frames)) mapped[mapId[key] || key] = frames[key];
  const picture = pictureFrame(mapped, ['APIC', 'PIC']);
  const title = textFrame(mapped, ['TIT2', 'TT2']);
  const artist = textFrame(mapped, ['TPE1', 'TP1']);
  const album = textFrame(mapped, ['TALB', 'TAL']);
  if (title || artist || album || picture) {
    return { title, artist, album, picture };
  }
  return parseID3v1(buffer);
}

function readTags(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const chunks = [];
    const head = Buffer.alloc(10);
    const n = fs.readSync(fd, head, 0, 10, 0);
    if (n >= 10 && head.toString('latin1', 0, 3) === 'ID3') {
      const bodyLen = syncSafe(head, 6);
      if (bodyLen > 0) {
        const footer = head[3] >= 4 && (head[5] & 0x10) ? 10 : 0;
        const len = Math.min(bodyLen + footer, Math.max(0, stat.size - 10));
        const body = Buffer.alloc(len);
        fs.readSync(fd, body, 0, len, 10);
        chunks.push(head, body);
      } else {
        chunks.push(head);
      }
    }
    if (stat.size >= 128) {
      const tail = Buffer.alloc(128);
      fs.readSync(fd, tail, 0, 128, stat.size - 128);
      if (tail.toString('latin1', 0, 3) === 'TAG') chunks.push(tail);
    }
    return parseMP3(Buffer.concat(chunks));
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { readTags, parseMP3 };