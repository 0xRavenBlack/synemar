const assert = require('assert');

function mediaUrl(p) {
  return 'media://file/?path=' + encodeURIComponent(p);
}

function resolvePath(requestUrl) {
  const u = new URL(requestUrl);
  return u.searchParams.get('path') || decodeURIComponent(u.pathname);
}

const cases = [
  ['C:\\Users\\me\\video.mp4'],
  ['C:/Users/me/video.mp4'],
  ['D:\\Music Videos\\song one.mp4'],
  ['/home/ravenblack/Videos/clip.mp4'],
  ['/Users/me/Movies/example.mp4'],
  ['//server/share/video.webm'],
  ['video with spaces & symbols.mp4']
];

for (const [p] of cases) {
  const requestUrl = mediaUrl(p);
  assert.strictEqual(resolvePath(requestUrl), p, `roundtrip: ${p}`);
  assert(new URL(requestUrl).host === 'file', `host segment must be 'file' for ${p}`);
  assert(new URL(requestUrl).searchParams.has('path'), `path param present for ${p}`);
}

const urlWithBackslash = mediaUrl('C:\\Users\\me\\video.mp4');
assert.doesNotThrow(() => new URL(urlWithBackslash), 'Windows backslash paths must parse');

console.log('mediaurl: all tests passed');
