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
- `npm test` — run ALL offline unit tests (mp3tags, mediaurl, playlist, color, util, trackmeta,
  recorder). Individual suites: `node test/<name>.test.js` (plus `npm run test:tags` / `npm run test:mediaurl`
  aliases).
- `npm run syntax-check` — `node --check` every main/lib/renderer JS file, failing loudly with `&& echo OK`.
- `npm run dist` — build installers for the current OS (linux → AppImage + deb).
- `npm run dist:dir` — fast build, just `dist/linux-unpacked/synemar` (great for smoke tests).
- `packaging/arch/PKGBUILD` — Arch package built from the GitHub release's `synemar_standalone.tar.gz`
  (the `dist/linux-unpacked` contents: self-contained Electron runtime, no system `electron` needed).
  `arch=x86_64`, `depends=('ffmpeg' 'hicolor-icon-theme')`. Source URLs point at the `v$pkgver` release
  tag: the standalone tarball plus the canonical `packaging/linux/synemar.desktop` and `app.svg` fetched
  via GitHub `raw`. Build+install from that dir with `makepkg -si`. When releasing a new version, update
  the release assets, then bump `pkgver` + the three `sha256sums` (verify the URLs resolve), and
  regenerate `.SRCINFO` (`makepkg --printsrcinfo > .SRCINFO`). The packaged `chrome-sandbox` stays 0755
  (user namespaces sandboxing, like the installed deb on such systems).
- `packaging/linux/synemar.desktop` — the ONE canonical Linux desktop entry. The deb (electron-builder,
  `/opt/Synemar/synemar`, icon `app.svg` → hicolor `synemar.svg`) and the Arch package (app installed
  at `/opt/Synemar` with a `/usr/bin/synemar` symlink, icon and `.desktop` copied verbatim) must stay
  byte-identical to it; the AppImage embeds electron-builder's variant (`Exec=AppRun --no-sandbox %U`,
  `X-AppImage-Version` — inherent). After changing desktop-affecting fields (productName/description/
  category in `package.json`) or the canonical file, rebuild and diff the deb's and Arch's `.desktop`
  against `packaging/linux/synemar.desktop`. If a packaged layout moves away from `/opt/Synemar`, the
  canonical `Exec` must move with it.
- After any renderer/main/lib change, run `npm run syntax-check` (node --check of every JS file) and
  `npm test` (all offline unit suites); both must stay green.

## Architecture

- `main.js` — main process. Window + fullscreen, menu (incl. window-size presets), IPC wiring via the
  `handleIpc(channel, fn)` wrapper (catches throws → uniform `{ error: msg }`), the `media://` protocol
  registration (`registerMediaProtocol(protocol)`), the window icon (`app:iconSvg`/`app:iconPng`), and
  file/dialog handling. Everything heavy lives in `lib/`.
- `lib/recorder.js` — `RecordingSession` class: the whole recording pipeline behind
  `rec:start`/`rec:frame`/`rec:audio`/`rec:stop` (tmp-dir lifecycle, buffering, single offline ffmpeg
  pass in `finalize()`, error handling). `main.js` wires its `onError` callback to the `rec:errored`
  IPC event. Node-tested by `test/recorder.test.js`.
- `lib/mediaProtocol.js` — `register(protocol)` registers the `media://` handler; it must NOT
  self-register at import time (see the protocol gotchas below). Node-tested indirectly by
  `test/mediaurl.test.js`.
- `lib/trackMeta.js` — Node-testable tag/filename work: `parseFilenameMeta`, `coverToDataUrl`,
  `parseTags`, `bufferToArrayBuffer`, `buildAudioPayload`. Node-tested by `test/trackmeta.test.js`.
- `preload.js` — the ONLY bridge (`contextBridge.exposeInMainWorld('api', …)`). Renderer reaches the
  main process exclusively through `window.api` (incl. `recordStart`/`recordFrame`/`recordAudio`/
  `recordStop`/`onRecError`, `getAppIconSvg`/`setAppIconPng`, and `getPathForFile` which wraps
  `webUtils.getPathForFile(file)` for drag & drop).
- `renderer/index.html` — UI + CSP meta, and the `<script>` order that loads the renderer modules. Everything is one screen (no multiple pages).
- `renderer/renderer.js` — the visual engine orchestrator + wiring: audio graph/beat-detection glue,
  shared `state`/`fx`/`dt`, and all the `drawX()` layers (aurora, beams, spectrum, waveform, particles,
  rings, scanline, vignette, scrubber). It owns the global `keydown` handler and delegates each key to
  the owning module. See "Renderer modules" below.
- `renderer/*.js` (UMD renderer modules) — see "Renderer modules" below.
- `renderer/styles.css` — glassmorphism styling.
- `mp3tags.js` — small offline ID3v1/v2 tag parser (CommonJS); used by `lib/trackMeta.js` for tag
  metadata (the renderer never `require`s it — it only talks to main via `window.api`).
- `test/*.test.js` — unit tests for the offline modules; keep green (`npm test`).
- `app.svg` (repo root) — the app icon, referenced directly by `build.icon` in package.json.
  Linux dists ship the SVG itself as the freedesktop `hicolor` scalable icon (no PNG set is
  generated); Windows `.ico` and macOS `.icns` are rasterized by the electron-builder icon
  toolset (downloaded on first use), the win/mac rasterization happens inside `npm run dist`.
  It is also part of `build.files`, so the **running window** can show it: `NativeImage` cannot
  decode SVG (empty image), so main.js serves the SVG as a data URL (`app:iconSvg`), the renderer
  rasterizes it to a PNG via canvas in `Settings.applyAppIcon()`, and `app:iconPng` sets it with
  `mainWindow.setIcon()`. Never add a committed raster fallback.
- `dist/` — build output (gitignored).

## Renderer modules

Each `renderer/<name>.js` is a UMD module that attaches one global and stays `require`able in Node for
tests. `renderer.js` wires them together at the top of its IIFE (element refs → `Settings` → reuse the
shared `settings` object → `AudioEngine` → `VideoBg` → `Recorder` → `UI` → `Settings.wire`).

- `window.Util` (`util.js`) — `clamp`, `fmtTime`, `nextPow2`.
- `window.ColorUtil` (`color.js`) — color parsing/mixing (`hexToRgb`, `mixColor`, `rgbaStr`, …).
- `window.Fx` (`effects.js`) — stateless draw layers + `spawnRing`; `DEFAULTS` owns the magic numbers.
- `window.AudioEngine` (`audio.js`) — Web Audio graph, beat detection, playback/seek, recording tap.
- `window.PlaylistEngine` (`playlist.js`) — crossfade playlist core (`createPlaylist`), fully unit-tested.
- `window.VideoBg` (`videobg.js`) — background-video reconcile + pickers on top of the playlist
  (`apply()`, `hasVideos()`, `addPath()`, `pickNextVideoSlot()`).
- `window.Recorder` (`recording.js`) — composite → JPEG capture + PCM push during recording,
  backpressure (`recBusy`) and the `R`/`●` toggle.
- `window.Settings` (`settings.js`) — `DEFAULT_SETTINGS` + load/save (`save()`), `apply()`, the settings
  panel listeners (attached by `wire({ audioEngine, videoBg, ui })`), and `applyAppIcon()`.
- `window.UI` (`ui.js`) — `toast`, settings open/close, drag & drop, `setupDrag`, canvas presets,
  `updateSizeNote`, cursor hiding.

## Settings persistence (important)

- Settings live in `localStorage` under key `neoneq.settings`, read/written by the `Settings` module
  (`renderer/settings.js`) — there is no `window.api` bridge for settings.
- Background videos are persisted by file path as `settings.bgVideos` (array of paths, up to 5; empty
  slots are `null`). `Settings.loadSettings()` migrates the old single `settings.bgVideo` string into
  `bgVideos` and drops the removed image keys (`bgImage`/`bgImagePath`). Do not reintroduce data URLs.

## `media://` protocol gotchas (painful lessons — read before touching)

- The scheme is registered privileged in the **main process module scope** so the renderer can use it.
- **`protocol.handle('media', …)` must be registered inside `app.whenReady()`, before `createWindow()`**,
  not at module top level. Doing it at top level throws `Session can only be received when app is
  ready` and crashes the whole main process — the app then seemingly "works" but backgrounds never show.
- The handler is in `lib/mediaProtocol.js` (`register(protocol)`, called from main.js inside
  `whenReady()`). It supports `Range`/206 requests with
  Accept-Ranges + Content-Range headers; returns 404 (not throws) on read errors, and logs them.
  Range data is streamed via `fs.createReadStream` (wrapped with `Readable.toWeb`) so the main
  process never buffers a full multi-GB file (it used to `Buffer.alloc` the whole requested range).
- Video URLs are built as `'media://file/?path=' + encodeURIComponent(filePath)` — the `file` host
  segment is REQUIRED (`media:///abs/path` with an empty host, and the old bare
  `'media://file' + encodeURI(p)` without a slash, are rejected/broken). The path travels in the
  `?path=` query param (read back via `u.searchParams.get('path')`), NOT in `u.pathname`, because a
  Windows drive colon (`C:` → `%3A`) would otherwise be misparsed as a port and drop the drive
  letter. `test/mediaurl.test.js` guards the round-trip for Windows/forward-slash/Linux paths.
- Custom-scheme responses need `Access-Control-Allow-Origin: *`. Note: `fetch()` to `media://` still
  fails CORS even with that header (observed); the broken media case is already covered — `<video>`
  loading works fine, so don't add `bypassCSP` standard-scheme hacks to "fix" fetch.
- `#bg-video` in index.html must be a real `<video>` element (it was once accidentally a `<div>`; the
  page then threw `v.load is not a function`). There are TWO such elements (`#bg-video`,
  `#bg-video-2`) for crossfading between playlist items; both must stay `<video>`. The range/206
  support is what lets `<video>` seek + scrub through the media:// stream.
- The CSP in index.html must include `media:` (scheme-source) in both `media-src` and `connect-src`.
  If a video background silently fails to load, check CSP first.

## Renderer/visual-engine notes

- Beat detection: bass-band > 0.11 && > avg×1.28 with a kick cooldown. `state.playing`, `pulse`,
  `curFft`, `lv` (bass/mid/hi), `energyHist` are shared by all draw layers; keep them in sync.
- Drawing operates on a canvas sized via `devicePixelRatio` (resized + `setTransform` each frame);
  do not double-call `drawParticles` or draw aurora twice per frame (both were real regressions before).
- Retro post-process filters live in `renderer/effects.js` and are drawn AFTER `vctx.restore()` (like
  `drawVignette`, stable overlays), so `captureComposite()` in `recording.js` picks them up from the
  `#viz` canvas for free. Each is a boolean setting — `crtScanlines` (`drawCrtScanlines`, thin black
  lines every CRT_LINES_SPACING px), `filmGrain` (`drawFilmGrain`, regenerated 128×128 noise tiled
  with `overlay` blend, cached/rebuilt every 3rd frame to keep it cheap), `vhsWobble`
  (`drawVhsWobble`, flickering dark/bright horizontal bands timed off `now`). They default to `false`
  (stylistic opt-ins). Do NOT place them inside the camera-transform `vctx.save()/restore()` block —
  they must stay screen-space to fill the frame. `drawFilmGrain` needs `document` (creates an
  offscreen canvas) so it is renderer-only, not Node-testable.
- `VideoBg.apply()` reconciles the video playlist (`applyBgVisual`-style logic now lives in
  `renderer/videobg.js`): it toggles `body.has-vid` (the ONLY thing that
  shows the `<video>` elements) and restarts the playlist only when the actual file list changes
  (`appliedListKey`). Playlist state lives in `activeVidIdx`/`activePlIdx`; `handleVideoEnded`
  crossfades (CSS `transition: opacity 0.9s`) into the preloaded next video via the second `<video>`.
- Interface settings: `showLogo` / `showDock` toggle `#brand` / `#dock` via `body.no-logo` / `body.no-dock`;
  `marqueeX`/`marqueeY` are the title's position in viewport % (persisted), changed by dragging `#marquee`
  via `ui.setupDrag(el, keyX, keyY, label)` (also used for `#custom-text` with `customX`/`customY`).
  `body.hideui` (H key) is separate and defers to the saved marquee position; toggled by
  `ui.toggleHideUi()`.
- `layout()` drops the equalizer down `Math.min(H*0.06, 80)px` when the dock is hidden
  (`body.no-dock`) or UI is hidden (`body.hideui`) — the shift lerps via `uiDz` each frame.
- Recovery affordance: `#btn-settings-plain` (a floating gear) is CSS-shown only when
  `body.no-dock:not(.hideui)`, so settings stay reachable when the dock (which holds the normal
  gear) is hidden. Global shortcuts fire from `INPUT`/`TEXTAREA` focus ONLY for Ctrl/Cmd combos
  (and Escape to blur); single-letter keys (M/F/H/R), Space, and arrows stay input-bound so typing
  in the custom-text field never triggers a shortcut.
- Drag & drop resolves dropped files via `webUtils.getPathForFile` (exposed through
  `window.api.getPathForFile` in preload) — the old `File.path` augmentation was removed in
  Electron 32 and is always `undefined` there. It handles audio (`.mp3` etc.) and mp4s by
  extension; keep the file-type lists aligned with the dialog `FILTERS` in main.js. Dropped mp4s
  append to the playlist via `videoBg.addPath()`.

## Recording (important — read before touching)

- Trigger: `R` key or the ● button (`#btn-rec`); toggles via `recorder.toggle()` (renderer/recording.js).
  `Recorder`'s internal `state.recording` gates everything.
- Design (why): the old approach streamed frames + PCM straight into one live `ffmpeg` process via two
  pipes (image2pipe on stdin, s16le on `pipe:3`). ffmpeg's alternating pipe reads starved one input and
  the whole pipeline deadlocked ~0.4 s in. So: **during recording nothing is encoded** — the renderer
  composites frames and pushes JPEG base64 (`rec:frame`), and audio PCM is memory-buffered
  (`rec:audio`); on stop `RecordingSession.finalize()` (lib/recorder.js) does ONE offline ffmpeg pass
  (files → h264/aac mp4) and deletes the temp dir. Video frames are streamed to a temp `video.mjpeg`,
  audio is buffered and written as `audio.pcm`. Output: `synemar-rec-<stamp>.mp4` in `recOutputDir()`
  (videos → downloads → home).
- fps clamp: 10–60, default 30; audio rate is the AudioContext `sampleRate` (passed via `rec:start`).
  ffmpeg args live in `RecordingSession.finalize` (`-shortest`, `-vf scale=trunc(iw/2)*2`,
  libx264 veryfast crf18, aac 192k, `+faststart`). ENOENT → friendly error toast.
- **The ScriptProcessor tap must copy input into `outputBuffer`** (`getChannelData(0).set(inL)`) or the
  output stays pure zeros → pressing record mutes all sound. Route: `gain → recTap → destination` via
  `wireAudioOut`. Also the recorded rate must match `ctx.sampleRate` in ffmpeg's `-ar` or the audio
  plays too slow + low-pitched (labeling 48000 as 44100 ≈ 8.8% slower).
- **`Buffer.from(Int16Array)` writes `array.length` LSB-bytes, not the full memory** — this silently
  halves/corrupts IPC'd PCM. Audio chunks arrive in main as `Int16Array`; convert with
  `Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)` in `RecordingSession.audio()`
  (this WAS the "half-length audio / video cut to 1.09 s" bug). If A/V length regresses, check this first.
- Canvas taint for the capture: `#bg-video`/`#bg-video-2` need `crossorigin="anonymous"` (set in
  index.html) and `media://` needs `corsEnabled: true` in `registerSchemesAsPrivileged` (see the
  protocol gotchas above), otherwise `toDataURL` throws. The earlier "record silently stopped at ~0.36 s"
  symptom was actually canvas taint making `toDataURL` throw in the capture timer.
- `captureComposite()` in renderer/recording.js reproduces the visible frame bottom-up: bg color →
  video(s) with per-element CSS opacity (`settings.blur` via `ctx.filter`) → dim tint →
  highlight/vignette gradients → `drawImage(vizCanvas)`. Videos are drawn with `drawVideoCover()`,
  matching the screen's `object-fit: cover` crop plus the `scale(pump)` pump transform, so recordings
  match non-stretched. Keep `state.recCap`/`recCapCtx` reused (don't
  recreate per frame). Also `-use_wallclock_as_timestamps` doesn't help for image2pipe — don't add it.
- `R` must stay out of the Ctrl/Cmd flavors (Ctrl+R = browser reload). `r`/`R` fire only when not
  typing in an input (single-letter shortcuts are input-bound; see the recovery note above).
- The ScriptProcessorNode deprecation warning fires only while the tap lives (during recording) — it's
  expected; the smoke-test "0 INFO:CONSOLE" check applies to a normal launch (no recording).

## Conventions

- CommonJS (`require`/`module.exports`) everywhere; no ESM, no bundler.
- Keep the code comment-free (repo style); prefer clear names over comments.
- Match surrounding style: `function name() {}` (not arrows for top-level), string keys, 2-space indent.
- Don't add dependencies unless truly needed — everything is hand-rolled (id3 parser, protocol).
  The one exception is the `jsmediatags` dependency in main.js, used as the fallback tag reader for
  non-MP3 formats (MP3 uses the hand-rolled `mp3tags.js` first).
- After touching `renderer.js`/`main.js`/`lib/*`, run `npm run syntax-check` and `npm test` before finishing.

## Gotchas / environment

- This dev box: Linux + Wayland (`DISPLAY=:0`); Electron prints a harmless Vulkan/Wayland GPU warning
  on launch — ignore it. There is no `xvfb-run`; headless GUI tests run against the real display.
- When running Electron from a script and piping/logging output, redirect to a file rather than
  `grep | head` (SIGPIPE can kill electron before errors flush).
- `npm test` runs every offline suite (mp3tags, mediaurl, playlist, color, util, trackmeta, recorder);
  single-suite aliases are `npm run test:tags` / `npm run test:mediaurl`.
- If an Electron main/process step hangs, suspect `whenReady()` ordering or a never-settling
  `executeJavaScript` promise before blaming the renderer logic.