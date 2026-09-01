(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PlaylistUI = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function create(opts) {
    const manager = opts.manager;
    const toast = opts.toast;
    const audioExts = opts.audioExts;
    const videoExts = opts.videoExts;
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => Array.from(document.querySelectorAll(s));
    const overlayEl = $('#playlist-overlay');
    const audioListEl = $('#audio-track-list');
    const videoListEl = $('#video-track-list');
    const nameInput = $('#playlist-name-input');
    let dragIndex = null;
    let dragKind = null;

    function open() { overlayEl.classList.remove('hidden'); render(); }
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

    function renderList(kind) {
      const container = listElFor(kind);
      container.innerHTML = '';
      const tracks = kind === 'audio' ? manager.state.audioTracks : manager.state.videoTracks;
      const currentIndex = kind === 'audio' ? manager.state.currentAudioIndex : manager.state.currentVideoIndex;
      tracks.forEach((track, index) => {
        container.appendChild(buildRow(track, index, currentIndex === index, kind));
      });
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

      const remove = document.createElement('button');
      remove.className = 'track-remove';
      remove.textContent = '\u2715';
      remove.title = 'Remove';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        if (kind === 'audio') manager.removeAudioAt(index);
        else manager.removeVideoAt(index);
        render();
        toast(kind === 'audio' ? 'Track removed' : 'Video removed');
      });

      row.append(drag, info, remove);
      row.addEventListener('click', () => {
        if (kind === 'audio') {
          manager.selectAudioAt(index);
          if (opts.onSelectAudio) opts.onSelectAudio(track);
        } else {
          manager.selectVideoAt(index);
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
            const ext = (file.name.split('.').pop() || '').toLowerCase();
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

    function isMediaFile(file) {
      if (!file) return false;
      const name = file.name || '';
      const ext = (name.split('.').pop() || '').toLowerCase();
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

      nameInput.addEventListener('change', () => {
        manager.setName(nameInput.value);
      });
    }

    return { init, open, close, isOpen, render, renderList };
  }

  return { create };
});
