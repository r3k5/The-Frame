// Renders app details and handles the optional LiveNOW video embed.
(function (root) {
  'use strict';
  var activeFrame, queued, pendingApp, pane;
  var sourceKey = 'r3k5.frame.livenow.v1';
  // Verified from the official LiveNOW channel on 2026-11-04; live-event IDs can rotate.
  var videoId = '4eHSZgDTFfk';
  try { var saved = localStorage.getItem(sourceKey); if (/^[A-Za-z0-9_-]{11}$/.test(saved || '')) videoId = saved; } catch (e) {}
  // Accept a video ID or a supported YouTube video URL before saving it locally.
  function setSource(value) {
    var id = value.trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
      var url;
      try { url = new URL(id); } catch (e) { throw new Error('Enter a YouTube video URL or video ID.'); }
      if (['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].indexOf(url.hostname) < 0 || url.protocol !== 'https:') throw new Error('Use an HTTPS YouTube video URL.');
      id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.split('/')[2];
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) throw new Error('Use a specific live-video URL, rather than a channel page.');
    try { localStorage.setItem(sourceKey, id); } catch (e) { throw new Error('The preview source could not be saved.'); } videoId = id;
  }
  var node = root.FrameUI.element;
  // Cancel queued updates and remove the iframe so video stops when focus changes.
  function clear() {
    clearTimeout(queued); queued = null; pendingApp = null;
    if (activeFrame) {
      activeFrame.remove();
      activeFrame = null;
      root.dispatchEvent(new Event('framepreviewstop'));
    }
    if (pane && pane.live) pane.play.textContent = 'Play preview';
  }
  function build(container) {
    var kicker = node('div', 'preview-kicker'); container.appendChild(kicker);
    var visual = node('div', 'preview-visual');
    var wordmark = node('div', 'preview-wordmark'); visual.appendChild(wordmark);
    var icon = node('img', 'preview-icon'); icon.alt = ''; icon.hidden = true;
    icon.addEventListener('error', function () { icon.hidden = true; }); visual.appendChild(icon);
    container.appendChild(visual);
    var details = node('div', 'preview-details');
    var description = node('p'); details.appendChild(description);
    var actions = node('div', 'preview-actions');
    var open = node('button', 'text-button'); open.setAttribute('aria-label', 'Open selected app'); actions.appendChild(open);
    var play = node('button', 'text-button secondary', 'Play preview'); play.hidden = true; actions.appendChild(play);
    details.appendChild(actions); container.appendChild(details);
    return { container: container, kicker: kicker, visual: visual, wordmark: wordmark, icon: icon, description: description, open: open, play: play };
  }
  // Reuse the preview pane while replacing the selected app and its actions.
  function show(container, app, launch) {
    clear();
    if (!pane || pane.container !== container) { container.textContent = ''; pane = build(container); }
    container.dataset.app = app.id;
    var live = /livenow/i.test(app.name);
    pane.live = live;
    pane.kicker.textContent = live ? 'Live Channel' : 'App Information';
    pane.wordmark.textContent = app.name;
    var canShowIcon = app.iconPath && (!root.FramePlatform.native || !/^file:|^\//.test(app.iconPath));
    pane.icon.hidden = !canShowIcon;
    if (canShowIcon) pane.icon.src = app.iconPath.charAt(0) === '/' ? 'file://' + app.iconPath : app.iconPath;
    else pane.icon.removeAttribute('src');
    pane.description.textContent = live ? 'Play the muted live preview or open FOX’s live stream.' : 'Open ' + app.name + ' to browse and play.';
    pane.open.textContent = 'Open ' + app.name;
    pane.open.onclick = function () { launch(pendingApp || app); };
    pane.play.hidden = !live;
    pane.play.textContent = 'Play preview';
    pane.play.onclick = function () {
      if (!container.isConnected || document.hidden) return;
      if (activeFrame) { clear(); return; }
      root.FrameLiveThumbnail.stop();
      var frame = node('iframe', 'preview-video'); frame.title = 'LiveNOW from FOX public channel preview'; frame.tabIndex = -1; frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture'); frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups'); frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.src = 'https://www.youtube.com/embed/' + videoId + '?autoplay=1&mute=1&playsinline=1&enablejsapi=1' + (/^https?:$/.test(location.protocol) ? '&origin=' + encodeURIComponent(location.origin) : '');
      activeFrame = frame; pane.visual.appendChild(frame); pane.play.textContent = 'Stop preview';
    };
    root.FrameRemoteFocus.invalidate();
  }
  function highlight(container, app, launch) {
    clearTimeout(queued);
    pendingApp = null;
    if (container.dataset.app === app.id) return;
    if (activeFrame) clear();
    pendingApp = app;
    // Keep rapid remote repeats off the preview rendering path.
    queued = setTimeout(function () { if (container.isConnected && !document.hidden) show(container, app, launch); }, 125);
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) clear(); });
  root.FramePreview = { show: show, highlight: highlight, clear: clear, setSource: setSource, getSource: function () { return 'https://www.youtube.com/watch?v=' + videoId; } };
}(window));
