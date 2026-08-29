# Synemar

A fullscreen Electron music visualizer. Load a track, then watch a Web Audio driven
spectrum + waveform animation react to the beat — with particles, auroras, rings,
scanlines and camera shake. Add up to 5 background videos that play one after
another with a smooth crossfade. Record the result with `R` or the ● button — it
writes an MP4 (h264 + aac) via ffmpeg.

Built for making YouTube music-video content: preset canvas sizes (1080p, 1440p, 4K,
1:1, 9:16) let you record exactly the frame you want.

## Features

- **Beat-driven visuals** — spectrum bars, waveform, bass beams; camera shake, ring
  bursts, particle pulses and aurora sweep on every kick.
- **Particles** — rising dots, hearts, stars, diamonds, triangles, squares and sparkles
  spawn randomly and rotate as they fly with the music.
- **Background video playlist** — embed up to **5** muted videos that play in sequence
  with a ~0.9 s crossfade (single videos loop).
- **Track metadata** — ID3/FLAC tags (or a `Artist - Title` filename fallback) fill in title,
  artist and album via drag & drop or file picker.
- **Full visual customization** — text/accent/spectrum colors, hue shifting, bar count,
  smoothing, dimming, blur, and per-effect toggles.
- **Recording presets** — 1080p / 1440p / 4K / 1:1 / 9:16 window sizes for recording.
- **Recording** — hit `R` or the ● button to record the visualizer + music to an MP4
  (h264 + aac) via ffmpeg.
- **Hideable UI** — press `H` for a clean background; the title is freely draggable.

## Requirements

- Node.js 20+
- npm
- [ffmpeg](https://ffmpeg.org) on the `PATH` (used to encode recordings)
- Linux / macOS / Windows

## Getting started

```bash
npm install
npm start
```

Open a track through the File menu, the **Open** button, or just **drag & drop** an
MP3/WAV/OGG/FLAC/M4A anywhere onto the window. Drop MP4s too — they get added to the
background video playlist.

## Controls

| Key           | Action                      |
| ------------- | --------------------------- |
| `Space`       | Play / pause                |
| `←` / `→`     | Seek −/+ 10 s (`Shift`: 60 s) |
| `M`           | Mute                        |
| `F` / `F11`   | Toggle fullscreen           |
| `R`           | Start / stop recording      |
| `H`           | Hide/show UI                |
| `Ctrl+,` / `Cmd+,` | Settings                |
| `Ctrl+O` / `Cmd+O` | Open track              |
| Double-click  | Toggle fullscreen           |

## Background videos

Open Settings (`Ctrl+,`) → **Background**:

- One video picker is shown by default. Press **+ Add video** to add more — up to 5.
- Each picker has **Choose…** (file dialog), **Clear**, and **✕** (remove the picker).
- Videos play one after another, muted, crossfading between them.
- You can also drag & drop MP4 files onto the window to append them to the playlist.

Persisted per-file-path in browser settings, so they survive restarts and stay small.

## Recording

Press `R` (or the **●** button in the dock) to start, `R` again to stop. The video is
saved as `synemar-rec-<timestamp>.mp4` (h264 + aac) in your videos folder, falling
back to Downloads/home. The recording captures the on-screen composite (background
video, colors, vignette and the visualization itself) plus the audio being played.

Requires [ffmpeg](https://ffmpeg.org) on the `PATH`. During recording the frames are
streamed to a temp file and music audio is captured from the Web Audio graph at the
context's sample rate; on stop they are muxed in one final encode pass, so the output
is exact and glitch-free rather than real-time.

## Settings

- **Background** — video playlist, fallback color, dimming, blur.
- **Colors** — text, accent, viz top/bottom.
- **Visualizer** — bars, smoothing, hue shifting, particle energy, beat shake,
  aurora, particles.
- **Interface** — logo, player controls, title position.
- **Recording canvas** — 1080p / 1440p / 4K / 1:1 / 9:16 presets.

Use **Reset to defaults** to restore the color presets.

## Building

```bash
npm run dist      # installers for the current OS (e.g. AppImage + deb on Linux)
npm run dist:dir  # fast unpacked build, great for smoke tests
```

The app icon is `app.svg` at the repository root. Linux dists ship the SVG itself as the
freedesktop scalable icon; Windows and macOS rasterize it to `.ico`/`.icns` during
`npm run dist` (the first such build downloads the electron-builder icon tool).

## Technology

- **Electron** (main + preload + renderer process)
- **Web Audio API** — decode, analyser nodes, beat detection
- **Canvas 2D** — all drawing, DPI-aware
- **Custom `media://` protocol** — range-request video streaming for backgrounds
- **Hand-rolled ID3v1/v2 tag parser** (`mp3tags.js`) — no heavy tag dependencies

No bundler, no framework — plain JavaScript and HTML/CSS.

## Development

```bash
node test/mp3tags.test.js   # run the tag parser unit tests (alias: npm run test:tags)
```

After touching the renderer or main process JavaScript, `node --check` the files.

## License

[MIT](LICENSE)