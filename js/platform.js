// Adapts Tizen app and input controls for the launcher and its browser preview.
(function (root) {
  'use strict';
  // Use Tizen only when its application API is present.
  var native = !!(root.tizen && root.tizen.application);
  var streamforge = { id: 'shortcut.streamforge', name: 'StreamForge', iconPath: 'assets/streamforge.svg' };
  var liveNow = { id: 'shortcut.livenow', name: 'LiveNOW from FOX' };
  var tvPlusId = 'com.samsung.tv.tvPlusDeeplinker';
  var streamforgeUrl = (root.FrameLauncherConfig || {}).streamForgeUrl;
  var websites = { streamforge: streamforgeUrl, livenow: 'https://www.livenowfox.com/live', weather: 'https://open-meteo.com/', artguide: 'https://www.samsung.com/us/support/answer/ANS10005224/', robinhood: 'https://robinhood.com/login/', tradingview: 'https://www.tradingview.com/markets/' };
  // Open HTTPS shortcuts through the TV browser or a new tab in preview.
  function openWeb(key) {
    return new Promise(function (resolve, reject) {
      var url = websites[key];
      if (!url) {
        reject(new Error(key === 'streamforge' ? 'Set a StreamForge URL when packaging the launcher.' : 'Unknown website shortcut.'));
        return;
      }
      try {
        if (!native) { root.open(url, '_blank', 'noopener,noreferrer'); resolve(); }
        else {
          var view = new root.tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', url);
          root.tizen.application.launchAppControl(view, null, resolve, function (e) { fail(reject, e); });
        }
      } catch (e) { fail(reject, e); }
    });
  }
  // Add web shortcuts when their installed equivalents are missing.
  function withStreamForge(apps) {
    if (!apps.some(function (app) { return /^streamforge\b/i.test(app.name); })) apps = [streamforge].concat(apps);
    if (!apps.some(function (app) { return /livenow/i.test(app.name); })) apps.push(liveNow);
    return apps;
  }
  // Browser preview has no access to the TV app list, so use a separate sample catalog.
  var demos = [
    { id: 'preview.netflix', name: 'Netflix' }, { id: 'preview.youtube', name: 'YouTube' },
    { id: 'preview.prime', name: 'Prime Video' }, { id: 'preview.disney', name: 'Disney+' },
    { id: 'preview.hulu', name: 'Hulu' }, { id: 'preview.peacock', name: 'Peacock' },
    { id: 'preview.tvplus', name: 'Samsung TV Plus' },
    { id: 'preview.plex', name: 'Plex' }, { id: 'preview.spotify', name: 'Spotify' },
    { id: 'preview.apple', name: 'Apple TV' }, { id: 'preview.browser', name: 'Internet' }
  ];
  function fail(reject, error) { reject(new Error((error && (error.message || error.name)) || 'TV operation failed.')); }
  root.FramePlatform = {
    native: native,
    locationCapability: function () {
      try { return native && typeof root.tizen.systeminfo.getCapability === 'function' ? root.tizen.systeminfo.getCapability('http://tizen.org/feature/location') : null; }
      catch (e) { return null; }
    },
    openWeb: openWeb,
    apps: function () {
      return new Promise(function (resolve, reject) {
        if (!native) { resolve(withStreamForge(demos.slice())); return; }
        try {
          var ownId = root.tizen.application.getCurrentApplication().appInfo.id;
          root.tizen.application.getAppsInfo(function (apps) {
            // TV Plus may be hidden from the main app list on the target TV.
            var tvPlus = apps.find(function (app) { return app.id === tvPlusId; });
            if (!tvPlus) {
              try { tvPlus = root.tizen.application.getAppInfo(tvPlusId); } catch (e) { /* TV Plus is unavailable on this TV. */ }
              if (tvPlus) apps = apps.concat(tvPlus);
            }
            resolve(withStreamForge(apps.filter(function (app) { return app.id !== ownId && (app.show !== false || app.id === tvPlusId); })
              .map(function (app) { return { id: app.id, name: app.name || app.id, iconPath: app.iconPath || '' }; })
              .sort(function (a, b) { return a.name.localeCompare(b.name); })));
          }, function (e) { fail(reject, e); });
        } catch (e) { fail(reject, e); }
      });
    },
    launch: function (id) {
      return new Promise(function (resolve, reject) {
        if (id === streamforge.id) {
          openWeb('streamforge').then(resolve, reject);
          return;
        }
        if (id === liveNow.id) { openWeb('livenow').then(resolve, reject); return; }
        if (!native) { reject(new Error('Browser preview: app launching is available on the TV.')); return; }
        try {
          var application = root.tizen.application;
          if (typeof application.launch === 'function') {
            application.launch(id, resolve, function (e) { fail(reject, e); });
          } else {
            var control = new root.tizen.ApplicationControl('http://tizen.org/appcontrol/operation/default');
            application.launchAppControl(control, id, resolve, function (e) { fail(reject, e); });
          }
        } catch (e) { fail(reject, e); }
      });
    },
    inputs: function () {
      return new Promise(function (resolve, reject) {
        if (!native) { resolve([{ type: 'HDMI', number: 1 }, { type: 'HDMI', number: 2 }]); return; }
        try {
          root.tizen.systeminfo.getPropertyValue('VIDEOSOURCE', function (result) {
            resolve(result.connected || []);
          }, function (e) { fail(reject, e); });
        } catch (e) { fail(reject, e); }
      });
    },
    selectInput: function (source) {
      return new Promise(function (resolve, reject) {
        if (!native) { reject(new Error('Browser preview: input switching is available on the TV.')); return; }
        try {
          root.tizen.tvwindow.setSource(source, function () {
            try { root.tizen.application.getCurrentApplication().hide(); resolve(); }
            catch (e) { fail(reject, e); }
          }, function (e) { fail(reject, e); });
        } catch (e) { fail(reject, e); }
      });
    },
    exit: function () {
      if (native) root.tizen.application.getCurrentApplication().exit();
    }
  };
}(window));
