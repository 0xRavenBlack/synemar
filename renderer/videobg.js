(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./playlist'));
  } else {
    root.VideoBg = factory(root.PlaylistEngine);
  }
})(typeof self !== 'undefined' ? self : this, function (PlaylistEngine) {
  function create(opts) {
    const {
      settings, maxVideos, elements, crossfadeMs, toast, saveSettings
    } = opts;

    const playlist = PlaylistEngine.createPlaylist({ elements, crossfadeMs });
    let appliedListKey = null;

    function videoList() {
      return (settings.bgVideos || []).map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean);
    }

    function hasVideos() {
      return videoList().length > 0;
    }

    function playlistChanged(list) {
      const key = list.join('|');
      if (list.length && key !== appliedListKey) {
        appliedListKey = key;
        playlist.startPlaylist(list);
      }
    }

    function apply() {
      const list = videoList();
      document.body.classList.toggle('has-vid', list.length > 0);
      if (!list.length) {
        appliedListKey = null;
        playlist.startPlaylist([]);
      } else {
        playlistChanged(list);
      }
    }

    function baseName(p) {
      return p ? String(p).split(/[\\/]/).pop() : '';
    }

    function renderVideoPickers() {
      const c = document.getElementById('vid-pickers');
      c.innerHTML = '';
      settings.bgVideos.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'vid-picker-row';

        const label = document.createElement('label');
        label.textContent = `Video ${i + 1}`;

        const fileEl = document.createElement('span');
        fileEl.className = 'vid-file';
        fileEl.textContent = p ? baseName(p) : '— none —';

        const btns = document.createElement('div');
        btns.className = 'inline-btns';

        const choose = document.createElement('button');
        choose.className = 'ghost small';
        choose.textContent = 'Choose…';
        choose.addEventListener('click', () => chooseVideoAt(i));

        const clear = document.createElement('button');
        clear.className = 'ghost small';
        clear.textContent = 'Clear';
        clear.disabled = !p;
        clear.addEventListener('click', () => clearVideoAt(i));

        const remove = document.createElement('button');
        remove.className = 'ghost small remove-vid';
        remove.textContent = '\u2715';
        remove.title = 'Remove this picker';
        remove.style.display = settings.bgVideos.length > 1 ? '' : 'none';
        remove.addEventListener('click', () => removeVideoAt(i));

        btns.append(choose, clear, remove);
        row.append(label, fileEl, btns);
        c.appendChild(row);
      });
      const addBtn = document.getElementById('btn-vid-add');
      addBtn.style.display = settings.bgVideos.length >= maxVideos ? 'none' : '';
    }

    async function chooseVideoAt(i) {
      const res = await window.api.selectBackgroundVideo();
      if (!res) return;
      if (res.error) { toast(res.error); return; }
      settings.bgVideos[i] = res;
      saveSettings();
      renderVideoPickers();
      apply();
      toast('Video background set');
    }

    function addVideoPath(p) {
      if (!Array.isArray(settings.bgVideos)) settings.bgVideos = [null];
      if (settings.bgVideos.length >= maxVideos) { toast('Maximum of 5 background videos'); return; }
      const idx = settings.bgVideos.findIndex((v) => !v);
      if (idx >= 0) {
        settings.bgVideos[idx] = p;
      } else {
        settings.bgVideos.push(p);
      }
      saveSettings();
      renderVideoPickers();
      apply();
      toast('Video background added');
    }

    function clearVideoAt(i) {
      settings.bgVideos[i] = null;
      saveSettings();
      renderVideoPickers();
      apply();
    }

    function removeVideoAt(i) {
      settings.bgVideos.splice(i, 1);
      if (!settings.bgVideos.length) settings.bgVideos = [null];
      saveSettings();
      renderVideoPickers();
      apply();
    }

    function addVideoPicker() {
      if (settings.bgVideos.length >= maxVideos) {
        toast('Maximum of 5 background videos');
        return;
      }
      settings.bgVideos.push(null);
      renderVideoPickers();
      saveSettings();
    }

    async function pickNextVideoSlot() {
      const list = settings.bgVideos;
      const idx = list.findIndex((p) => !p);
      if (idx >= 0) { await chooseVideoAt(idx); return; }
      if (list.length < maxVideos) {
        list.push(null);
        renderVideoPickers();
        saveSettings();
        await chooseVideoAt(list.length - 1);
        return;
      }
      toast('Maximum of 5 background videos');
    }

    function handleVideoEnded() {
      playlist.handleVideoEnded(videoList());
    }

    elements.forEach((el) => {
      el.addEventListener('error', () => {
        if (hasVideos()) toast('Could not play one of the background videos.');
      });
      el.addEventListener('ended', handleVideoEnded);
    });

    return {
      videoList,
      hasVideos,
      apply,
      addPath: addVideoPath,
      addPicker: addVideoPicker,
      pickNextVideoSlot,
      render: renderVideoPickers
    };
  }

  return { create };
});