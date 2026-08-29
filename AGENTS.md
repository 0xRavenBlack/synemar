# AGENTS.md

Guidance for AI agents and contributors working in this repository.

## What this is

**Synemar** — a fullscreen Electron music visualizer. Load an MP3 (file picker or drag & drop), see
title/artist/album, and watch a Web Audio spectrum + waveform animation driven by the beat. Cover art
is parsed from tags but is not rendered anywhere.
It supports up to 5 background videos (muted, played one after another with a ~0.9 s crossfade),
adjustable colors, particles/bursts/aurora/rings/scanline effects, camera shake on kicks, and
window-size presets (1080p/1:1/9:16…) meant for recording YouTube music-video content. Press `H` to
hide the UI. Press `R` (or the ● button) to record visual + audio to an MP4 via system ffmpeg.
Image backgrounds were intentionally removed.

Language/stack: plain JavaScript (no TypeScript, no bundler), Electron ~44, Node 24, npm. Written
originally assuming a Linux/Wayland dev box; the app itself runs cross-platform. Recording requires
`ffmpeg` on the `PATH`.

## Commands

- `npm install` — install dependencies (electron, electron-builder, jsmediatags).
- `npm start` — run the app (`electron .`).
- `node test/mp3tags.test.js` — run the offline MP3 tag parser unit tests. (There is **no `npm test`**
  script; use this command or `npm run test:tags`.)
- `npm run icon` — regenerate the legacy raster fallback `assets/icon.png`/`assets/icon.ico`
  (512×512) via `scripts/gen-icon.js`. The real app icon is `app.svg` (repo root) — the build
  (`electron-builder` `build.icon`) uses that SVG directly: Linux packages the SVG itself as the
  freedesktop scalable icon, Windows/macOS rasterize it to `.ico`/`.icns`.
- `npm run dist` — build installers for the current OS (linux → AppImage + deb).
- `npm run dist:dir` — fast build, just `dist/linux-unpacked/synemar` (great for smoke tests).
- After any renderer/main change, `node --check` the JS files; add `&& echo OK` to make bash fail loudly.

## Architecture

- `main.js` — main process. Window + fullscreen, menu (incl. window-size presets), all `ipcMain.handle`
  channels, the video file dialog (`dialog:selectVideo` returns a path), `window:setContentSize`, the
  `media://` protocol, and the recording pipeline (`rec:start`/`rec:frame`/`rec:audio`/`rec:stop`).
- `preload.js` — the ONLY bridge (`contextBridge.exposeInMainWorld('api', …)`). Renderer reaches the
  main process exclusively through `window.api` (incl. `recordStart`/`recordFrame`/`recordAudio`/
  `recordStop`/`onRecError`).
- `renderer/index.html` — UI + CSP meta. Everything is one screen (no multiple pages).
- `renderer/renderer.js` — the whole visual engine: audio graph, playback, beat detection, and all the
  `drawX()` layers (aurora, beams, spectrum, waveform, particles, rings, scanline, vignette, scrubber).
- `renderer/styles.css` — glassmorphism styling.
- `mp3tags.js` — small offline ID3v1/v2 tag parser (CommonJS); used by main.js for tag metadata
  (the renderer never `require`s it — it only talks to main via `window.api`).
- `scripts/gen-icon.js` — programmatically generates the legacy raster fallback icon PNG/ICO
  (`npm run icon`); the packaged app uses `app.svg` instead.
- `test/mp3tags.test.js` — unit tests for the parser; keep green.
- `app.svg` (repo root) — the app icon, referenced directly by `build.icon` in package.json.
  Linux dists ship the SVG itself as the freedesktop `hicolor` scalable icon (no PNG set is
  generated); Windows `.ico` and macOS `.icns` are rasterized by the electron-builder icon
  toolset (downloaded on first use), the win/mac rasterization happens inside `npm run dist`.
- `assets/icon.png` — legacy raster fallback; generated, not hand-edited.
- `dist/` — build output (gitignored).

## Settings persistence (important)

- Settings live in `localStorage` under key `neoneq.settings`, read/written directly in renderer.js by
  `loadSettings()`/`saveSettings()` — there is no `window.api` bridge for settings.
- Background videos are persisted by file path as `settings.bgVideos` (array of paths, up to 5; empty
  slots are `null`). `loadSettings()` migrates the old single `settings.bgVideo` string into
  `bgVideos` and drops the removed image keys (`bgImage`/`bgImagePath`). Do not reintroduce data URLs.

## `media://` protocol gotchas (painful lessons — read before touching)

- The scheme is registered privileged in the **main process module scope** so the renderer can use it.
- **`protocol.handle('media', …)` must be registered inside `app.whenReady()`, before `createWindow()`**,
  not at module top level. Doing it at top level throws `Session can only be received when app is
  ready` and crashes the whole main process — the app then seemingly "works" but backgrounds never show.
- The handler is in `registerMediaProtocol()` (main.js). It supports `Range`/206 requests with
  Accept-Ranges + Content-Range headers; returns 404 (not throws) on read errors, and logs them.
- Video URLs are built as `'media://file' + encodeURI(filePath)` — the `file` host segment is REQUIRED;
  `media:///abs/path` (empty host) is rejected by Chromium for standard schemes.
- Custom-scheme responses need `Access-Control-Allow-Origin: *`. Note: `fetch()` to `media://` still
  fails CORS even with that header (observed); the broken media case is already covered — `<video>`
  loading works fine, so don't add `bypassCSP` standard-scheme hacks to "fix" fetch.
- `#bg-video` in index.html must be a real `<video>` element (it was once accidentally a `<div>`; the
  page then threw `v.load is not a function`). There are TWO such elements (`#bg-video`,
  `#bg-video-2`) for crossfading between playlist items; both must stay `<video>`.
- The CSP in index.html must include `media:` (scheme-source) in both `media-src` and `connect-src`.
  If a video background silently fails to load, check CSP first.

## Renderer/visual-engine notes

- Beat detection: bass-band > 0.11 && > avg×1.28 with a kick cooldown. `state.playing`, `pulse`,
  `curFft`, `lv` (bass/mid/hi), `energyHist` are shared by all draw layers; keep them in sync.
- Drawing operates on a canvas sized via `devicePixelRatio` (resized + `setTransform` each frame);
  do not double-call `drawParticles` or draw aurora twice per frame (both were real regressions before).
- `applyBgVisual()` reconciles the video playlist: it toggles `body.has-vid` (the ONLY thing that
  shows the `<video>` elements) and restarts the playlist only when the actual file list changes
  (`appliedListKey`). Playlist state lives in `activeVidIdx`/`activePlIdx`; `handleVideoEnded`
  crossfades (CSS `transition: opacity 0.9s`) into the preloaded next video via the second `<video>`.
- Interface settings: `showLogo` / `showDock` toggle `#brand` / `#dock` via `body.no-logo` / `body.no-dock`;
  `marqueeX`/`marqueeY` are the title's position in viewport % (persisted), changed by dragging `#marquee`
  (`setupTitleDrag`). `body.hideui` (H key) is separate and defers to the saved marquee position.
- `layout()` drops the equalizer down `Math.min(H*0.06, 80)px` when the dock is hidden
  (`body.no-dock`) or UI is hidden (`body.hideui`) — the shift lerps via `uiDz` each frame.
- Recovery affordance: `#btn-settings-plain` (a floating gear) is CSS-shown only when
  `body.no-dock:not(.hideui)`, so settings stay reachable when the dock (which holds the normal
  gear) is hidden. Global shortcuts still fire from `INPUT`/`TEXTAREA` focus for Ctrl combos, M, F, H,
  and R keys (space/arrows stay input-bound).
- Drag & drop handles audio (`.mp3`) and mp4s by extension; keep the file-type lists aligned
  with the dialog `FILTERS` in main.js. Dropped mp4s append to the playlist via `addVideoPath`.

## Recording (important — read before touching)

- Trigger: `R` key (`stillGlobal` list) or the ● button (`#btn-rec`); toggles via `toggleRecord`/
  `startRecord`/`stopRecord`/`updateRecButton` in renderer.js. `state.recording` gates everything.
- Design (why): the old approach streamed frames + PCM straight into one live `ffmpeg` process via two
  pipes (image2pipe on stdin, s16le on `pipe:3`). ffmpeg's alternating pipe reads starved one input and
  the whole pipeline deadlocked ~0.4 s in. So: **during recording nothing is encoded** — the renderer
  composites frames and pushes JPEG base64 (`rec:frame`), and audio PCM is memory-buffered
  (`rec:audio`); on stop `recFinalize()` does ONE offline ffmpeg pass (files → h264/aac mp4) and deletes
  the temp dir. Video frames are streamed to a temp `video.mjpeg`, audio is buffered and written as
  `audio.pcm`. Output: `synemar-rec-<stamp>.mp4` in `recOutputDir()` (videos → downloads → home).
- fps clamp: 10–60, default 30; audio rate is the AudioContext `sampleRate` (passed via `rec:start`).
  ffmpeg args live in `recFinalize` (`-shortest`, `-vf scale=trunc(iw/2)*2`, libx264 veryfast crf18,
  aac 192k, `+faststart`). ENOENT → friendly error toast.
- **The ScriptProcessor tap must copy input into `outputBuffer`** (`getChannelData(0).set(inL)`) or the
  output stays pure zeros → pressing record mutes all sound. Route: `gain → recTap → destination` via
  `wireAudioOut`. Also the recorded rate must match `ctx.sampleRate` in ffmpeg's `-ar` or the audio
  plays too slow + low-pitched (labeling 48000 as 44100 ≈ 8.8% slower).
- **`Buffer.from(Int16Array)` writes `array.length` LSB-bytes, not the full memory** — this silently
  halves/corrupts IPC'd PCM. Audio chunks arrive in main as `Int16Array`; convert with
  `Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)` (this WAS the "half-length audio / video
  cut to 1.09 s" bug). If A/V length regresses, check this first.
- Canvas taint for the capture: `#bg-video`/`#bg-video-2` need `crossorigin="anonymous"` (set in
  index.html) and `media://` needs `corsEnabled: true` in `registerSchemesAsPrivileged` (see the
  protocol gotchas above), otherwise `toDataURL` throws. The earlier "record silently stopped at ~0.36 s"
  symptom was actually canvas taint making `toDataURL` throw in the capture timer.
- `captureComposite()` in renderer.js reproduces the visible frame bottom-up: bg color →
  video(s) with per-element CSS opacity (and `settings.blur` via `ctx.filter`) → dim tint →
  highlight/vignette gradients → `drawImage(vizCanvas)`. Keep `state.recCap`/`recCapCtx` reused (don't
  recreate per frame). Also `-use_wallclock_as_timestamps` doesn't help for image2pipe — don't add it.
- `R` must stay out of the Ctrl/Cmd flavors (Ctrl+R = browser reload). `r`/`R` are in `stillGlobal`
  so they fire even while typing in inputs.
- The ScriptProcessorNode deprecation warning fires only while the tap lives (during recording) — it's
  expected; the smoke-test "0 INFO:CONSOLE" check applies to a normal launch (no recording).

## Conventions

- CommonJS (`require`/`module.exports`) everywhere; no ESM, no bundler.
- Keep the code comment-free (repo style); prefer clear names over comments.
- Match surrounding style: `function name() {}` (not arrows for top-level), string keys, 2-space indent.
- Don't add dependencies unless truly needed — everything is hand-rolled (id3 parser, protocol, icon gen).
  The one exception is the `jsmediatags` dependency in main.js, used as the fallback tag reader for
  non-MP3 formats (MP3 uses the hand-rolled `mp3tags.js` first).
- After touching `renderer.js`/`main.js`, run `node --check` and the mp3tags test before finishing.

## Gotchas / environment

- This dev box: Linux + Wayland (`DISPLAY=:0`); Electron prints a harmless Vulkan/Wayland GPU warning
  on launch — ignore it. There is no `xvfb-run`; headless GUI tests run against the real display.
- When running Electron from a script and piping/logging output, redirect to a file rather than
  `grep | head` (SIGPIPE can kill electron before errors flush).
- `npm test` is not defined — use `node test/mp3tags.test.js` (alias `npm run test:tags`).
- If an Electron main/process step hangs, suspect `whenReady()` ordering or a never-settling
  `executeJavaScript` promise before blaming the renderer logic.