(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util'));
  } else {
    root.PlaylistUI = factory(root.Util);
  }
})(typeof self !== 'undefined' ? self : this, function (Util) {
  function trackMatches(track, queryText) {
    const q = String(queryText || '').trim().toLowerCase();
    if (!q) return true;
    const name = (track.fileName || '').toLowerCase();
    const path = (track.path || '').toLowerCase();
    return name.includes(q) || path.includes(q);
  }

  function create(opts) {
    const manager = opts.manager;
    const toast = opts.toast;
    const audioExts = opts.audioExts;
    const videoExts = opts.videoExts;
    const fmtTime = Util.fmtTime;
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => Array.from(document.querySelectorAll(s));
    const overlayEl = $('#playlist-overlay');
    const audioListEl = $('#audio-track-list');
    const videoListEl = $('#video-track-list');
    const audioFilterEl = $('#audio-filter');
    const videoFilterEl = $('#video-filter');
    const nameInput = $('#playlist-name-input');
    const query = { audio: '', video: '' };
    const durations = Object.create(null);
    let dragIndex = null;
    let dragKind = null;

    async function probeDurations(kind) {
      if (kind !== 'audio' || !opts.probeAudioDuration) return;
      const tracks = manager.state.audioTracks;
      for (const track of tracks) {
        if (track.path in durations) continue;
        let dur = null;
        try {
          dur = await opts.probeAudioDuration(track.path);
        } catch (err) {
          dur = null;
        }
        durations[track.path] = typeof dur === 'number' && isFinite(dur) ? dur : null;
        renderList('audio');
      }
    }

    function open() { overlayEl.classList.remove('hidden'); render(); probeDurations('audio'); }
    function close() {
      if (overlayEl.classList.contains('hidden')) return;
      overlayEl.classList.add('hidden');
    }
    function isOpen() { return !overlayEl.classList.contains('hidden'); }

    function render() {
      renderList('audio');
      renderList('video');
      nameInput.value = manager.state.name;
    }

    function listElFor(kind) {
      return kind === 'audio' ? audioListEl : videoListEl;
    }

    function matchesQuery(track, kind) {
      return trackMatches(track, query[kind]);
    }

    function visibleEntries(kind) {
      const tracks = kind === 'audio' ? manager.state.audioTracks : manager.state.videoTracks;
      return tracks.map((track, index) => ({ track, index })).filter(({ track }) => matchesQuery(track, kind));
    }

    function renderList(kind) {
      const container = listElFor(kind);
      const currentIndex = kind === 'audio' ? manager.state.currentAudioIndex : manager.state.currentVideoIndex;
      const entries = visibleEntries(kind);
      const scrollTop = container.scrollTop;
      const rows = Array.from(container.children);
      const hasRows = rows.length > 0;
      for (let i = 0; i < entries.length; i++) {
        const { track, index } = entries[i];
        const row = rows[i] || container.appendChild(buildRow(track, index, index === currentIndex, kind));
        updateRow(row, track, index, index === currentIndex, kind);
      }
      for (let i = rows.length - 1; i >= entries.length; i--) container.removeChild(rows[i]);
      if (hasRows && container.scrollTop !== scrollTop) container.scrollTop = scrollTop;
    }

    function updateRow(row, track, index, isCurrent, kind) {
      row.dataset.index = index;
      row.className = 'track-row' + (isCurrent ? ' playing' : '') + ' playable';
      const name = row.querySelector('.track-name');
      const path = row.querySelector('.track-path');
      const indicator = row.querySelector('.track-indicator');
      const duration = row.querySelector('.track-duration');
      if (name.textContent !== (track.fileName || track.path)) name.textContent = track.fileName || track.path;
      if (path.textContent !== track.path) path.textContent = track.path;
      if (indicator) indicator.style.display = isCurrent ? '' : 'none';
      if (duration) {
        const cached = durations[track.path];
        const text = typeof cached === 'number' ? fmtTime(cached) : '';
        if (duration.textContent !== text) duration.textContent = text;
      }
    }

    function buildRemoveButton(kind) {
      const remove = document.createElement('button');
      remove.className = 'track-remove';
      remove.textContent = '\u2715';
      remove.title = 'Remove';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = e.target.closest('.track-row');
        if (!row) return;
        const index = Number(row.dataset.index);
        if (kind === 'audio') manager.removeAudioAt(index);
        else manager.removeVideoAt(index);
        render();
        toast(kind === 'audio' ? 'Track removed' : 'Video removed');
      });
      return remove;
    }

    function buildRow(track, index, isCurrent, kind) {
      const row = document.createElement('div');
      row.className = 'track-row' + (isCurrent ? ' playing' : '') + ' playable';
      row.dataset.index = index;
      row.dataset.kind = kind;

      const drag = document.createElement('span');
      drag.className = 'track-drag';
      drag.textContent = '\u2630';
      drag.title = 'Drag to reorder';
      drag.draggable = true;

      const info = document.createElement('div');
      info.className = 'track-info';

      const name = document.createElement('span');
      name.className = 'track-name';
      name.textContent = track.fileName || track.path;

      const path = document.createElement('span');
      path.className = 'track-path';
      path.textContent = track.path;
      path.title = track.path;

      info.append(name, path);

      const remove = buildRemoveButton(kind);

      const indicator = document.createElement('span');
      indicator.className = 'track-indicator';
      indicator.textContent = '\u266B';
      indicator.title = 'Now playing';
      indicator.style.display = isCurrent ? '' : 'none';

      row.append(drag, indicator, info, remove);
      if (kind === 'audio') {
        const duration = document.createElement('span');
        duration.className = 'track-duration';
        row.insertBefore(duration, remove);
      }
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const idx = Number(row.dataset.index);
        if (kind === 'audio') {
          manager.selectAudioAt(idx);
          if (opts.onSelectAudio) opts.onSelectAudio(track);
        } else {
          manager.selectVideoAt(idx);
          if (opts.onSelectVideo) opts.onSelectVideo(track);
        }
        render();
      });
      return row;
    }

    function setDragHandlers(container, kind) {
      container.addEventListener('dragstart', (e) => {
        const row = e.target.closest('.track-row');
        if (!row) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.index);
        dragIndex = Number(row.dataset.index);
        dragKind = kind;
        row.classList.add('dragging');
      });
      container.addEventListener('dragend', () => {
        dragIndex = null;
        dragKind = null;
        container.classList.remove('drag-over');
        $$('.track-row.dragging').forEach((el) => el.classList.remove('dragging'));
      });
      container.addEventListener('dragover', (e) => {
        if (dragKind !== kind) {
          const handled = handleExternalDragOver(container, e);
          if (handled) e.preventDefault();
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        container.classList.add('drag-over');
      });
      container.addEventListener('dragleave', (e) => {
        if (!container.contains(e.relatedTarget)) container.classList.remove('drag-over');
      });
      container.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        container.classList.remove('drag-over');
        if (dragKind === kind) {
          const target = nearestRowIndex(e.target);
          if (target !== null && dragIndex !== null && dragIndex !== target) {
            manager.moveTrack(kind === 'audio' ? 'audioTracks' : 'videoTracks', dragIndex, target);
            render();
          }
          dragIndex = null;
          dragKind = null;
          return;
        }
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
        if (files.length) {
          let audioAdded = 0;
          let videoAdded = 0;
          files.forEach((file) => {
            const filePath = window.api && window.api.getPathForFile ? window.api.getPathForFile(file) : '';
            if (!filePath) return;
            const ext = extOf(file.name);
            if (audioExts.includes(ext)) { manager.addAudioTrack(filePath); audioAdded += 1; }
            else if (videoExts.includes(ext)) { manager.addVideoTrack(filePath); videoAdded += 1; }
          });
          if (audioAdded || videoAdded) {
            render();
            const total = audioAdded + videoAdded;
            const base = audioAdded ? 'Track' : 'Video';
            toast((base + (total === 1 ? ' added' : 's added')));
          }
        }
      });
    }

    function handleExternalDragOver(container, e) {
      const hasFiles = e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files');
      const ok = hasFiles && Array.from((e.dataTransfer.files) || []).some(isMediaFile);
      container.classList.toggle('drag-over', ok);
      return ok;
    }

    function extOf(name) {
      const dot = name.lastIndexOf('.');
      return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    }

    function isMediaFile(file) {
      if (!file) return false;
      const ext = extOf(file.name || '');
      return audioExts.includes(ext) || videoExts.includes(ext);
    }

    function nearestRowIndex(target) {
      const row = target.closest('.track-row');
      if (!row) return dragIndex;
      return Number(row.dataset.index);
    }

    function addFiles(kind) {
      (async () => {
        const paths = kind === 'audio' ? await window.api.selectMultipleAudio() : await window.api.selectMultipleVideo();
        if (!paths || !paths.length) return;
        paths.forEach((p) => {
          if (kind === 'audio') manager.addAudioTrack(p);
          else manager.addVideoTrack(p);
        });
        render();
        if (kind === 'audio') probeDurations('audio');
        toast(paths.length === 1 ? (kind === 'audio' ? 'Track added' : 'Video added') : (kind === 'audio' ? 'Tracks added' : 'Videos added'));
      })();
    }

    async function exportPlaylist() {
      const json = manager.exportJSON();
      const err = await window.api.savePlaylistFile(json);
      if (err) toast(err);
      else toast('Playlist exported');
    }

    async function importPlaylist() {
      const res = await window.api.openPlaylistFile();
      if (!res) return;
      if (res.error) { toast(res.error); return; }
      const result = manager.importJSON(res);
      if (!result.ok) { toast(result.error); return; }
      render();
      probeDurations('audio');
      if (opts.onImport) opts.onImport();
      toast('Playlist imported');
    }

    function init() {
      $('#btn-close-playlist').addEventListener('click', close);
      overlayEl.addEventListener('click', (e) => {
        if (e.target === overlayEl) close();
      });
      $('#btn-playlist').addEventListener('click', () => { isOpen() ? close() : open(); });
      $('#btn-pick-vid').addEventListener('click', () => open());
      $('#btn-add-audio').addEventListener('click', () => addFiles('audio'));
      $('#btn-add-video').addEventListener('click', () => addFiles('video'));
      $('#btn-export-playlist').addEventListener('click', exportPlaylist);
      $('#btn-import-playlist').addEventListener('click', importPlaylist);
      $('#btn-clear-audio').addEventListener('click', () => {
        manager.clearAudioTracks();
        render();
        toast('Audio cleared');
      });
      $('#btn-clear-video').addEventListener('click', () => {
        manager.clearVideoTracks();
        render();
        toast('Video cleared');
      });
      setDragHandlers(audioListEl, 'audio');
      setDragHandlers(videoListEl, 'video');

      audioFilterEl.addEventListener('input', () => {
        query.audio = audioFilterEl.value;
        renderList('audio');
      });
      videoFilterEl.addEventListener('input', () => {
        query.video = videoFilterEl.value;
        renderList('video');
      });

      nameInput.addEventListener('change', () => {
        manager.setName(nameInput.value);
      });
    }

    return { init, open, close, isOpen, render, renderList, probeDurations };
  }

  return { create, trackMatches };
});
