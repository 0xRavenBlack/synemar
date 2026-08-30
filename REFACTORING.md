# Refactoring Plan: Clean-Code Heaven

Scope: **structural, test-guarded** refactor. No TypeScript, no bundler, no new
deps, no behavior/output changes. Every phase is small, independently
verifiable, and reversible.

## Global guardrails (apply to every phase)

- After touching any `.js`: `node --check <file> && echo OK`.
- After each phase:
  `node test/mp3tags.test.js && node test/mediaurl.test.js && node test/playlist.test.js`.
- Never break the invariants AGENTS.md warns about:
  - `protocol.handle('media')` must stay inside `app.whenReady()`; `media://file/?path=`
    URL shape; range/206 streaming via `Readable.toWeb`.
  - `crossorigin="anonymous"` + `corsEnabled` (canvas taint); `Buffer.from(buf.buffer,
    buf.byteOffset, buf.byteLength)` for PCM; single `drawParticles`/`drawAurora` call
    per frame; two real `<video>` elements (`#bg-video`, `#bg-video-2`).
  - Recording composite order (bg → videos w/ cover-crop + pump → dim → highlights →
    vignette → viz canvas → overlays) and `recPending`/`recBusy` backpressure, unchanged.
  - Keep all toast strings and UI copy as-is.

## Phase 0 — Verification harness (safety net)

- Add `"test"` and `"syntax-check"` scripts to `package.json`:
  - `test` = run all three test files sequentially, fail if any fails.
  - `syntax-check` = `node --check` over `main.js`, `preload.js`, `mp3tags.js`, `renderer/*.js`.
- Add `test/color.test.js` + `test/util.test.js` for the pure modules extracted in
  Phase 1, so extracted code is covered immediately.
- Update AGENTS.md (Phase 9) to replace the "no `npm test`" statements.

## Phase 1 — Extract pure logic into testable modules (`renderer/`, UMD like `playlist.js`)

Each module: bare UMD wrapper exposing both `window.*` and `module.exports`, loaded
by a `<script>` tag in `index.html` before `renderer.js`.

- **`renderer/color.js`** → `window.ColorUtil`: `hexToRgb`, `rgbToHex`, `rgbToHsl`,
  `hslToRgb`, `shiftHue`, `mixColor`, `rgbaStr`, `parseColor`, `mixColors`, `mixPart`,
  `splitTopLevel`, `parseTextShadows` (today: renderer.js:146–204, 1540–1631).
- **`renderer/util.js`** → `window.Util`: `clamp`, `fmtTime`, `nextPow2`
  (today: renderer.js:129–135).
- `renderer.js` replaces its local copies with the modules. Zero behavior change;
  unit tests lock them down.

## Phase 2 — Extract visual-effect layers → `renderer/effects.js` (`window.Fx`)

- Move: `drawAurora`, `drawBeams`, `drawBandPanel`, `drawSpectrum`, `drawWaveform`,
  `drawRings`, `drawScanline`, `drawVignette`, `drawGlowBackdrop`, `drawIdle`, plus the
  module-level bar state (`displayBars`, `peakVals`).
- Signature: `window.Fx.drawSpectrum(vctx, L, W, H, live, now, opts)` etc., where `opts`
  carries read-only inputs (`settings`, color palette, `pulse`, `dt`, `freqByte`,
  `timeByte`, `curFft`, `lv`) — no global state chasing.
- Extract built-in magic numbers into a `Fx.DEFAULTS` block with meaningful names
  (hue-shift period `220000`, waveform amp factors, panel alphas, etc.).

## Phase 3 — Extract audio/playback engine → `renderer/audio.js` (`window.AudioEngine`)

- Owns: `ensureCtx`, `currentTime`, `stopCurrent`, `spawnSource`, `play`, `pause`,
  `seekTo`, `computePeaks`, `updateAnalyser`, `updateGain`, `wireAudioOut`,
  `startAudioTap`, `detachAudioTap`, and beat detection (`analyzeSpectrum` +
  `energyHist`/`lastKickTs`).
- Small API: `window.AudioEngine.init({ ... }).onEnded(cb)` returning
  `{ play, pause, seekTo, currentTime, ... }`. Renderer.js and recording.js use only
  the API.
- Name the magic numbers: `KICK_MIN_BASS = 0.11`, `KICK_AVG_MULT = 1.28`,
  `KICK_COOLDOWN_MS = 110`, `ENERGY_HIST_SIZE = 48`, `BK_DECAY = 0.3`.
- Keep the recording tap's input→output copy verbatim (the "record mutes all sound" trap).
- The audio slice of `state` becomes `audioEngine.state`; renderer keeps its own
  `state` for UI/recording only.

## Phase 4 — Extract recording pipeline → `renderer/recording.js` (`window.Recorder`)

- Move: `captureComposite`, `drawVideoCover`, `overlayInfo`, `drawOverlayText`,
  `drawBrandOverlay`, `drawCustomOverlay`, `drawOverlayLayers`, `startRecCapture`,
  `stopRecCapture`, `startRecord`, `stopRecord`, `toggleRecord`, `updateRecButton`,
  `onRecError`, and the rec-related `state`. Reuses `ColorUtil`/`AudioEngine`.
- Keep composite order, rec `state`, backpressure, and flush logic
  (`recPending`, `recBusy`) unchanged.
- `renderer.js` shrinks to: settings apply, UI wiring, keyboard, drag & drop,
  load/restore, and the `frame()` loop.

## Phase 5 — Extract video-background glue → `renderer/videobg.js` (`window.VideoBg`)

- Move: `videoList`, `hasVideos`, `playlistChanged`, `applyBgVisual`, all `bgVideos`
  mutators (`addVideoPath`, `chooseVideoAt`, `clearVideoAt`, `removeVideoAt`,
  `addVideoPicker`), `renderVideoPickers`, `baseName`. Uses `PlaylistEngine`.
- **Delete the dead `applyBgVisual` method from `renderer/playlist.js:108`** (confirmed
  unused — renderer.js defines its own local one).
- Keep `createPlaylist`/`mediaUrl`/`stopVideoEl`/`startVideoEl` byte-identical; the
  crossfade tests depend on them.

## Phase 6 — Extract settings + window/UI wiring → `renderer/settings.js`, `renderer/ui.js`

- `settings.js`: `DEFAULT_SETTINGS`, `loadSettings` (incl. the `bgVideo`→`bgVideos`
  migration and dropping `bgImage`/`bgImagePath` keys), `saveSettings`, `applySettings`,
  `bindSetting`, reset/center handlers, `applyAppIcon`.
- `ui.js`: `toast`, `openSettings`/`closeSettings`, `setupDrag` (marquee/customText),
  drag-&-drop (`setupDragDrop`, `openExternalPath`, `handleDropped`), `updateSizeNote`,
  `scheduleCursorHide`.
- `renderer.js` keeps the global `keydown` handler (it orchestrates all modules) but
  delegates each key to the owning module.

## Phase 7 — main.js decomposition into `lib/`

- **`lib/recorder.js`** → `RecordingSession` class encapsulating `recActive`/`recRun`/
  `recAudioBufs`, `abort`, `finalize`, `outputDir`, `stamp`. `rec:*` IPC handlers become
  thin delegates. Dedupes tmp-dir cleanup.
- **`lib/mediaProtocol.js`** → exports `register(session)` (registrar only). **Call site
  stays inside `whenReady()`** — must NOT self-register at import time (the
  "Session can only be received when app is ready" crash). Keep `VIDEO_TYPES`, the
  `?path=` transport, and `Readable.toWeb` streaming untouched. Keep
  `registerSchemesAsPrivileged` at the main.js top level.
- **`lib/trackMeta.js`** → `parseFilenameMeta`, `coverToDataUrl`, `parseTags`,
  `bufferToArrayBuffer`, `buildAudioPayload` (Node-testable).
- **IPC DRY**: `function handleIpc(channel, fn)` wrapper producing the uniform
  `{ ok: true } | { error: msg }` returns, removing per-handler try/catch boilerplate.
- Keep the no-sandbox / autoplay switch lines first in main.js.

## Phase 8 — Dead code, DRY, naming, constants

- Drop renderer's `buildTrackMeta` `' - '` filename fallback — redundant: main already
  falls back via `parseFilenameMeta`, so `meta.title` is always set. Single source of
  truth for filename parsing stays in `lib/trackMeta.js`.
- Replace the ~12 repeated `try { … } catch (e) { /* noop */ }` teardowns
  (renderer.js:340–351, 1440, 1473; playlist.js) with a `trySafe(fn)` helper; same for
  the `rc.letterSpacing` try/catch quartet (renderer.js:1640–1700).
- Rename: `fss`→`fsSync` (main.js:5), clear short locals in `recStamp`/`parseTags`;
  dedupe the `fx` initialization to derive from `DEFAULT_SETTINGS` instead of re-typed
  magic RGBs (renderer.js:206).
- Optional (flagged, not default): single-source file extensions via a `shared/extensions.js`
  UMD used by both main and renderer — only if it doesn't complicate `build.files`.

## Phase 9 — Verification & docs

- Run `npm test`, `npm run syntax-check`, then `npm start` on a real display: load an
  MP3, drag-drop an mp4, play/pause/seek, toggle settings, record a short clip and
  confirm A/V length + playback, verify crossfade.
- `npm run dist:dir` smoke build; confirm packaged files match `build.files`
  (new `renderer/*.js` are already covered by `renderer/**/*`).
- Update AGENTS.md: document `npm test` + `syntax-check`; add a short "Renderer modules"
  section mapping `window.AudioEngine/Fx/Recorder/VideoBg/Settings/UI`; correct the
  "no `npm test`" and architecture notes to match the new layout.

## Non-goals (why)

- No TypeScript, no bundler, no new dependencies (AGENTS hard constraints).
- No CSS rework, no UI redesign, no behavior or output changes.
- No full architectural rewrite: the media/recording/test invariants make it high-risk
  for near-zero user-visible gain; this plan gets the readability win with a checkpoint
  after every phase.