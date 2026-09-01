# Playlist Rework Plan

## Goal
Create a combined music + video playlist system with a dedicated overlay panel, replacing the current single-track audio and settings-embedded video picker approach.

## Current State
- Audio: single track only, no playlist concept (`audio.js`)
- Video: up to 5 background videos managed in settings panel (`videobg.js`)
- No JSON export/import for playlists
- Last track auto-restore stores only one audio file path

## Target State
- Left panel: audio tracks (add, remove, reorder, auto-advance)
- Right panel: video tracks (add, remove, reorder, loop)
- Both loops independently (audio auto-plays next, video crossfades independently)
- Export/import combined playlists as JSON
- Restore full playlist on app start

---

## JSON Playlist Format

```json
{
  "name": "My Playlist",
  "audioTracks": [
    { "path": "/abs/path/song1.mp3", "fileName": "song1.mp3" },
    { "path": "/abs/path/song2.mp4", "fileName": "song2.mp3" }
  ],
  "videoTracks": [
    { "path": "/abs/path/video1.mp4", "fileName": "video1.mp4" }
  ],
  "currentAudioIndex": 0,
  "currentVideoIndex": 0
}
```

---

## Implementation Steps

### Step 1: New HTML — Playlist Overlay (`renderer/index.html`)

Add `#playlist-overlay.overlay.hidden` after the settings overlay. Structure:

```
#playlist-overlay.overlay.hidden
  .playlist-panel.glass
    header
      h3 "Playlist"
      #btn-close-playlist (X button)
    .playlist-columns
      .playlist-col-left
        h4 "Audio Tracks"
        #audio-track-list (scrollable list of rows)
        #btn-add-audio (+ button)
      .playlist-col-right
        h4 "Video Tracks"
        #video-track-list (scrollable list of rows)
        #btn-add-video (+ button)
    footer
      #btn-export-playlist (Export JSON)
      #btn-import-playlist (Import JSON — hidden file input, .json accept)
```

Each track row:
```
.track-row
  .track-drag (⋮ handle)
  .track-info
    .track-name (filename, truncated)
    .track-path (dimmed, full path, truncated)
  .track-remove (× button)
```

Currently playing track gets `.playing` class on its row.

### Step 2: CSS — Playlist Overlay Styles (`renderer/styles.css`)

- `.playlist-panel`: wider than settings (min 700px, or 80vw), same glassmorphism + slide-in pattern
- `.playlist-columns`: `display: grid; grid-template-columns: 1fr 1fr; gap: 24px`
- `.track-row`: flex row, padding, border-bottom, hover highlight, `.playing` accent glow
- `.track-drag`: cursor: grab, dim color, reorder via native HTML5 drag
- `.track-name`: single-line truncate (`text-overflow: ellipsis`)
- `.track-remove`: ghost button, × symbol
- `#btn-add-audio`, `#btn-add-video`: ghost.primary buttons at bottom of each column
- Footer: flex row with export/import buttons

### Step 3: New Module — `renderer/playlistManager.js`

Core playlist state and logic, exported as `window.PlaylistManager`.

**State:**
```js
{
  name: 'Untitled',
  audioTracks: [],   // [{ path, fileName }]
  videoTracks: [],   // [{ path, fileName }]
  currentAudioIndex: 0,
  currentVideoIndex: 0
}
```

**Key functions:**
- `addAudioTrack(path)` — push to audioTracks, save
- `addVideoTrack(path)` — push to videoTracks, save
- `removeAudioAt(i)` — splice, adjust currentAudioIndex, save
- `removeVideoAt(i)` — splice, adjust currentVideoIndex, save
- `moveAudio(from, to)` — reorder, save
- `moveVideo(from, to)` — reorder, save
- `nextAudio()` — increment currentAudioIndex (wrap), return track or null
- `nextVideo()` — increment currentVideoIndex (wrap), return track or null
- `currentAudio()` — return current audioTrack or null
- `currentVideo()` — return current videoTrack or null
- `exportJSON()` — return JSON string of full playlist state
- `importJSON(jsonString)` — parse, validate, replace state, save, notify listeners
- `save()` — persist to localStorage key `neoneq.playlist`
- `load()` — load from localStorage, migrate legacy single-track data
- `clear()` — reset to empty state

**Event callbacks:**
- `onAudioChanged(track)` — called when current audio track changes (renderer hooks this to load new audio)
- `onVideoChanged(track)` — called when current video track changes (renderer hooks this to update video bg)
- `onPlaylistLoaded()` — called when playlist loads from storage (renderer hooks this to refresh UI)

### Step 4: New Module — `renderer/playlistUI.js`

Handles the playlist overlay DOM interactions.

**Key functions:**
- `init(deps)` — cache DOM refs, wire button listeners, set up drag handlers
- `renderAudioList()` — rebuild `#audio-track-list` from PlaylistManager state
- `renderVideoList()` — rebuild `#video-track-list` from PlaylistManager state
- `open()` / `close()` — toggle `hidden` class on `#playlist-overlay`
- `updatePlayingHighlight()` — update `.playing` class on current track rows
- `setupDrag(listEl, type)` — HTML5 drag & drop for reorder (dragstart/dragover/drop)
- `handleFileDrop(type, files)` — accept dropped files, add to playlist

**Drag & drop from desktop:**
- Audio files dropped onto left column → `PlaylistManager.addAudioTrack(path)`
- Video files dropped onto right column → `PlaylistManager.addVideoTrack(path)`
- Both columns also accept drops from the existing global drag handler

### Step 5: Modify `renderer/audio.js` — Playlist Auto-Advance

Add to AudioEngine:
- `onEndedCb` changes: when track ends, call `PlaylistManager.nextAudio()`, if track returned, load and play it. If playlist empty, stop.
- `loadTrack(path, fileName)` — new function (extracted from current load logic) that loads an audio file by path
- Expose `loadFromPlaylist()` — called by PlaylistManager callback when audio changes

### Step 6: Modify `renderer/videobg.js` — Remove Video Pickers

- Remove `renderVideoPickers()`, `addVideoPicker()`, `pickNextVideoSlot()`, `chooseVideoAt()` and all the picker DOM rendering
- Remove `settings.bgVideos` from settings entirely
- Keep `apply()` but simplify: it now reads from PlaylistManager's video tracks
- Keep `hasVideos()`, `videoList()` — now sourced from PlaylistManager instead of settings
- `addPath()` routes through PlaylistManager.addVideoTrack()
- The crossfade logic in `playlist.js` stays unchanged — it still receives a video list

### Step 7: Modify `renderer/settings.js` — Remove Video Section

- Remove the "Background video" picker section from the settings panel HTML
- Remove `bgVideos` from `DEFAULT_SETTINGS`
- Remove migration code for `bgVideo` → `bgVideos` in `loadSettings()`
- Keep bgColor, dim, blur settings (they still affect video rendering)

### Step 8: Modify `renderer/ui.js` — Playlist Overlay Wiring

- Add `const playlistOverlayEl = $('#playlist-overlay')`
- Add `openPlaylist()` / `closePlaylist()` functions
- Wire `#btn-playlist` click → `openPlaylist()`
- Wire `#btn-close-playlist` click → `closePlaylist()`
- Wire backdrop click → `closePlaylist()`
- Export open/close functions

### Step 9: Modify `renderer/renderer.js` — Orchestration

- Import PlaylistManager and PlaylistUI at top of IIFE
- Call `PlaylistManager.load()` on startup
- Wire callbacks:
  - `PlaylistManager.onAudioChanged = (track) => audioEngine.loadFromPlaylist(track)`
  - `PlaylistManager.onVideoChanged = (track) => videoBg.apply()` (re-reads from PlaylistManager)
- Replace `restoreAll()` single-track restore with full playlist restore:
  - Load playlist from storage
  - If playlist has tracks, load current audio + start current video
  - Otherwise fall back to legacy `neoneq.lastTrack` migration
- Add keyboard shortcut: `Ctrl+P` or `L` for playlist toggle
- Add to render loop: check if audio ended → trigger auto-advance
- Add playlist button to dock (`#btn-playlist`)
- Handle dropped files: audio → `PlaylistManager.addAudioTrack()`, video → `PlaylistManager.addVideoTrack()`

### Step 10: Modify `renderer/index.html` — Dock Button + Remove Video Pickers

- Add `#btn-playlist` button in `.cluster.right` of dock (between rec and settings, icon: ☰ or ≡)
- Remove `#vid-pickers` and `#btn-pick-vid` from settings panel
- Add hidden `<input type="file" id="import-playlist-input" accept=".json">` for import

### Step 11: Modify `preload.js` — Add Playlist File Dialog

- Add `selectPlaylistFile()` IPC handler for import (open dialog filtered to .json)
- Keep existing `selectBackgroundVideo()` but it won't be called from settings anymore

### Step 12: Migration & Persistence

**localStorage key:** `neoneq.playlist` stores the full playlist JSON.

**Startup migration:**
1. Check for `neoneq.playlist` → if exists, load it
2. If not, check for legacy `neoneq.lastTrack` → create playlist with that single track
3. If `settings.bgVideos` has videos → migrate them to playlist videoTracks
4. Delete `settings.bgVideos` after migration

**Auto-save:** Every add/remove/reorder/index-change calls `PlaylistManager.save()`.

---

## Files Modified

| File | Change |
|------|--------|
| `renderer/index.html` | Add playlist overlay HTML, dock button, import input; remove video pickers from settings |
| `renderer/styles.css` | Add playlist panel + track row styles |
| `renderer/playlistManager.js` | **NEW** — playlist state, CRUD, export/import, persistence |
| `renderer/playlistUI.js` | **NEW** — overlay DOM interactions, drag reorder, file drop |
| `renderer/audio.js` | Add `loadFromPlaylist()`, modify `onEndedCb` for auto-advance |
| `renderer/videobg.js` | Remove video picker UI, source tracks from PlaylistManager |
| `renderer/settings.js` | Remove bgVideos from defaults/migration, remove picker section wiring |
| `renderer/ui.js` | Add playlist overlay open/close functions |
| `renderer/renderer.js` | Wire PlaylistManager, restore full playlist, keyboard shortcut, dock button |
| `preload.js` | Add `selectPlaylistFile()` IPC |
| `main.js` | Add `selectPlaylistFile` IPC handler for JSON import dialog |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+P` | Toggle playlist overlay |
| `L` | Toggle playlist overlay (when not in input) |
| `Escape` | Close playlist overlay (if open) |

---

## Verification

1. `npm run syntax-check` — all JS files pass ✅
2. `npm test` — all offline unit tests pass (playlistManager: 15 tests) ✅
3. Headless smoke test: renderer boots, globals exist, overlay opens/closes ✅
4. Manual test: open app → open playlist → add audio files → add video files → verify both loop independently
5. Manual test: export playlist → close → import → verify tracks restored
6. Manual test: quit + relaunch → verify full playlist restored
7. Manual test: drag & drop audio/video onto playlist columns
8. Manual test: reorder tracks via drag handle
9. Manual test: remove tracks, verify index stays correct
10. Manual test: settings panel no longer has video pickers, bgColor/dim/blur still work

### Implementation Notes

Step 5 (audio.js changes) was not implemented as planned — auto-advance lives entirely in
`renderer.js` via `advanceAudio()` wired to `audioEngine.onEnded`. `audio.js` only gained a
`clear()` method (called by `renderer.js`'s new `stopPlayback()`). The PlaylistEngine
(`playlist.js`) gained `startPlaylist(list, startIndex)` and a `currentIndex` getter.

Step 8 (ui.js overlay wiring) was implemented in the dedicated `renderer/playlistUI.js` module,
not in `ui.js`. `ui.js` only changed to accept `playAudioFile`/`addVideoFile` callbacks instead
of `loadAudio`/`videoBg.addPath`, and to add `setupDragDrop` (files-only drop veil).

Steps 10-11 (preload/main IPC) added four IPC channels, not one:
`dialog:selectMultipleAudio`, `dialog:selectMultipleVideo`, `playlist:save`, `playlist:open`.
Menu gets a "Playlist" item (`CmdOrCtrl+P`) that sends `menu:playlist`.
