(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./playlist'));
  } else {
    root.VideoBg = factory(root.PlaylistEngine);
  }
})(typeof self !== 'undefined' ? self : this, function (PlaylistEngine) {
  function create(opts) {
    const {
      manager, elements, crossfadeMs, toast
    } = opts;

    const playlist = PlaylistEngine.createPlaylist({ elements, crossfadeMs });
    let appliedListKey = null;

    function videoList() {
      return manager.state.videoTracks.map((t) => t.path);
    }

    function hasVideos() {
      return videoList().length > 0;
    }

    function apply() {
      const list = videoList();
      document.body.classList.toggle('has-vid', list.length > 0);
      if (!list.length) {
        appliedListKey = null;
        playlist.startPlaylist([]);
        return;
      }
      const key = list.join('|') + '#' + manager.state.currentVideoIndex;
      if (key !== appliedListKey) {
        appliedListKey = key;
        playlist.startPlaylist(list, manager.state.currentVideoIndex);
      }
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
      update(now) {
        playlist.update(now);
      }
    };
  }

  return { create };
});
