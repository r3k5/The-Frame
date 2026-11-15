// Applies daylight transitions and weather conditions to the Woodland scene.
(function (root) {
  'use strict';

  var daytimeStart = 7, nighttimeStart = 19;

  function daylightAt(now) {
    var hours = now.getHours();
    return hours >= daytimeStart && hours < nighttimeStart ? 'day' : 'night';
  }

  // Request only the active TV backdrop before the browser reaches the scene markup.
  var startupStage = document.getElementById('stage');
  var native = root.FramePlatform.native;
  var selectedTheme = root.FramePreferences.load(native).themeMode;
  var startupTheme = selectedTheme === 'auto' ? daylightAt(new Date()) : selectedTheme;
  startupStage.dataset.theme = startupTheme;
  if (native) {
    startupStage.classList.add('native-tv');
    var preload = document.createElement('link');
    preload.rel = 'preload';
    preload.as = 'image';
    preload.href = startupTheme === 'day' ? 'assets/woodland-day-tv.png' : 'assets/woodland-tv.png';
    document.head.appendChild(preload);
  }

  // Fit the fixed-size stage before its first paint and whenever the viewport changes.
  function resizeStage() {
    var scale = Math.min(root.innerWidth / 1920, root.innerHeight / 1080);
    startupStage.style.transform = 'scale(' + scale + ')';
    startupStage.style.left = (root.innerWidth - 1920 * scale) / 2 + 'px';
    startupStage.style.top = (root.innerHeight - 1080 * scale) / 2 + 'px';
  }
  resizeStage();
  root.addEventListener('resize', resizeStage);

  // Decode the active backdrop and weather textures before uncovering the first scene.
  function ready() {
    var assets = [
      ['.landscape'], ['.woodland-transition'], ['.woodland-clouds', '::before'],
      ['.woodland-precipitation'], ['.woodland-snow-cover'],
    ];
    return Promise.all(assets.map(function (asset) {
      var layer = startupStage.querySelector(asset[0]);
      var style = root.getComputedStyle(layer);
      if (style.display === 'none') return;
      if (asset[1]) style = root.getComputedStyle(layer, asset[1]);
      var source = /^url\(["']?(.*?)["']?\)$/.exec(style.backgroundImage);
      if (!source) return;
      return new Promise(function (resolve) {
        var image = new Image();
        image.onerror = resolve;
        image.onload = function () {
          if (image.decode) image.decode().then(resolve, resolve);
          else resolve();
        };
        image.src = source[1];
      });
    }));
  }

  function create(stage, settings) {
    var weatherService = root.FrameWeather;
    var remote = root.FrameRemoteFocus;
    var el = root.FrameUI.element;
    var weatherIcon = document.getElementById('weather-icon');
    var transitionDuration = 10 * 60 * 1000, transitionStart, themeTimer, themeDeadline = 0;
    var sceneReviewInterval = 15000, sceneReviewIndex = -1, sceneReviewTimer;
    // Step through each weather condition in both themes, with and without wind.
    var reviewScenes = [];
    [false, true].forEach(function (windy) {
      [0, 2, 3, 45, 63, 95, 73].forEach(function (code) {
        ['day', 'night'].forEach(function (theme) { reviewScenes.push({ code: code, theme: theme, windy: windy }); });
      });
    });

    // Complete the fades at 7 a.m. and 7 p.m. on the TV's clock.
    function applyTheme(now) {
      var review = reviewScenes[sceneReviewIndex];
      var time = now.getTime(), selectedMode = settings.themeMode();
      var automatic = !review && selectedMode === 'auto';
      var dawnEnd = new Date(time).setHours(daytimeStart, 0, 0, 0);
      var duskEnd = new Date(time).setHours(nighttimeStart, 0, 0, 0);
      var dawnStart = dawnEnd - transitionDuration, duskStart = duskEnd - transitionDuration;
      var daylight = daylightAt(now);
      var mode = review ? review.theme : automatic ? daylight : selectedMode;
      if (stage.dataset.theme !== mode) stage.dataset.theme = mode;
      var iconLight = review ? review.theme : daylight;
      if (weatherIcon.dataset.light !== iconLight) weatherIcon.dataset.light = iconLight;
      var transition = time >= dawnStart && time < dawnEnd ? 'dawn' : time >= duskStart && time < duskEnd ? 'dusk' : '';
      if (automatic && transition && settings.canTransition() && !document.hidden) {
        var start = transition === 'dawn' ? dawnStart : duskStart;
        if (stage.dataset.transition !== transition || transitionStart !== start) {
          // Re-start the fade if the TV clock changes its time window.
          if (stage.dataset.transition === transition) {
            delete stage.dataset.transition;
            void stage.offsetWidth;
          }
          stage.style.setProperty('--transition-offset', (start - time) + 'ms');
          stage.dataset.transition = transition;
          transitionStart = start;
        }
      } else {
        delete stage.dataset.transition;
      }
      var next = automatic && [dawnStart, dawnEnd, duskStart, duskEnd].find(function (boundary) { return boundary > time; });
      if (themeDeadline !== next) {
        clearTimeout(themeTimer);
        themeDeadline = next;
        if (next) themeTimer = setTimeout(function () { applyTheme(new Date()); }, next - time);
      }
    }

    function renderWeather() {
      applyTheme(new Date());
      var weather = weatherService.state, data = weather.data;
      var review = reviewScenes[sceneReviewIndex];
      var conditions = weatherService.conditions(review ? review.code : data && data.code);
      weatherIcon.dataset.condition = conditions.icon;
      weatherIcon.toggleAttribute('hidden', !conditions.icon);
      var windy = review ? review.windy : data && (data.windSpeed >= 20 || data.windGust >= 30);
      var weatherLabel = conditions.label + (windy ? ' · Windy' : '');
      var sceneWeather = conditions.icon || 'clear';
      if (stage.dataset.weather !== sceneWeather) {
        stage.dataset.weather = sceneWeather;
        stage.dataset.sky = ['clear', 'partly'].indexOf(sceneWeather) >= 0 ? 'open' : 'overcast';
      }
      stage.toggleAttribute('data-windy', Boolean(windy));
      stage.toggleAttribute('data-hide-night-wildlife', Boolean(windy) || sceneWeather === 'rain' || sceneWeather === 'storm');
      if (review) {
        document.getElementById('weather-place').textContent = 'Scene review · ' + (sceneReviewIndex + 1) + ' of ' + reviewScenes.length;
        document.getElementById('weather-value').textContent = (review.theme === 'day' ? 'Day' : 'Night') + ' · ' + weatherLabel;
        remote.invalidate();
        return;
      }
      document.getElementById('weather-place').textContent = weather.location.label;
      document.getElementById('weather-value').textContent = data ? Math.round(data.temperature) + '°F · ' + weatherLabel : weather.error ? 'Weather unavailable' : 'Loading weather…';
      var details = document.getElementById('weather-details');
      if (details) {
        details.textContent = '';
        if (data) {
          details.appendChild(el('div', 'weather-large', Math.round(data.temperature) + '°F'));
          details.appendChild(el('p', '', weatherLabel));
          if (Number.isFinite(data.high) && Number.isFinite(data.low)) details.appendChild(el('p', '', 'High ' + Math.round(data.high) + '° · Low ' + Math.round(data.low) + '°'));
          details.appendChild(el('p', '', 'Model update · ' + new Date(data.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
        } else details.appendChild(el('p', '', weather.error ? 'Weather is currently unavailable.' : 'Loading local weather…'));
        if (weather.error) details.appendChild(el('p', '', weather.error));
      }
    }
    // Start the temporary scene sequence without changing the saved display mode.
    function startReview() {
      sceneReviewIndex = 0;
      stage.setAttribute('data-scene-review', '');
      var end = document.getElementById('end-scene-review');
      end.hidden = false;
      renderWeather();
      remote.focus(end);
      sceneReviewTimer = setInterval(function () {
        if (sceneReviewIndex + 1 === reviewScenes.length) stopReview();
        else { sceneReviewIndex++; renderWeather(); }
      }, sceneReviewInterval);
    }
    // Restore live weather after review and report whether a review was active.
    function stopReview() {
      if (sceneReviewIndex < 0) return false;
      clearInterval(sceneReviewTimer);
      sceneReviewIndex = -1;
      stage.removeAttribute('data-scene-review');
      var end = document.getElementById('end-scene-review');
      if (document.activeElement === end) remote.focus(document.getElementById('settings'));
      end.hidden = true;
      renderWeather();
      remote.invalidate();
      return true;
    }

    return {
      applyTheme: applyTheme,
      renderWeather: renderWeather,
      startReview: startReview,
      stopReview: stopReview,
    };
  }

  root.FrameWoodlandDisplay = { create: create, ready: ready };
}(window));
