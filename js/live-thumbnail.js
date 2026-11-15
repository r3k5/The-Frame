// Keeps one muted preview player active on Home.
(function (root) {
  'use strict';
  var source = root.FrameLiveSource;
  var foxChannel = 'USBA300024TN';
  function supports(id) { return !!source(id); }
  var motion = root.matchMedia('(prefers-reduced-motion: reduce)');
  var library, active;
  var retryAfter = Object.create(null);

  // Load the shared HLS library only when a tile requests video.
  function loadPlayer() {
    if (!library) library = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'js/hls.light.min.js';
      script.onload = function () { resolve(root.Hls); };
      script.onerror = function () { library = null; script.remove(); reject(); };
      document.head.appendChild(script);
    });
    return library;
  }

  function stop() {
    if (!active) return;
    var preview = active;
    active = null;
    clearTimeout(preview.timeout);
    if (preview.player) preview.player.destroy();
    if (preview.video) {
      preview.video.pause();
      preview.video.removeAttribute('src');
      preview.video.load();
      preview.video.remove();
    }
    preview.card.classList.remove('is-playing');
  }

  // Give stalled feeds time to recover and ignore failures from a discarded player.
  function failed(preview) {
    if (active !== preview) return;
    retryAfter[preview.card.dataset.liveChannel] = Date.now() + 60000;
    stop();
  }

  function play(preview) {
    var card = preview.card;
    if (!card.isConnected || document.hidden || motion.matches) { stop(); return; }
    var video = document.createElement('video');
    video.className = 'live-thumbnail'; video.defaultMuted = true; video.muted = true; video.autoplay = true;
    video.setAttribute('playsinline', ''); video.setAttribute('aria-hidden', 'true');
    preview.video = video;
    // Apply the same timeout to initial buffering and stalls during playback.
    function waitForPlayback() {
      if (active !== preview) return;
      clearTimeout(preview.timeout);
      preview.timeout = setTimeout(function () { failed(preview); }, 15000);
    }
    waitForPlayback();
    loadPlayer().then(function (Hls) {
      if (active !== preview) return;
      if (!Hls || !Hls.isSupported()) { failed(preview); return; }
      // Use the lowest rendition and a short forward buffer for a small preview tile.
      var player = new Hls({ startLevel: 0, maxBufferLength: 8, backBufferLength: 0, lowLatencyMode: false });
      preview.player = player;
      player.on(Hls.Events.MANIFEST_PARSED, function () {
        if (active !== preview) return;
        player.autoLevelCapping = 0;
        video.play().catch(function () { failed(preview); });
      });
      player.on(Hls.Events.ERROR, function (_, error) { if (error.fatal) failed(preview); });
      video.addEventListener('error', function () { failed(preview); });
      video.addEventListener('ended', function () { failed(preview); });
      video.addEventListener('waiting', waitForPlayback);
      video.addEventListener('playing', function () {
        if (active !== preview) return;
        clearTimeout(preview.timeout);
        card.classList.add('is-playing');
      });
      var visual = card.querySelector('.app-art') || card;
      visual.insertBefore(video, visual.firstChild);
      player.attachMedia(video);
      player.loadSource(source(card.dataset.liveChannel));
    }).catch(function () { failed(preview); });
  }

  // Prefer the focused live tile, then FOX, then another playable listing.
  function start(container, focused) {
    if (document.hidden || motion.matches || container.querySelector('.preview-video')) { stop(); return; }
    var card = (focused || document.activeElement).closest('[data-live-channel]');
    if (!card || !container.contains(card) || !supports(card.dataset.liveChannel)) {
      card = container.querySelector('[data-live-channel="' + foxChannel + '"]');
      if (!card || retryAfter[foxChannel] > Date.now()) {
        card = Array.prototype.find.call(container.querySelectorAll('.live-card[data-live-channel]'), function (tile) {
          return supports(tile.dataset.liveChannel) && !(retryAfter[tile.dataset.liveChannel] > Date.now());
        });
      }
    }
    if (active && active.card === card) return;
    stop();
    if (!card || retryAfter[card.dataset.liveChannel] > Date.now()) return;
    var preview = { card: card };
    active = preview;
    preview.timeout = setTimeout(function () { play(preview); }, 450);
  }

  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); });
  motion.addEventListener('change', function () { if (motion.matches) stop(); });
  root.FrameLiveThumbnail = { start: start, stop: stop, supports: supports, foxChannel: foxChannel };
}(window));
