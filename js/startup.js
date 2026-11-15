// Coordinates the first render of Home and dismissal of the startup splash.
(function (root) {
  'use strict';

  var loading = true;
  var startupTimeout = 4500;

  function start(loadApps, focusHome) {
    var stage = document.getElementById('stage');
    var splash = document.getElementById('startup-splash');
    var progress = document.getElementById('startup-progress');
    var deadline = setTimeout(reveal, startupTimeout);

    function reveal() {
      if (!loading) return;
      loading = false;
      clearTimeout(deadline);
      splash.setAttribute('aria-hidden', 'true');
      splash.classList.add('is-dismissing');
      stage.removeAttribute('aria-hidden');
      focusHome();
    }

    // A failed request also settles its part of startup. Home shows the resulting fallback.
    function track(task) {
      function advance() { if (loading) progress.value++; }
      return Promise.resolve(task).then(advance, advance);
    }

    var apps = track(loadApps());
    // Give the splash a frame to paint before opening the Home data connections.
    root.requestAnimationFrame(function () {
      root.requestAnimationFrame(function () {
        var weather = track(root.FrameWeather.refreshWhenVisible());
        var guide = track(root.FrameLiveGuide.refresh());
        var portfolio = root.FramePortfolio.refresh();
        var market = track(apps.then(function () { return root.FrameHomeMarket.ready(portfolio); }));
        var scene = track(weather.then(root.FrameWoodlandDisplay.ready));
        Promise.all([apps, weather, guide, market, scene]).then(reveal);
      });
    });
  }

  root.FrameStartup = { start: start, isLoading: function () { return loading; } };
}(window));
