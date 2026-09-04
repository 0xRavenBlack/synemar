# AGENTS.md

Guidance for AI agents and contributors working in this repository.

## What this is

**Synemar** — a fullscreen Electron music visualizer. Load an MP3 (file picker or drag & drop), see
title/artist/album, and watch a Web Audio spectrum + waveform animation driven by the beat. Cover art
is parsed from tags but is not rendered anywhere.
Music and videos live in a combined, unlimited playlist (`Ctrl+P` or the dock ☰ button). Audio tracks
play one after another (auto-advance); background videos play one after another with a ~0.9 s
crossfade; the two lists loop **independently**. Playlists persist automatically in `localStorage` and
can be exported/imported as JSON. The playlist overlay (left = audio, right = video) replaces the old
in-settings video pickers.
It supports adjustable colors (via an in-app color-picker overlay), particles/bursts/aurora/rings/
scanline effects, classic bars + circular sunburst visualizer modes, camera shake on kicks,
and window-size presets (1080p/1:1/9:16…) meant for recording YouTube music-video content. Press `H` to
hide the UI. Press `R` (or the ● button) to record visual + audio to a video file (MP4/WebM) via the
browser's built-in MediaRecorder (canvas captureStream + MediaStreamDestination) — no external tools.
Image backgrounds were intentionally removed.

Language/stack: plain JavaScript (no TypeScript, no bundler), Electron ~44, Node 24, npm. Written
originally assuming a Linux/Wayland dev box; the app itself runs cross-platform. Recording is
self-contained (no ffmpeg or other system dependency).

## Commands

- `npm install` — install dependencies (electron, electron-builder, jsmediatags).
- `npm start` — run the app (`electron .`).
- `npm test` — run ALL offline unit tests (mp3tags, mediaurl, playlist, playlistManager, color, util,
  trackmeta). Individual suites: `node test/<name>.test.js` (plus `npm run test:tags` /
  `npm run test:mediaurl` aliases).
- `npm run syntax-check` — `node --check` every main/lib/renderer JS file, failing loudly with `&& echo OK`.
- `npm run dist` — build installers for the current OS (linux → AppImage + deb).
- `npm run dist:dir` — fast build, just `dist/linux-unpacked/synemar` (great for smoke tests).
- `packaging/arch/PKGBUILD` — Arch package built from the GitHub release's `synemar_standalone.tar.gz`
  (the `dist/linux-unpacked` contents: self-contained Electron runtime, no system `electron` needed).
  `arch=x86_64`, `depends=('hicolor-icon-theme')`. Source URLs point at the `v$pkgver` release
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
- `lib/mediaProtocol.js` — `register(protocol)` registers the `media://` handler; it must NOT
  self-register at import time (see the protocol gotchas below). Node-tested indirectly by
  `test/mediaurl.test.js`.
- `lib/trackMeta.js` — Node-testable tag/filename work: `parseFilenameMeta`, `coverToDataUrl`,
  `parseTags`, `bufferToArrayBuffer`, `buildAudioPayload`. Node-tested by `test/trackmeta.test.js`.
- `preload.js` — the ONLY bridge (`contextBridge.exposeInMainWorld('api', …)`). Renderer reaches the
  main process exclusively through `window.api` (incl. `saveRecording`, `getAppIconSvg`/`setAppIconPng`,
  `getPathForFile` which wraps `webUtils.getPathForFile(file)` for drag & drop, multi-select dialogs
  `selectMultipleAudio`/`selectMultipleVideo`, and playlist JSON dialogs `savePlaylistFile`/`openPlaylistFile`).
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
shared `settings` object → `PlaylistManager` → `AudioEngine` → `VideoBg` → `Recorder` → `UI` →
`PlaylistUI` → `Settings.wire`).

- `window.Util` (`util.js`) — `clamp`, `fmtTime`, `nextPow2`.
- `window.ColorUtil` (`color.js`) — color parsing/mixing (`hexToRgb`, `mixColor`, `rgbaStr`, …).
- `window.Fx` (`effects.js`) — stateless draw layers + `spawnRing`; `DEFAULTS` owns the magic numbers.
- `window.AudioEngine` (`audio.js`) — Web Audio graph, beat detection, playback/seek, recording tap.
- `window.PlaylistEngine` (`playlist.js`) — crossfade playlist core (`createPlaylist`), fully unit-tested.
- `window.PlaylistManager` (`playlistManager.js`) — combined audio+video playlist state: CRUD, current
  index, auto-advance (`nextAudio`/`previousAudio`), JSON export/import, `localStorage` persistence
  (`neoneq.playlist`), legacy migration, and change callbacks (`onAudioChanged`/`onVideoChanged`/
  `onListChanged`). Fully unit-tested by `test/playlistManager.test.js`.
- `window.PlaylistUI` (`playlistUI.js`) — the `#playlist-overlay` DOM: two track lists (audio left,
  video right), drag-to-reorder, click-to-select, per-column desktop file drops, multi-select add
  buttons, playlist name, and Export/Import JSON. It owns the `☰` dock button + backdrop-close.
- `window.VideoBg` (`videobg.js`) — background-video reconcile driven by `PlaylistManager`
  (`apply()`, `hasVideos()`): toggles `body.has-vid` and restarts the `PlaylistEngine` when the
  video list OR `currentVideoIndex` changes (`appliedListKey`).
- `window.Recorder` (`recording.js`) — composite frame capture via `canvas.captureStream` + audio via
  `MediaStreamDestination`, muxed by `MediaRecorder`; `R`/`●` toggle and `pickMime()` codec selection.
- `window.Settings` (`settings.js`) — `DEFAULT_SETTINGS` + load/save (`save()`), `apply()`, the settings
  panel listeners (attached by `wire({ audioEngine, videoBg, ui })`), `applyAppIcon()`, and
  `initColorPicker()` for the in-app color-picker overlay.
- `window.UI` (`ui.js`) — `toast`, settings open/close, drag & drop, `setupDrag`, canvas presets,
  `updateSizeNote`, cursor hiding.

## Playlist architecture (important)

- **Combined playlist.** `PlaylistManager` owns a single state object with `audioTracks` and
  `videoTracks` (each `{ path, fileName }`), plus `currentAudioIndex`/`currentVideoIndex`. Audio and
  video advance **independently**: audio auto-plays the next track when one ends; videos crossfade
  through the `PlaylistEngine`. There is no per-track audio↔video pairing and no length limit.
- **Persistence** lives in `localStorage` under `neoneq.playlist` (see below). Change notification is
  split so UI actions don't surprise the engine:
  - `onAudioChanged(track)` fires when the *current* audio track changes (select/next/prev) — renderer
    loads + plays it.
  - `onVideoChanged(track)` + `onListChanged(changed)` fire when current video or the video list
    changes — renderer calls `videoBg.apply()`, which restarts the background playlist only when its
    key (list + current index) actually changes.
  - `addAudioTrack` when the list was empty auto-selects index 0 (→ `onAudioChanged` → starts playing);
    appending to a non-empty list only fires `onListChanged`, so it never interrupts what's playing.
- **JSON format** (`exportJSON` / `importJSON`): `{ name, audioTracks, videoTracks, currentAudioIndex,
  currentVideoIndex }`. Import validates shape and preserves the current indices; missing paths are
  sanitized out. Export/import go through the main-process Save/Open dialogs (`playlist:save` /
  `playlist:open`).
- **Auto-advance** is wired in `renderer.js`: `audioEngine.onEnded` → `manager.nextAudio()` →
  `onAudioChanged` → `playTrack`. Single external audio opens/`Ctrl+O` go through `playAudioFile(path)`,
  which adds-then-selects (or re-selects) so playback always starts.
- **Legacy migration** (`migrateFromLegacy`) runs once when no `neoneq.playlist` exists: it folds the old
  `neoneq.lastTrack` single audio file and the old `settings.bgVideos` array into the combined playlist,
  then removes `neoneq.lastTrack`. `loadSettings()` also drops `bgVideos`/`bgImage`/`bgImagePath`.
- **Keyboard / access:** the dock's labeled `☰ Playlist` button (in the left cluster, where the old
  "Open" button was), `Ctrl+P` (menu item too) and plain `L` toggle the overlay, `Escape` closes it
  (after settings). The empty-state card shows only a single "Open the playlist" button
  (`#btn-pick-vid`) plus a short blurb explaining that music and videos run independently. There is
  no "Open a track" button anymore — `Ctrl+O` and the menu's Open Track still call `openTrack()`.

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
- `VideoBg.apply()` reconciles the video playlist against `PlaylistManager.state.videoTracks`
  (see "Playlist architecture"): it toggles `body.has-vid` (the ONLY thing that
  shows the `<video>` elements) and restarts the playlist only when the key
  `list.join('|') + '#' + currentVideoIndex` actually changes (`appliedListKey`). Playlist state
  lives in `activeVidIdx`/`activePlIdx`; `handleVideoEnded`
  crossfades (CSS `transition: opacity 0.9s`) into the preloaded next video via the second `<video>`.
- Visualizer mode: `settings.circular` switches between the classic horizontal bars
  (`Fx.drawSpectrum`) and the circular sunburst (`Fx.drawCircleSpectrum`, `renderer/effects.js`).
  There is **no settings checkbox** for it anymore — the mode is toggled from the dock's
  `#btn-viz` button (or the `V` key, handled in `renderer.js`). The button intentionally shows the
  **target** mode it switches to, as `[icon | Text]` (`▂▄▆`/"Bar Visualizer" ↔
  `◉`/"Radial Visualizer"); `refreshVizButton()` derives the target from `settings.circular` and is
  called on load and after each toggle. Both modes share the identical per-bar data path — the
  `displayBars`/`peakVals` smoothing arrays, the
  `FREQ_IDX_POWER` frequency-bin mapping, attack/decay, hue-shift gradient (vizBottom→vizTop per
  bar) and peak caps — so the two modes animate consistently. `drawCircleSpectrum` needs no `L`
  layout object; it centers on `W/2, H/2` and rotates each bar into place (constants prefixed
  `CIRCLE_*` in `DEFAULTS`: bar size/thickness lives in `CIRCLE_BAR_WIDTH_FACTOR`+`CIRCLE_GAP_FACTOR`,
  transparency in `CIRCLE_BAR_ALPHA` via per-bar `globalAlpha`). The panel backdrop
  (`drawBandPanel`, `PANEL_BG`/edge/stroke alpha in `DEFAULTS`) is intentionally fully transparent
  in every mode so no box shows behind either visualizer.
- Color inputs in settings are replaced by an in-app overlay picker (the native `<input
  type="color">` popup could open off-window on Wayland). Clicking a `.color-field input` opens
  `#color-picker-overlay` (a centered, always-visible glass dialog; `settings.js` `initColorPicker()`
  draws an HSV-style SV canvas + hue strip and back-fills the hidden native input, so `apply()`/`save()`
  and the `data-key`-driven bindings work unchanged). The overlay sits above `#settings`
  (z-index 8 vs 7) and stays open with the settings panel; `ui.js`'s backdrop-close and renderer.js's
  Escape handler both bail out (closing the picker first) while it's open.
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
  (and Escape to blur); single-letter keys (M/V/F/H/R), Space, and arrows stay input-bound so typing
  in the custom-text field never triggers a shortcut.
- Drag & drop resolves dropped files via `webUtils.getPathForFile` (exposed through
  `window.api.getPathForFile` in preload) — the old `File.path` augmentation was removed in
  Electron 32 and is always `undefined` there. It handles audio (`.mp3` etc.) and mp4s by
  extension; keep the file-type lists aligned with the dialog `FILTERS` in main.js. Dropped mp4s
  append to the playlist via `renderer.js`'s `addVideoFile()` (audio via `playAudioFile()`); dropping a
  file onto a playlist overlay column adds to that list with `stopPropagation()` so the global
  drop handler doesn't double-process it.

## Recording (important — read before touching)

### Primary method: MediaRecorder + canvas.captureStream (renderer-side)

- Trigger: `R` key or the ● button (`#btn-rec`); toggles via `recorder.toggle()` (renderer/recording.js),
  gated by `Recorder`'s internal `state.recording`.
- **Design (why):** the old approach hand-rolled a frame pipeline (`setInterval` → `captureComposite` →
  `toBlob` → per-frame IPC → ffmpeg `image2pipe`), which fought the main thread. Its audio tap ran on
  the main thread too (ScriptProcessor, then an AudioWorklet port to the same path), so heavy
  composite/encode load dropped frames AND audio; the short audio then made `-shortest` truncate the
  video → stuttery audio + too-fast video. No amount of measured-rate/fps correction fixed the
  dropouts. **So now recording uses the browser's built-in muxer: `MediaRecorder` fed by
  `canvas.captureStream()` (video) + a `MediaStreamDestination` tap (audio).** Timing, A/V sync,
  frame-dropping and encoding are all handled by Chromium, so the output duration always equals
  wall-clock time regardless of main-thread load.
- **Video track:** `state.recCap.captureStream(30)` on the detached composite canvas, which
  `startRecCapture()` repaints every `requestAnimationFrame` via `captureComposite()` then
  `recVTrack.requestFrame()`. Because it's a capture stream, dropped frames just drop; the recorded
  length is always correct (no `-shortest` distortion).
- **Audio track:** `ctx.createMediaStreamDestination()` (`state.recMediaDest`). `syncRecAudio()`
  connects the **current** `audioEngine.state.gainNode → mediaDest` so recording taps the audible
  mix (the worklet/ScriptProcessor zero-mute copy is no longer needed). `syncRecAudio()` re-runs each
  rAF and reconnects when `gainNode` identity changes (a mid-recording track change — `spawnSource`
  recreates `gainNode` and `wireAudioOut` would otherwise drop the tap). On stop,
  `cleanupAudio()` disconnects `recGain` from `mediaDest` and re-runs `wireAudioOut`.
- **Codec/format:** `pickMime()` chooses the first MediaRecorder-supported type: `video/mp4;codecs=
  avc1.42E01E,mp4a.40.2` (H.264+AAC, gives `.mp4`) → plain `video/mp4` → `webm/vp9` → `webm/vp8` →
  `video/webm`. Extension follows (`mp4`/`webm`). Bits: 12 Mbps video, 192 kbps audio.
- **Save:** `MediaRecorder.ondataavailable` collects Blob chunks; on stop they're joined into one Blob,
  `.arrayBuffer()`'d and sent via `window.api.saveRecording({ buf, ext })` (`rec:save` in main.js
  writes `Buffer.from(buf)` to `synemar-rec-<stamp>.<ext>` in `recOutputDir()` — videos → downloads →
  home). No ffmpeg is involved in the default path.
- **MediaRecorder support is optional:** if `pickMime()` returns null (no MediaRecorder/supported
  codec) or `captureStream` throws, `start()` toasts and returns. It never silently misrecords.
- `captureComposite()` in renderer/recording.js reproduces the visible frame bottom-up: bg color →
  video(s) with per-element CSS opacity (`settings.blur` via `ctx.filter`) → dim tint →
  highlight/vignette gradients → `drawImage(vizCanvas)` → title/artist/brand/custom overlays. Videos
  are drawn with `drawVideoCover()`, matching the screen's `object-fit: cover` crop plus the
  `scale(pump)` pump transform. Keep `state.recCap`/`recCapCtx` reused (don't recreate per frame).
- Canvas taint for the capture: `#bg-video`/`#bg-video-2` need `crossorigin="anonymous"` (set in
  index.html) and `media://` needs `corsEnabled: true` in `registerSchemesAsPrivileged` (see the
  protocol gotchas above), otherwise the canvas is tainted and `captureStream`/`toDataURL` throw.
- `R` must stay out of the Ctrl/Cmd flavors (Ctrl+R = browser reload). `r`/`R` fire only when not
  typing in an input (single-letter shortcuts are input-bound; see the recovery note above).

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
- `npm test` runs every offline suite (mp3tags, mediaurl, playlist, playlistManager, color, util,
  trackmeta); single-suite aliases are `npm run test:tags` / `npm run test:mediaurl`.
- If an Electron main/process step hangs, suspect `whenReady()` ordering or a never-settling
  `executeJavaScript` promise before blaming the renderer logic.