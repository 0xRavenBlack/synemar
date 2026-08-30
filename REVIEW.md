# Codebase Review — Synemar (0.2.0)

Review date: 2026-08-30. Scope: `main.js`, `preload.js`, `renderer.js`, `index.html`,
`styles.css`, `mp3tags.js`, tests, packaging (deb / PKGBUILD / desktop entry). Claims were
verified against the pinned Electron 44 / Node 24 stack where possible.

Running `node --check` on all JS files and `node test/mp3tags.test.js` pass.

---

## Blocker

### B1 [fixed] — Drag & drop is completely dead on the pinned Electron 44

`renderer/renderer.js:1756` calls `handleDropped(file, file.path || '')`. The non-standard
`File.path` augmentation was **removed in Electron 32** and superseded by
`webUtils.getPathForFile()` (confirmed in the shipped `node_modules/electron/electron.d.ts`
WebUtils docs: *"This method superseded the previous augmentation to the File object with
the path property"*). The preload (`preload.js`) never exposes `webUtils`, so in Electron
44 `file.path` is always `undefined`, every drop falls through to the `else` branch
(`renderer.js:1768`) and toasts `Can't use "…"`.

- Audio drag & drop: broken.
- MP4 → background playlist drag & drop: broken.
- Feature is prominently advertised in README + AGENTS.

**Fix direction:** expose `getPathForFile` via the preload bridge
(`contextBridge` + `webUtils`), and use it in `handleDropped` instead of `file.path`.

### B2 [fixed] — Windows background videos can't load: `media://` URL is malformed for drive letters

`mediaUrl()` at `renderer/renderer.js:219` builds `'media://file' + encodeURI(p)` and the
handler (`main.js:341-393`) does `new URL(request.url)` and uses `u.pathname`.

Verified with node:

- `C:\Users\me\video.mp4` → `media://fileC:%5CUsers%5C…` → `new URL()` **throws**
  `TypeError: Invalid URL` (the `:` after `C` is parsed as a port) → handler returns 404.
- `C:/Users/me/video.mp4` → parses, but host becomes `fileC` and the drive letter is lost
  (`u.pathname` = `/Users/me/video.mp4`) → file not found → 404.

Cross-platform (Linux / macOS / Windows) is an explicit README goal; on Windows every
background video fails to render.

**Fix direction:** encode the path in a way that survives URL parsing (e.g. an encoded
`media://file/` authority-absolute form handling drive letters in the handler, or a
`?path=` query param), and add a Windows-style path unit test.

---

## Major

### M1 [fixed] — `bgVideo → bgVideos` settings migration is dead code and silently loses data

`renderer/renderer.js:42-58`. `DEFAULT_SETTINGS` already includes `bgVideos: [null]`
(`:16`), so after the spread `{ ...DEFAULT_SETTINGS, ...saved }` (`:47`) `merged.bgVideos`
is always truthy and:

```js
if (merged.bgVideo && !merged.bgVideos) merged.bgVideos = [merged.bgVideo];
```

can **never** run. The subsequent `delete merged.bgVideo` (`:53`) then throws away the old
key. Upgrading from the single-video version silently drops the saved background video —
contradicting the migration AGENTS.md describes.

### M2 [fixed] — `media://` range handler slurps the whole requested range into memory and blocks main

`main.js:370-377`: `Buffer.alloc(length)` plus a single `fh.read`, including for the typical
first `<video>` request `Range: bytes=0-`. A multi-GB background video causes a full multi-GB
allocation and stalls the main process during the read. Should stream via
`fs.createReadStream`/`ReadableStream`.

### M3 [fixed] — Track loading double-reads files and ships them over IPC

`main.js:220-238`: reads the whole file (cap `MAX_AUDIO_BYTES = 512 MB`, `:11`) then sends it
across IPC via structured clone. For MP3s the file is read in full a **second** time by
`mp3tags.readFileSync` (`mp3tags.js:137-140`). Every load — including `restoreAll` at startup
(`renderer.js:666-684`) — does two buffered reads + one full IPC copy. Large WAV/FLAC files
load slowly and pressure V8/GC.

### M4 [fixed] — Single-letter global shortcuts fire while typing in the custom-text input

`renderer/renderer.js:1402-1407`: while the custom-text field is focused, `r`/`R` toggles
**recording**, `h` hides the UI, `f` fullscreens, `m` mutes, and all Ctrl combos fire. Typing
the word "record" would start a recording; typing "harm" would hide the UI. It's documented in
AGENTS.md as intentional ("stillGlobal"), but it's a real footgun on the app's only text
input. Strongly consider restricting single-letter shortcuts to non-input focus while keeping
Ctrl combos global.

### M5 [fixed] — Recordings don't match the screen for background videos

`captureComposite` (`renderer.js:1536-1548`) draws each `<video>` with
`rc.drawImage(el, 0, 0, W, H)`, which **stretches** the raw frame. On screen the element uses
`object-fit: cover` (crop) plus a `scale(...)` pump transform (`styles.css:39-41`,
`renderer.js:1206-1209`). In 1:1 / 9:16 / 4K presets where the video aspect differs from the
canvas, the MP4 shows stretched video while the screen shows cropped video.

---

## Minor

- **`onRecError` is dead plumbing.** `preload.js:16-20` listens for `rec:errored`, but `main.js`
  never sends it; failures surface only at `rec:stop`.
- **F11 is double-handled.** Menu accelerator (`main.js:115`) and renderer keydown
  (`renderer.js:1443`) both toggle fullscreen. They usually agree, but a slow enter/leave
  transition can desync tracked `state.fullscreen` and double-toggle.
- **Per-frame (not per-time) decay.** Peak falloff (`renderer.js:773`, fixed `0.006`),
  particle/smoke lifetimes (`:937-940`, `:979-985`), `pulse *= 0.90` (`:1211`) and `tremor`
  (`:1212`) all scale with display refresh rate — a 165 Hz monitor sustains effects ~2.75×
  longer than 60 Hz. Timestep scaling would make screen and recordings consistent.
- **`handleVideoEnded` reloads the preloaded video.** `renderer.js:274` re-sets `src` on the
  element `prepareNextVideo` already preloaded (`:237-244`) — wasted disk IO and a possible
  crossfade glitch.
- **Recorded title loses its glow.** `parseTextShadows` (`renderer.js:1573-1581`) matches only
  `rgb()/rgba()/hsl()/hsla()`; the title glow uses `color-mix(...)` (`styles.css:171-183`), so
  recordings render that overlay text flat.
- **Capture video blur/transform approximated** (CSS `blur()` filter applied with
  `ctx.filter`, `scale()` pump ignored) — visually close, not pixel-identical.
- **`rec:frame` has no backpressure.** `main.js:320-323` writes fire-and-forget; at 4K the
  base64 JPEGs can outpace the disk stream and bloat main-process memory (no `drain` handling).
- **Stop-time frame/audio ordering** is only *probably* fine — pending `rec:frame` sends before
  the `rec:stop` invoke are delivered in order in practice, but nothing guarantees it.
- **Scrubbing collapses the bars.** During scrubbing `live` is false (`renderer.js:1176`), so
  `displayBars` decay toward 0 instead of holding (`drawSpectrum`, `:768-770`).
- **Space is hijacked globally** (`renderer.js:1419`) — pressing Space while a slider has focus
  toggles play instead of stepping the slider.
- **`toggleRecord` double-press race.** Two fast R presses can surface the
  "…Already recording" toast (guarded, but ugly).
- **`restoreAll` re-reads and auto-plays the last track** on every launch, including large WAVs.
- **`totalSlider` is misnamed** — it's the volume slider (`renderer.js:119`). Cosmetic.
- **Packaging checks:** the deb's desktop entry extracts byte-identical to
  `packaging/linux/synemar.desktop` (verified). But `StartupWMClass=synemar` vs. Electron's
  typical WM_CLASS ("Synemar") may break taskbar grouping — worth verifying on a real desktop.
  Arch `Exec=/opt/Synemar/synemar %U` passes `%U` to an app with no file-open handling
  (harmless but unhandled).
- **`mp3tags.js` reads whole files synchronously** on the main thread for every MP3
  (`:137-140`), and the ID3v2 parser ignores footer/extended-header bits (v2.4 files with a
  footer can misalign). Tests only cover v2.3/v1.
- **`jsmediatags` fallback skipped for MP3s with partial tags.** If `mp3tags` returns only a
  picture (or ID3v1), `parseTags` short-circuits (`main.js:194-197`) and never asks jsmediatags
  for richer tags/APIC.

---

## Verified good

- Recording design (offline ffmpeg pass, temp mjpeg/pcm, `Buffer.from(buf.buffer, …)` length
  fix) is sound; ordering between queued `rec:frame`/`rec:audio` messages and `rec:stop` holds.
- `contextIsolation: true`, `nodeIntegration: false`, CSP, `will-navigate` + window-open deny.
- `media://` protocol registration inside `whenReady`, `corsEnabled` + `crossorigin` (canvas
  taint) reasoning.
- Beat detection core and the double-draw regressions noted in AGENTS.md are not present.
- deb / Arch desktop-file parity with the canonical `packaging/linux/synemar.desktop` holds.