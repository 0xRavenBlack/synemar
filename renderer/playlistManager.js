(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PlaylistManager = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const STORAGE_KEY = 'neoneq.playlist';

  function emptyTrack() {
    return { path: '', fileName: '' };
  }

  function emptyState() {
    return {
      name: 'Untitled Playlist',
      audioTracks: [],
      videoTracks: [],
      currentAudioIndex: -1,
      currentVideoIndex: -1
    };
  }

  function baseName(p) {
    return p ? String(p).split(/[\\/]/).pop() : '';
  }

  function toTrack(p) {
    return { path: String(p), fileName: baseName(p) };
  }

  function isTrack(t) {
    return !!t && typeof t.path === 'string' && !!t.path;
  }

  function sanitizeTracks(tracks, key) {
    const list = Array.isArray(tracks) ? tracks.filter(isTrack) : [];
    return list.map((t) => ({
      path: t.path,
      fileName: typeof t.fileName === 'string' ? t.fileName : baseName(t.path)
    }));
  }

  function sanitize(state) {
    const base = emptyState();
    const merged = Object.assign(base, state || {});
    merged.audioTracks = sanitizeTracks(merged.audioTracks);
    merged.videoTracks = sanitizeTracks(merged.videoTracks);
    merged.name = typeof merged.name === 'string' && merged.name ? merged.name : base.name;
    merged.currentAudioIndex = clampIndex(merged.currentAudioIndex, merged.audioTracks.length);
    merged.currentVideoIndex = clampIndex(merged.currentVideoIndex, merged.videoTracks.length);
    return merged;
  }

  function clampIndex(index, length) {
    if (!length) return -1;
    if (typeof index !== 'number' || !isFinite(index)) return 0;
    return Math.max(0, Math.min(index, length - 1));
  }

  function create(opts) {
    const storage = (opts && opts.storage) || (typeof localStorage !== 'undefined' ? localStorage : null);
    const state = sanitize(null);
    let listeners = [];
    let onAudioChanged = null;
    let onVideoChanged = null;
    let onListChanged = null;

    function notify(changed) {
      listeners.forEach((fn) => fn(changed));
    }

    function emitList(changed) {
      if (onListChanged) onListChanged(changed);
      notify(changed);
    }

    function emitAudio(prevIndex) {
      const track = state.audioTracks[state.currentAudioIndex] || null;
      if (prevIndex === state.currentAudioIndex) {
        emitList('audio-list');
        return;
      }
      if (onAudioChanged) onAudioChanged(track);
      notify('audio');
    }

    function emitVideo(prevIndex) {
      const track = state.videoTracks[state.currentVideoIndex] || null;
      if (prevIndex === state.currentVideoIndex) {
        emitList('video-list');
        return;
      }
      if (onVideoChanged) onVideoChanged(track);
      notify('video');
    }

    function save() {
      if (!storage) return;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) { /* ignore quota */ }
    }

    function load() {
      if (!storage) return state;
      let loaded = null;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw) loaded = JSON.parse(raw);
      } catch (e) { loaded = null; }
      Object.assign(state, sanitize(loaded));
      return state;
    }

    function exportJSON() {
      return JSON.stringify({
        name: state.name,
        audioTracks: state.audioTracks,
        videoTracks: state.videoTracks,
        currentAudioIndex: state.currentAudioIndex,
        currentVideoIndex: state.currentVideoIndex
      }, null, 2);
    }

    function importJSON(json) {
      let parsed = null;
      try {
        parsed = typeof json === 'string' ? JSON.parse(json) : json;
      } catch (e) {
        return { ok: false, error: 'Not valid JSON' };
      }
      if (!parsed || !Array.isArray(parsed.audioTracks) || !Array.isArray(parsed.videoTracks)) {
        return { ok: false, error: 'Not a Synemar playlist file' };
      }
      const incoming = sanitize(parsed);
      Object.assign(state, incoming);
      save();
      if (onAudioChanged) onAudioChanged(currentAudio());
      if (onVideoChanged) onVideoChanged(currentVideo());
      emitList('import');
      return { ok: true };
    }

    function addAudioTrack(path) {
      if (!path) return null;
      const prevIndex = state.currentAudioIndex;
      state.audioTracks.push(toTrack(path));
      if (state.currentAudioIndex < 0) state.currentAudioIndex = 0;
      save();
      emitAudio(prevIndex);
      return state.audioTracks[state.audioTracks.length - 1];
    }

    function addVideoTrack(path) {
      if (!path) return null;
      const prevIndex = state.currentVideoIndex;
      state.videoTracks.push(toTrack(path));
      if (state.currentVideoIndex < 0) state.currentVideoIndex = 0;
      save();
      emitVideo(prevIndex);
      return state.videoTracks[state.videoTracks.length - 1];
    }

    function removeAudioAt(index) {
      if (index < 0 || index >= state.audioTracks.length) return;
      const prevIndex = state.currentAudioIndex;
      state.audioTracks.splice(index, 1);
      state.currentAudioIndex = reindexAfterRemoval(index, state.currentAudioIndex, state.audioTracks.length);
      save();
      emitAudio(prevIndex);
    }

    function removeVideoAt(index) {
      if (index < 0 || index >= state.videoTracks.length) return;
      const prevIndex = state.currentVideoIndex;
      state.videoTracks.splice(index, 1);
      state.currentVideoIndex = reindexAfterRemoval(index, state.currentVideoIndex, state.videoTracks.length);
      save();
      emitVideo(prevIndex);
    }

    function clearAudioTracks() {
      const prevIndex = state.currentAudioIndex;
      state.audioTracks = [];
      state.currentAudioIndex = -1;
      save();
      emitAudio(prevIndex);
    }

    function clearVideoTracks() {
      const prevIndex = state.currentVideoIndex;
      state.videoTracks = [];
      state.currentVideoIndex = -1;
      save();
      emitVideo(prevIndex);
    }

    function reindexAfterRemoval(removedIndex, currentIndex, lengthAfter) {
      if (currentIndex < 0) return -1;
      if (removedIndex < currentIndex) return currentIndex - 1;
      if (removedIndex === currentIndex) return currentIndex >= lengthAfter ? lengthAfter - 1 : currentIndex;
      return currentIndex;
    }

    function moveTrack(listKey, from, to) {
      const tracks = state[listKey];
      if (!Array.isArray(tracks)) return;
      if (from < 0 || from >= tracks.length) return;
      const target = Math.max(0, Math.min(to, tracks.length - 1));
      if (from === target) return;
      const [moved] = tracks.splice(from, 1);
      tracks.splice(target, 0, moved);
      const currentKey = listKey === 'audioTracks' ? 'currentAudioIndex' : 'currentVideoIndex';
      if (state[currentKey] === from) state[currentKey] = target;
      else if (state[currentKey] > from && state[currentKey] <= target) state[currentKey] -= 1;
      else if (state[currentKey] < from && state[currentKey] >= target) state[currentKey] += 1;
      save();
      emitList(listKey === 'audioTracks' ? 'audio-list' : 'video-list');
    }

    function currentAudio() {
      return state.audioTracks[state.currentAudioIndex] || null;
    }

    function currentVideo() {
      return state.videoTracks[state.currentVideoIndex] || null;
    }

    function nextAudio() {
      if (!state.audioTracks.length) return null;
      const next = (state.currentAudioIndex + 1) % state.audioTracks.length;
      save();
      return selectAudioAt(next);
    }

    function previousAudio() {
      if (!state.audioTracks.length) return null;
      const prev = (state.currentAudioIndex - 1 + state.audioTracks.length) % state.audioTracks.length;
      save();
      return selectAudioAt(prev);
    }

    function selectAudioAt(index) {
      if (index < 0 || index >= state.audioTracks.length) return null;
      const prevIndex = state.currentAudioIndex;
      state.currentAudioIndex = index;
      save();
      if (prevIndex !== index) {
        if (onAudioChanged) onAudioChanged(currentAudio());
        notify('audio');
      } else {
        emitList('audio-list');
      }
      return currentAudio();
    }

    function selectVideoAt(index) {
      if (index < 0 || index >= state.videoTracks.length) return null;
      const prevIndex = state.currentVideoIndex;
      state.currentVideoIndex = index;
      save();
      if (prevIndex !== index) {
        if (onVideoChanged) onVideoChanged(currentVideo());
        notify('video');
      } else {
        emitList('video-list');
      }
      return currentVideo();
    }

    function setName(value) {
      state.name = typeof value === 'string' && value.trim() ? value.trim() : state.name;
      save();
    }

    function migrateFromLegacy() {
      if (!storage) return state;
      let changed = false;

      if (!storage.getItem(STORAGE_KEY)) {
        let lastTrack = null;
        try {
          const raw = storage.getItem('neoneq.lastTrack');
          if (raw) lastTrack = JSON.parse(raw);
        } catch (e) { lastTrack = null; }
        if (lastTrack && lastTrack.path) {
          state.audioTracks = [toTrack(lastTrack.path)];
          state.currentAudioIndex = 0;
          changed = true;
        }

        let legacyVideos = null;
        try {
          const raw = storage.getItem('neoneq.settings');
          if (raw) legacyVideos = JSON.parse(raw).bgVideos;
        } catch (e) { legacyVideos = null; }
        if (Array.isArray(legacyVideos)) {
          const paths = legacyVideos.filter((p) => typeof p === 'string' && p.trim());
          if (paths.length) {
            state.videoTracks = paths.map(toTrack);
            state.currentVideoIndex = 0;
            changed = true;
          }
        }
      }

      try { storage.removeItem('neoneq.lastTrack'); } catch (e) { /* ignore */ }
      if (changed) save();
      return state;
    }

    return {
      state,
      save,
      load,
      migrateFromLegacy,
      exportJSON,
      importJSON,
      addAudioTrack,
      addVideoTrack,
      removeAudioAt,
      removeVideoAt,
      clearAudioTracks,
      clearVideoTracks,
      moveTrack,
      currentAudio,
      currentVideo,
      nextAudio,
      previousAudio,
      selectAudioAt,
      selectVideoAt,
      setName,
      onChange(fn) { listeners.push(fn); },
      set onAudioChanged(fn) { onAudioChanged = fn; },
      set onVideoChanged(fn) { onVideoChanged = fn; },
      set onListChanged(fn) { onListChanged = fn; },
      baseName
    };
  }

  return { create, emptyState, sanitize, STORAGE_KEY, baseName };
});
