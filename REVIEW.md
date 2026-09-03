# Code Review: Synemar

## Critical Security

**1. `media://` protocol reads arbitrary filesystem paths** (`lib/mediaProtocol.js:14-16`)
No path validation or sanitization. Any renderer-controlled URL can read any file the Electron process can access (e.g., `media://file/?path=/etc/shadow`). Combined with `corsEnabled: true` in `main.js:27`, this creates a privilege escalation chain: XSS → arbitrary file read.

**2. `file:readAudio` accepts arbitrary paths** (`main.js:20-21`)
No path allowlist or extension check. A compromised renderer could read `/etc/shadow`, `~/.ssh/id_rsa`, etc. Defense-in-depth would validate that the path resolves to an audio file.

**3. No-sandbox when running as root** (`main.js:20-21`)
`app.commandLine.appendSwitch('no-sandbox')` disables Chromium's sandbox entirely. A renderer exploit achieves full root code execution on shared systems.

---

## High: Functional Bugs

**4. `onMenuAction` collapses three menu channels into one undifferentiated callback** (`preload.js:31-41`)
The three IPC channels (`menu:open-track`, `menu:playlist`, `menu:settings`) all call the same `cb(action)`, but main.js sends no payload (`send(channel)` with no second arg), so `action` is always `undefined`. The renderer cannot distinguish which menu item was clicked through this API.

**5. Null-buffer crashes during scrub** (`renderer/renderer.js:579, 585`)
`audioEngine.state.buffer.duration` is accessed without null checks. If the buffer is cleared while scrubbing (e.g., decode error, `stopPlayback()`), `pointermove` or `pointerup` throws a TypeError. `stopPlayback()` does not call `endScrub()` to clean up state.

**6. Track list not scrollable** (`renderer/styles.css:832`)
`.track-list` has `overflow: hidden` but also has `max-height: 360px` and scrollbar styling. Content beyond 360px is clipped and unreachable — users cannot scroll to all tracks.

**7. `playAudioFile` — `addedAt` could be -1** (`renderer/renderer.js:258-260`)
If `addAudioTrack` receives a falsy path or the path is rejected, `findIndex` returns -1, and `manager.selectAudioAt(-1)` silently fails, leaving the playlist in an unexpected state.

---

## High: Performance

**8. Color picker `apply()` called on every mouse-move** (`renderer/settings.js:226-242`)
During drag on the SL canvas or hue strip, `commit()` → `apply()` performs ~20 DOM updates, 8 CSS property changes, `videoBg.apply()`, and `audioEngine.updateAnalyser()` per event. At 60+ events/sec this causes visible lag.

**9. `drawSL` renders pixel-by-pixel** (`renderer/settings.js:201-210`)
The 240x160 saturation-lightness canvas uses 38,400 individual `fillRect` calls. `ImageData` + `putImageData` would be orders of magnitude faster.

**10. `captureComposite` calls `getComputedStyle` in the recording loop** (`renderer/recording.js:156`)
Inside the 30fps capture timer, `getComputedStyle(el)` forces a full style recalculation and layout per frame. Opacity should be cached.

---

## Medium: Bugs

**11. IPC handlers missing `handleIpc` wrapper** (`main.js:124-132, 136-139`)
`window:setFullscreen`, `window:isFullscreen`, `window:setContentSize`, and `app:iconPng` use raw `ipcMain.handle()` — no error handling. If the window is destroyed between the null check and the call (TOCTOU), the promise rejects with an unhandled error.

**12. `Content-Range` on 200 responses** (`lib/mediaProtocol.js:42-52`)
Line 48 sends `Content-Range` for ALL responses, including non-range (200) ones. Per RFC 7233, `Content-Range` MUST NOT be sent in a 200 response.

**13. `Range: bytes=-0` produces negative Content-Length** (`lib/mediaProtocol.js:31`)
`start = end + 1` makes `length = end - start + 1` negative for an empty suffix range.

**14. Particle alpha inconsistency** (`renderer/renderer.js:356-357`)
`life` starts at 80-180 but `maxLife` is always 180. Particles spawn at 44%-100% opacity instead of always full brightness.

**15. `appliedListKey` collision** (`renderer/videobg.js:32`)
Key is `list.join('|') + '#' + index`. Paths containing `|` can collide (e.g., `["a|b", "c"]` vs `["a", "b|c"]`).

**16. `importJSON` overwrites playlist name** (`renderer/playlistManager.js:136-143`)
`Object.assign(state, incoming)` copies the imported `name` field, silently replacing the current playlist name.

---

## Medium: Performance

**17. `fxOpts()` allocates a new object every frame** (`renderer/renderer.js:83-85, 526`)
Called 60x/sec, creating unnecessary GC pressure. Should be pre-allocated and mutated in place.

**18. `particles.splice(i, 1)` is O(n) per removal** (`renderer/renderer.js:372`)
With up to 760 particles, worst case is ~760 splice operations per frame (O(n^2)). Swap-and-pop would be O(1).

**19. `Int16Array` allocated per audio callback** (`renderer/audio.js:204`)
At 44.1kHz with 1024-sample buffers, `new Int16Array(2048)` is allocated every ~23ms during recording. A pre-allocated reusable buffer would eliminate this GC pressure.

**20. Waveform `points` array allocated per frame** (`renderer/effects.js:332`)
At `curFft=8192`, that's 4096 two-element arrays created and discarded per frame.

**21. FFmpeg stderr concatenation grows without bound** (`lib/recorder.js:106-107`)
Only the last 2 lines are used; all prior text wastes memory. Should use a circular buffer or truncate.

**22. FFmpeg process has no timeout** (`lib/recorder.js:94-116`)
If ffmpeg hangs, `finalize()` never resolves. The only recourse is killing the app.

---

## Medium: Security / Robustness

**23. Recording data from renderer is unbounded** (`main.js:142-145`)
No size limits on `rec:frame` base64 data or `rec:audio` buffers. A compromised renderer could exhaust disk or memory.

**24. 690 MB peak memory for 30-minute recording** (`lib/recorder.js:92`)
`Buffer.concat(audioBufs)` allocates a full copy while originals are still referenced.

**25. No temp dir cleanup on force quit** (`main.js`)
`RecordingSession` has no `app.on('before-quit')` cleanup hook. Force termination orphans temp files.

**26. CSP allows `'unsafe-inline'` for styles** (`renderer/index.html:6`)
`style-src 'self' 'unsafe-inline'` widens attack surface if any XSS vector is found.

---

## Low: Issues

**27. `renderList` destroys and recreates all DOM nodes** (`renderer/playlistUI.js:40-41`)
`innerHTML = ''` + rebuild causes layout thrash for large playlists. Incremental diffing would be better.

**28. `openExternalPath` naive extension extraction** (`renderer/ui.js:54`)
`p.split('.').pop()` on a path with dots in directory names returns the directory name, not the file extension.

**29. `hexToRgb` shadows** — `settings.js:131` returns `[r,g,b]`, `color.js` returns `{r,g,b}`. Same name, different shapes.

**30. Synchronous startup I/O** (`main.js:13, 222-233`)
`fs.readFileSync` and `fs.existsSync`/`fs.statSync` block during startup.

**31. `displayBars`/`peakVals` never shrink** (`renderer/effects.js:125-126`)
Arrays grow when `barCount` increases but never truncate when it decreases. (Negligible memory — 160 entries.)

---

## Accessibility

**32. Dock buttons have no `aria-label`** (`renderer/index.html:46-59`)
Unicode glyphs (arrow right, arrow upper right, circle, gear, music note) have `title` but no `aria-label`. Screen readers won't announce them.

**33. Volume slider has no label** (`renderer/index.html:48`)

**34. Scrubber canvas has no ARIA role or label** (`renderer/index.html:41`)

**35. Overlays lack focus trapping** (`renderer/index.html:82-259`)
Tab navigates out of settings/playlist to background elements.

---

## Test Coverage Gaps

**36. Modules with ZERO test coverage:**
`main.js`, `audio.js`, `effects.js`, `settings.js`, `ui.js`, `recording.js`, `videobg.js`, `playlistUI.js`, `renderer.js`, `lib/mediaProtocol.js`, `preload.js`

**37. `readTags` (the actual production entry point in `mp3tags.js`) is never tested.** Only the internal `parseMP3` is covered.

**38. `mediaurl.test.js` tests a reimplementation, not the real code** — it defines its own `mediaUrl`/`resolvePath` functions rather than importing from `lib/mediaProtocol.js`.

**39. No fixture files.** All binary data is constructed inline. A real small MP3 with tags would increase confidence.

**40. Three test files (`mp3tags`, `playlist`, `util`, `color`) have no exit code handling** — crash with uncaught assertion errors instead of a clean summary.

---

## Summary

| Category | Count |
|---|---|
| Critical security | 3 |
| High bugs / perf | 6 |
| Medium (all) | 16 |
| Low / accessibility / tests | 19 |

### Priority Fix Order

1. **Path validation on `media://` and `file:readAudio`** (issues 1-2)
2. **Null-buffer scrub crash** (issue 5)
3. **Track list scrollability** (issue 6)
4. **Color picker performance** (issues 8-9)
5. **IPC error handling consistency** (issue 11)
