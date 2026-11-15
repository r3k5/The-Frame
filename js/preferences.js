// Validates and stores launcher preferences separately for TV and browser use.
(function (root) {
  'use strict';

  var favoriteLimit = 8;
  var defaultSymbols = ['AMEX:SPY', 'NASDAQ:QQQ', 'AMEX:IWM'];
  var symbolPattern = /^[A-Z0-9_]{1,18}:[A-Z0-9.!/_-]{1,35}$/;
  // Remember which defaults were applied so deleted favorites stay removed.
  var flags = ['officeAppsApplied', 'streamforgeAdded', 'liveNowAdded', 'youtubeAdded', 'portfolioPrivate'];

  function defaults() {
    return { clock24: false, favorites: null, themeMode: 'auto', marketSymbols: defaultSymbols.slice() };
  }

  function unique(items) {
    return items.filter(function (value, index) { return items.indexOf(value) === index; });
  }

  function storageKey(native) {
    return 'r3k5.frame.preferences.v1.' + (native ? 'tv' : 'preview');
  }

  // Restore supported fields and fall back to defaults if local storage is unavailable.
  function load(native) {
    var prefs = defaults();
    var saved;
    try { saved = JSON.parse(localStorage.getItem(storageKey(native))); }
    catch (error) { return prefs; }
    if (!saved || typeof saved !== 'object') return prefs;

    if (typeof saved.clock24 === 'boolean') prefs.clock24 = saved.clock24;
    if (saved.homeMarketView === 'watchlist' || saved.homeMarketView === 'portfolio') prefs.homeMarketView = saved.homeMarketView;
    if (['auto', 'day', 'night'].includes(saved.themeMode)) prefs.themeMode = saved.themeMode;
    if (Array.isArray(saved.marketSymbols) && saved.marketSymbols.length && saved.marketSymbols.length <= 3 &&
        saved.marketSymbols.every(function (symbol) { return typeof symbol === 'string' && symbolPattern.test(symbol); })) {
      prefs.marketSymbols = unique(saved.marketSymbols);
    }
    if (Array.isArray(saved.favorites)) {
      prefs.favorites = unique(saved.favorites.filter(function (id) { return typeof id === 'string'; })).slice(0, favoriteLimit);
    }
    flags.forEach(function (flag) { if (saved[flag] === true) prefs[flag] = true; });
    return prefs;
  }

  function save(native, prefs) {
    localStorage.setItem(storageKey(native), JSON.stringify(prefs));
  }

  root.FramePreferences = {
    defaults: defaults,
    load: load,
    save: save,
    favoriteLimit: favoriteLimit,
    symbolPattern: symbolPattern,
  };
}(window));
