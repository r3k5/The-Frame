// Coordinates launcher navigation, dialogs, and the TV application lifecycle.
(function () {
  'use strict';
  var platform = window.FramePlatform;
  var guide = window.FrameLiveGuide, remote = window.FrameRemoteFocus;
  var startup = window.FrameStartup;
  var thumbnails = window.FrameLiveThumbnail, history = window.FrameHistory;
  var preferences = window.FramePreferences;
  var favoriteLimit = preferences.favoriteLimit, symbolPattern = preferences.symbolPattern;
  var prefs = preferences.load(platform.native);
  var el = window.FrameUI.element, button = window.FrameUI.button;
  // Transient screen state lives here. Preferences are saved separately.
  var state = { page: 'home', apps: [], appError: '', loading: true, editing: false, inputs: [], inputError: '', woodlandView: false, busy: false, marketFullscreen: false };
  var modalReturn = null, woodlandReturn = null, toastTimer, captionTimer, inputRequest = 0, appsRequest = 0;
  var watchlistReturn = null;
  var stage = document.getElementById('stage'), content = document.getElementById('content');
  var modalLayer = document.getElementById('modal-layer'), modal = document.getElementById('modal');
  var display = window.FrameWoodlandDisplay.create(stage, {
    themeMode: function () { return prefs.themeMode; },
    canTransition: function () { return state.page === 'home' && !state.woodlandView; },
  });
  var homeMarketActions = {
    save: save,
    editWatchlist: editWatchlist,
    openMarkets: function (symbol) { go('markets', false, symbol); },
    openRobinhood: openRobinhood,
    launchLiveTV: launchLiveTV,
    enterWoodland: enterWoodland,
  };

  function save() {
    try { preferences.save(platform.native, prefs); }
    catch (e) { toast('Preferences could not be saved on this device.'); }
  }
  // Keep the header and Markets clocks in sync, then refresh the current program listings.
  function tick() {
    var now = new Date(), hours = now.getHours(), minute = String(now.getMinutes()).padStart(2, '0');
    display.applyTheme(now);
    var clock = document.getElementById('clock'); clock.textContent = (prefs.clock24 ? String(hours).padStart(2, '0') : (hours % 12 || 12)) + ':' + minute;
    if (!prefs.clock24) clock.appendChild(el('small', '', hours >= 12 ? 'PM' : 'AM'));
    clock.dateTime = now.toISOString();
    document.getElementById('date').textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    var boardClock = document.getElementById('board-clock');
    if (boardClock) boardClock.textContent = clock.textContent.replace(/(AM|PM)$/, ' $1');
    updateLivePanels(now.getTime());
  }
  function toast(message) {
    var node = document.getElementById('toast'); node.textContent = message; node.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { node.hidden = true; }, 4500);
  }
  function focusFirst() { var first = content.querySelector('button'); if (first) first.focus(); }
  // Start on StreamForge when it is pinned. Fall back to the first dock control or Home.
  function focusHome() {
    if (startup.isLoading()) return;
    var card = content.querySelector('.app-row .streamforge-card') || content.querySelector('.app-row .app-card');
    remote.focus(card || document.querySelector('[data-nav="home"]'));
  }
  // Resolve saved favorites against the current app list while preserving their order.
  function pinned() {
    return (prefs.favorites || []).map(function (id) { return state.apps.filter(function (a) { return a.id === id; })[0]; }).filter(Boolean);
  }
  function togglePin(app) {
    var index = prefs.favorites.indexOf(app.id);
    if (index >= 0) prefs.favorites.splice(index, 1);
    else if (prefs.favorites.length < favoriteLimit) prefs.favorites.push(app.id);
    else { toast('Your home has room for ' + favoriteLimit + ' favorites. Remove one to make space.'); return; }
    save(); render();
    var same = Array.prototype.find.call(content.querySelectorAll('[data-app]'), function (node) { return node.dataset.app === app.id; });
    if (same) same.focus();
  }
  // Ignore repeated selections while the platform is still opening an app.
  function launch(app) {
    if (state.busy) return;
    state.busy = true;
    platform.launch(app.id).then(function () { state.busy = false; }, function (e) { state.busy = false; toast('Could not open ' + app.name + '. ' + e.message); });
  }
  function styleFor(name) {
    var lower = name.toLowerCase();
    if (/^streamforge\b/.test(lower)) return 'streamforge';
    if (/livenow/.test(lower)) return 'livenow';
    if (lower.indexOf('hulu') >= 0) return 'hulu';
    if (lower.indexOf('peacock') >= 0) return 'peacock';
    if (/tv\s*plus/.test(lower)) return 'tvplus';
    if (lower.indexOf('netflix') >= 0) return 'netflix';
    if (lower.indexOf('youtube') >= 0) return 'youtube';
    if (lower.indexOf('prime') >= 0) return 'prime';
    if (lower.indexOf('disney') >= 0) return 'disney';
    if (lower.indexOf('plex') >= 0) return 'plex';
    if (lower.indexOf('spotify') >= 0) return 'spotify';
    return '';
  }
  // A tile launches, pins, or moves an app according to the active editing mode.
  function appCard(app, edit) {
    var arranging = state.page === 'home' && state.reordering;
    var card = button('', 'app-card', function () { if (edit) togglePin(app); else if (arranging) pickUpApp(app); else launch(app); });
    if (/^streamforge\b/i.test(app.name)) card.classList.add('streamforge-card');
    card.dataset.app = app.id;
    if (state.page === 'home' && !arranging && styleFor(app.name) === 'livenow') card.dataset.liveChannel = thumbnails.foxChannel;
    if (!edit && !arranging) {
      card.addEventListener('focus', function () { highlightApp(app); });
      card.addEventListener('mouseenter', function () { highlightApp(app); });
    }
    card.setAttribute('aria-label', edit ? ((prefs.favorites.indexOf(app.id) >= 0 ? 'Remove ' : 'Add ') + app.name + ' favorite') : (arranging ? 'Move ' : 'Open ') + app.name);
    if (arranging) {
      card.draggable = true;
      card.setAttribute('aria-pressed', String(state.movingApp === app.id));
      card.classList.toggle('is-moving', state.movingApp === app.id);
      card.addEventListener('dragstart', function (event) { state.draggingApp = app.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', app.id); });
      card.addEventListener('dragover', function (event) { if (state.draggingApp) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
      card.addEventListener('drop', function (event) {
        event.preventDefault();
        var from = prefs.favorites.indexOf(state.draggingApp), to = prefs.favorites.indexOf(app.id);
        if (from >= 0 && to >= 0 && from !== to) { var id = prefs.favorites.splice(from, 1)[0]; prefs.favorites.splice(to, 0, id); save(); render(); focusApp(id); }
        state.draggingApp = null;
      });
      card.addEventListener('dragend', function () { state.draggingApp = null; });
    }
    if (edit) card.setAttribute('aria-pressed', String(prefs.favorites.indexOf(app.id) >= 0));
    var visual = el('div', 'app-art ' + styleFor(app.name));
    var mark = el('span', 'app-monogram', app.name); visual.appendChild(mark);
    if (/^streamforge\b/i.test(app.name)) {
      mark.textContent = 'Stream'; mark.appendChild(el('span', 'forge-name', 'Forge'));
    }
    var iconPath = app.iconPath || (styleFor(app.name) === 'streamforge' ? 'assets/streamforge.svg' : '');
    if (iconPath) {
      var image = el('img'); image.alt = ''; image.src = iconPath.charAt(0) === '/' ? 'file://' + iconPath : iconPath;
      image.addEventListener('error', function () { image.remove(); mark.hidden = false; });
      image.addEventListener('load', function () { if (styleFor(app.name) !== 'streamforge') mark.hidden = true; }); visual.appendChild(image);
    }
    if (edit && prefs.favorites.indexOf(app.id) >= 0) visual.appendChild(el('span', 'pin-indicator', '★'));
    card.appendChild(visual); card.appendChild(el('span', 'app-label', app.name)); return card;
  }
  function highlightApp(app) {
    state.previewApp = app;
    var panel = document.getElementById('app-preview');
    if (panel) window.FramePreview.highlight(panel, app, launch);
  }
  function focusApp(id) {
    var card = Array.prototype.find.call(content.querySelectorAll('[data-app]'), function (node) { return node.dataset.app === id; });
    if (card) card.focus();
  }
  function toggleReordering() {
    state.reordering = !state.reordering; state.movingApp = null; state.draggingApp = null;
    render();
    if (state.reordering && pinned()[0]) focusApp(pinned()[0].id);
    else { var toggle = content.querySelector('[data-rearrange]'); if (toggle) toggle.focus(); }
  }
  function pickUpApp(app) {
    state.movingApp = state.movingApp === app.id ? null : app.id;
    render(); focusApp(app.id);
  }
  // Move the selected favorite by swapping it with its neighbor in the visible dock.
  function moveFavorite(direction) {
    var visible = pinned().map(function (app) { return app.id; }), index = visible.indexOf(state.movingApp), next = index + direction;
    if (index < 0 || next < 0 || next >= visible.length) return;
    var from = prefs.favorites.indexOf(visible[index]), to = prefs.favorites.indexOf(visible[next]);
    var displaced = prefs.favorites[to]; prefs.favorites[to] = prefs.favorites[from]; prefs.favorites[from] = displaced;
    save(); render(); focusApp(state.movingApp);
  }
  function heading(kicker, title, description) {
    var h = el('div', 'page-heading'); h.appendChild(el('div', 'eyebrow', kicker)); h.appendChild(el('h1', '', title));
    if (description) h.appendChild(el('p', '', description));
    content.appendChild(h);
  }
  function appEmpty() {
    var block = el('div', 'empty', state.loading ? 'Finding your apps…' : state.appError || 'No visible apps were returned by the TV.');
    content.appendChild(block);
    if (!state.loading) content.appendChild(button('Refresh apps', 'text-button', function () { loadApps(); }));
  }
  // Rebuild a shelf only when its listings change so periodic updates keep focus stable.
  function updateLivePanels(now) {
    Array.prototype.forEach.call(content.querySelectorAll('[data-live-shelf]'), function (panel) {
      var movie = panel.dataset.liveShelf === 'movies';
      var entries = guide.onNow(movie, now);
      var playable = entries.filter(function (entry) { return thumbnails.supports(entry.channelId); });
      entries = (playable.length ? playable : entries).slice(0, 3);
      var key = entries.map(function (entry) { return entry.id + '/' + entry.title; }).join('|') || (guide.state.loading ? 'loading' : 'empty');
      if (panel.dataset.listings === key) return;
      remote.invalidate();
      panel.dataset.listings = key;
      var cards = panel.querySelector('.live-cards');
      var focused = cards.contains(document.activeElement) ? Array.prototype.indexOf.call(cards.children, document.activeElement) : -1;
      cards.textContent = '';
      if (!entries.length) cards.appendChild(el('p', 'live-empty', guide.state.loading ? 'Loading what’s on now…' : 'Listings unavailable. Open the Samsung TV Plus guide.'));
      entries.forEach(function (entry) {
        var card = button('', 'live-card', function () { openProgramme(entry); });
        card.dataset.liveChannel = entry.channelId;
        if (entry.image) {
          var poster = el('img'); poster.alt = ''; poster.decoding = 'async'; poster.src = entry.image; poster.addEventListener('error', function () { poster.hidden = true; }); card.appendChild(poster);
        }
        var text = el('span', 'live-card-text');
        text.appendChild(el('strong', '', entry.title)); text.appendChild(el('small', '', entry.channel)); card.appendChild(text);
        cards.appendChild(card);
      });
      if (focused >= 0) remote.focus(cards.querySelectorAll('button')[focused] || panel.querySelector('.live-guide-button'));
    });
    startLiveThumbnails();
  }
  function startLiveThumbnails(focused) {
    if (state.page === 'home' && !state.woodlandView && modalLayer.hidden && !state.reordering) thumbnails.start(content, focused);
  }
  function liveShelf(kind, title) {
    var panel = el('section', 'live-shelf'); panel.setAttribute('aria-label', title); panel.dataset.liveShelf = kind;
    var head = el('div', 'live-shelf-heading'); head.appendChild(el('h2', '', title));
    var guideButton = button('TV Plus guide', 'live-guide-button', launchLiveTV);
    guideButton.setAttribute('aria-label', 'Open Samsung TV Plus guide for ' + title.toLowerCase()); head.appendChild(guideButton);
    panel.appendChild(head); panel.appendChild(el('div', 'live-cards'));
    return panel;
  }
  function openProgramme(entry) {
    var end = new Date(entry.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    openModal(entry.title, entry.channel + ' · Scheduled until ' + end);
    if (entry.episode) modal.appendChild(el('p', '', entry.episode));
    if (entry.description) modal.appendChild(el('p', '', entry.description));
    modal.appendChild(button('Open Samsung TV Plus', 'text-button', function () { closeModal(); launchLiveTV(); }));
  }
  // Compose the market panel, highlighted app, live shelves, and favorites dock.
  function renderHome() {
    var hero = el('section', 'hero');
    var watch = el('section', 'home-market-panel');
    window.FrameHomeMarket.render(watch, prefs, homeMarketActions);
    hero.appendChild(watch);
    var panel = el('section', 'office-panel preview-panel'); panel.id = 'app-preview'; panel.setAttribute('aria-label', 'Highlighted app preview');
    var selected = state.apps.filter(function (app) { return state.previewApp && app.id === state.previewApp.id; })[0] || pinned()[0];
    if (state.reordering) {
      panel.appendChild(el('h2', 'reorder-title', state.movingApp ? 'Choose its position.' : 'Arrange your apps.'));
      panel.appendChild(el('p', 'reorder-help', state.movingApp ? 'Use Left or Right to move the selected app. Press OK to place it.' : 'Press OK on an app to pick it up. Then move it left or right and press OK to place it.'));
      panel.appendChild(el('p', 'reorder-help', 'You can also drag tiles with a mouse. Choose Done when finished.'));
    } else if (selected) window.FramePreview.show(panel, selected, launch); else panel.appendChild(el('p', 'preview-waiting', 'Highlight an app to preview it.'));
    hero.appendChild(panel);
    content.appendChild(hero);
    window.FramePortfolio.update();
    var live = el('div', 'live-shelves'); live.appendChild(liveShelf('movies', 'Live movies')); live.appendChild(liveShelf('tv', 'Live TV shows')); content.appendChild(live); updateLivePanels(Date.now());
    var h = el('div', 'section-heading'); h.appendChild(el('h2', '', 'Your apps'));
    var appActions = el('div', 'app-actions'); var reorder = button(state.reordering ? 'Done' : 'Rearrange', '', toggleReordering); reorder.dataset.rearrange = ''; reorder.setAttribute('aria-pressed', String(!!state.reordering)); appActions.appendChild(reorder);
    if (!state.reordering) appActions.appendChild(button('Edit apps', '', function () { go('apps', true); })); h.appendChild(appActions); content.appendChild(h);
    if (state.loading || state.appError) { appEmpty(); return; }
    var row = el('div', 'app-row'); pinned().forEach(function (app, i) { var card = appCard(app, false); var number = el('span', 'app-number'); number.dataset.number = String(i + 1).padStart(2, '0'); number.setAttribute('aria-hidden', 'true'); card.querySelector('.app-label').appendChild(number); row.appendChild(card); });
    var all = button('', 'app-card', function () { go('apps'); }); all.setAttribute('aria-label', 'All apps'); var visual = el('div', 'app-art more'); visual.appendChild(el('span', 'app-monogram', '⊞')); all.appendChild(visual); all.appendChild(el('span', 'app-label', 'All apps')); row.appendChild(all); content.appendChild(row); startLiveThumbnails();
  }
  // Show all discovered apps and use the same tiles to edit favorites.
  function renderApps() {
    heading('R3K5 Edition / Apps', state.editing ? 'Edit favorites.' : 'All your apps.', state.editing ? 'Select an app to add or remove it. Up to ' + favoriteLimit + ' favorites, in the order you choose.' : 'Your TV apps and web shortcuts, in one place.');
    var h = el('div', 'section-heading'); h.appendChild(el('h2', '', state.editing ? prefs.favorites.length + ' of ' + favoriteLimit + ' favorites' : state.apps.length + ' apps and shortcuts'));
    h.appendChild(button(state.editing ? 'Done  ✓' : 'Edit favorites  +', '', function () { state.editing = !state.editing; render(); focusFirst(); })); content.appendChild(h);
    if (state.loading || state.appError || !state.apps.length) { appEmpty(); return; }
    var scroller = el('div', 'scroll-area'), grid = el('div', 'app-grid');
    state.apps.forEach(function (app) { grid.appendChild(appCard(app, state.editing)); }); scroller.appendChild(grid); content.appendChild(scroller);
  }
  // Offer the built-in Woodland display and the separate Samsung Art instructions.
  function renderArt() {
    heading('R3K5 Edition', 'Art');
    var actions = el('div', 'art-actions');
    actions.appendChild(button('View Woodland', 'text-button', enterWoodland));
    actions.appendChild(button('Samsung Art options', 'text-button secondary', artOptions));
    content.appendChild(actions);
  }
  function artOptions() {
    openModal('Artwork on your Frame.', 'Use Samsung Art Mode to display photos and artwork on The Frame.');
    modal.appendChild(el('span', 'setting-label', 'Your own photos and artwork'));
    modal.appendChild(el('p', '', 'Samsung supports adding personal images through SmartThings or USB. You can keep your own spring, summer, autumn, and winter collections without an Art Store membership.'));
    modal.appendChild(el('span', 'setting-label', 'Samsung Art Store'));
    modal.appendChild(el('p', '', 'The full selection requires Art Store membership. Complimentary rotating selections may be available through Art Store Streams, depending on your TV, region, and software.'));
    modal.appendChild(el('p', '', 'On The Frame, a short press of Power enters Samsung Art Mode. This launcher does not unlock paid artwork or replace its subscription controls.'));
    modal.appendChild(button('Samsung artwork guide ↗', 'setting-choice', function () { platform.openWeb('artguide').catch(function (e) { toast(e.message); }); }));
  }
  function openRobinhood() {
    platform.openWeb('robinhood').catch(function (e) { toast('Could not open Robinhood. ' + e.message); });
  }
  // Launch TV Plus using the app ID returned by the TV.
  function launchLiveTV() {
    var app = state.apps.filter(function (a) { return /tv\s*plus/i.test(a.name); })[0];
    if (app) launch(app);
    else toast(state.loading ? 'Still loading TV apps. Try Live TV again in a moment.' : 'Samsung TV Plus was not reported by the TV. Check All apps or refresh the app list.');
  }
  // Pass the symbol and display options to the isolated TradingView frame.
  function marketFrameUrl(symbol) {
    var config = { symbol: symbol, width: '100%', height: '100%', dateRange: '1D', colorTheme: 'dark', isTransparent: true, autosize: true, largeChartUrl: '', utm_source: 'r3k5-frame', utm_medium: 'widget', utm_campaign: 'mini-symbol-overview' };
    return 'https://www.tradingview-widget.com/embed-widget/mini-symbol-overview/?locale=en#' + encodeURIComponent(JSON.stringify(config));
  }
  function toggleMarketFullscreen() {
    state.marketFullscreen = !state.marketFullscreen;
    stage.classList.toggle('market-fullscreen', state.marketFullscreen);
    var target = content.querySelector('[data-market-expand]');
    if (target) { target.textContent = state.marketFullscreen ? 'Exit expanded display' : 'Expand display'; target.setAttribute('aria-pressed', String(state.marketFullscreen)); target.focus(); }
  }
  // Show full charts for the watchlist or the one symbol selected on Home.
  function renderMarkets() {
    heading('R3K5 Edition / Office', 'Market board.', 'Your watchlist on the TV.');
    var clock = el('time', 'market-clock'); clock.id = 'board-clock'; content.appendChild(clock);
    var toolbar = el('div', 'market-toolbar');
    if (!prefs.portfolioPrivate) toolbar.appendChild(button('Robinhood ↗', 'text-button', openRobinhood));
    toolbar.appendChild(button('Edit watchlist', 'text-button secondary', editWatchlist));
    toolbar.appendChild(button('Refresh charts', 'text-button secondary', function () { Array.prototype.forEach.call(content.querySelectorAll('[data-market-symbol]'), function (frame) { frame.src = marketFrameUrl(frame.dataset.marketSymbol); }); }));
    toolbar.appendChild(button('Live TV', 'text-button secondary', launchLiveTV));
    var expand = button(state.marketFullscreen ? 'Exit expanded display' : 'Expand display', 'text-button secondary', toggleMarketFullscreen); expand.dataset.marketExpand = ''; expand.setAttribute('aria-pressed', String(state.marketFullscreen)); toolbar.appendChild(expand); content.appendChild(toolbar);
    var grid = el('div', 'market-grid'); grid.style.gridTemplateColumns = 'repeat(' + prefs.marketSymbols.length + ', 1fr)';
    var symbols = state.marketSymbol ? [state.marketSymbol] : prefs.marketSymbols;
    if (state.marketSymbol) toolbar.appendChild(button('All symbols', 'text-button secondary', function () { go('markets'); }));
    symbols.forEach(function (symbol) {
      var card = el('section', 'market-card'); card.appendChild(el('h2', '', symbol.split(':')[1])); card.appendChild(el('span', 'market-exchange', symbol.split(':')[0] + ' / 1D'));
      // The provider runs on its own origin; no third-party script runs in the launcher.
      var frame = el('iframe', 'market-chart'); frame.title = symbol + ' chart by TradingView'; frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox'); frame.tabIndex = -1; frame.dataset.marketSymbol = symbol; frame.src = marketFrameUrl(symbol); card.appendChild(frame); grid.appendChild(card);
    }); content.appendChild(grid);
    var note = el('div', 'market-note'); note.appendChild(el('span', '', 'Data by TradingView · Availability and delays vary by exchange. No account connection is required for these charts.'));
    note.appendChild(button('TradingView ↗', '', function () { platform.openWeb('tradingview').catch(function (e) { toast(e.message); }); })); content.appendChild(note);
    content.appendChild(el('p', 'section-note', 'If charts stay blank, check the TV connection and refresh.'));
    tick();
  }
  // Normalize ticker symbols and validate the entire watchlist before saving.
  function editWatchlist() {
    openModal('Edit watchlist.', 'Use exchange:ticker symbols, such as NASDAQ:NVDA or AMEX:SPY. Add up to three charts.');
    var form = el('form', 'watchlist-form');
    for (var i = 0; i < 3; i++) {
      var label = el('label', 'watchlist-label', 'Chart ' + (i + 1)); var input = el('input', 'watchlist-input'); input.name = 'symbol' + i; input.value = prefs.marketSymbols[i] || ''; input.maxLength = 54; input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = 'EXCHANGE:TICKER'; label.appendChild(input); form.appendChild(label);
    }
    var error = el('p', 'form-error'); error.setAttribute('role', 'status'); form.appendChild(error);
    var actions = el('div', 'modal-actions'); var submit = button('Save watchlist', 'text-button', function () {}); submit.type = 'submit'; actions.appendChild(submit); actions.appendChild(button('Cancel', 'text-button secondary', closeModal)); form.appendChild(actions);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var symbols = Array.prototype.map.call(form.querySelectorAll('input'), function (input) { return input.value.trim().toUpperCase(); }).filter(Boolean);
      if (!symbols.length || !symbols.every(function (symbol) { return symbolPattern.test(symbol); })) { error.textContent = 'Enter at least one valid exchange:ticker symbol.'; return; }
      prefs.marketSymbols = symbols.filter(function (symbol, index, all) { return all.indexOf(symbol) === index; });
      if (prefs.marketSymbols.indexOf(state.marketSymbol) < 0) state.marketSymbol = null;
      save(); closeModal(); render(); focusFirst();
    }); modal.appendChild(form);
  }
  // Display the native input records used by the platform switcher.
  function renderInputs() {
    heading('Stay connected', 'Pick up where you left off.', 'Available inputs, reported by your TV.');
    if (state.inputError) { content.appendChild(el('div', 'empty', state.inputError)); content.appendChild(button('Try again', 'text-button', loadInputs)); return; }
    if (!state.inputs.length) { content.appendChild(el('div', 'empty', 'No connected sources were reported.')); content.appendChild(button('Refresh inputs', 'text-button', loadInputs)); return; }
    var grid = el('div', 'input-grid');
    state.inputs.forEach(function (source) {
      var card = button('', 'input-card', function () {
        platform.selectInput(source).catch(function (e) { toast('Could not switch input. ' + e.message); });
      }); card.appendChild(el('div', 'input-icon')); card.appendChild(el('strong', '', source.type + ' ' + source.number)); card.appendChild(el('span', '', platform.native ? 'Connected · Select to watch' : 'Sample input · Browser preview')); grid.appendChild(card);
    }); content.appendChild(grid);
  }
  // Stop media and discard cached focus targets before replacing the visible screen.
  function render() {
    window.FramePreview.clear();
    thumbnails.stop();
    remote.invalidate();
    watchlistReturn = null;
    stage.dataset.page = state.page;
    display.applyTheme(new Date());
    content.textContent = '';
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (node) {
      var active = node.dataset.nav === state.page; node.classList.toggle('active', active);
      if (active) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
    });
    ({ home: renderHome, markets: renderMarkets, apps: renderApps, art: renderArt, inputs: renderInputs })[state.page]();
  }
  // Clear screen-specific modes before moving focus to the destination screen.
  function go(page, editing, symbol) {
    display.stopReview();
    state.reordering = false; state.movingApp = null; state.draggingApp = null;
    state.marketFullscreen = false; stage.classList.remove('market-fullscreen');
    state.page = page; state.editing = !!editing; state.marketSymbol = symbol; render();
    if (page === 'home') focusHome(); else focusFirst();
    if (page === 'inputs') loadInputs();
  }
  // Handle a native Home action even when a dialog or full-screen art is open.
  function openHome() {
    if (!modalLayer.hidden) closeModal();
    if (state.woodlandView) leaveWoodland();
    go('home');
  }
  // Use request IDs to keep an older app scan from replacing a newer result.
  function loadApps(background) {
    var request = ++appsRequest;
    if (!background) { state.loading = true; state.appError = ''; render(); }
    return platform.apps().then(function (apps) {
      if (request !== appsRequest) return;
      if (background && !state.loading && !state.appError && JSON.stringify(apps) === JSON.stringify(state.apps)) return;
      var active = document.activeElement;
      var focusAfterLoad = state.page === 'home' && state.loading && !state.woodlandView && modalLayer.hidden &&
        (active === document.body || active.matches('[data-nav="home"]'));
      state.apps = apps; state.loading = false; state.appError = '';
      if (prefs.favorites === null || !prefs.officeAppsApplied) {
        var preferred = ['streamforge', 'livenow', 'netflix', 'hulu', 'peacock', 'prime', 'tvplus'];
        var selected = [];
        preferred.forEach(function (name) { var app = apps.filter(function (a) { return a.name.toLowerCase().replace(/[^a-z0-9]/g, '').indexOf(name) >= 0; })[0]; if (app && selected.length < favoriteLimit && selected.indexOf(app.id) < 0) selected.push(app.id); });
        prefs.favorites = selected; prefs.officeAppsApplied = true; save();
      }
      var streamforge = apps.filter(function (app) { return /^streamforge\b/i.test(app.name); })[0];
      if (streamforge) {
        // Carry the favorite over if a native app replaces the browser shortcut.
        prefs.favorites = prefs.favorites.map(function (id) { return id === 'shortcut.streamforge' ? streamforge.id : id; })
          .filter(function (id, index, all) { return all.indexOf(id) === index; });
        if (!prefs.streamforgeAdded) {
          prefs.favorites = [streamforge.id].concat(prefs.favorites.filter(function (id) { return id !== streamforge.id; })).slice(0, favoriteLimit);
          prefs.streamforgeAdded = true;
        }
        save();
      }
      var liveNow = apps.filter(function (app) { return /livenow/i.test(app.name); })[0];
      if (liveNow) {
        prefs.favorites = prefs.favorites.map(function (id) { return id === 'shortcut.livenow' ? liveNow.id : id; }).filter(function (id, index, all) { return all.indexOf(id) === index; });
        if (!prefs.liveNowAdded) { prefs.favorites = prefs.favorites.filter(function (id) { return id !== liveNow.id; }); prefs.favorites.splice(Math.min(1, prefs.favorites.length), 0, liveNow.id); prefs.favorites = prefs.favorites.slice(0, favoriteLimit); prefs.liveNowAdded = true; }
        save();
      }
      // Add YouTube once when a slot is available and respect later removals.
      if (!prefs.youtubeAdded) {
        var youtube = apps.find(function (app) { return /^youtube$/i.test(app.name.trim()); });
        if (youtube && prefs.favorites.length < favoriteLimit) {
          if (prefs.favorites.indexOf(youtube.id) < 0) prefs.favorites.push(youtube.id);
          prefs.youtubeAdded = true;
          save();
        }
      }
      if (state.page === 'home' || state.page === 'apps') render();
      if (focusAfterLoad) focusHome();
    }, function (e) {
      if (request !== appsRequest) return;
      if (background && state.apps.length) return;
      state.loading = false; state.appError = 'Could not read installed apps. ' + e.message;
      if (state.page === 'home' || state.page === 'apps') render();
    });
  }
  // Ignore results from older input scans and update the screen only while it is open.
  function loadInputs() {
    var request = ++inputRequest;
    platform.inputs().then(function (inputs) {
      if (request !== inputRequest) return;
      state.inputs = inputs; state.inputError = ''; if (state.page === 'inputs') render();
    }, function (e) {
      if (request !== inputRequest) return;
      state.inputError = 'Could not read inputs. ' + e.message; if (state.page === 'inputs') render();
    });
  }
  function showCaption() {
    document.getElementById('woodland-caption').classList.add('awake'); clearTimeout(captionTimer);
    captionTimer = setTimeout(function () { document.getElementById('woodland-caption').classList.remove('awake'); }, 4000);
  }
  // Stop preview playback and remember which control opened the full-screen scene.
  function enterWoodland() {
    display.stopReview();
    window.FramePreview.clear();
    thumbnails.stop();
    woodlandReturn = document.activeElement; state.woodlandView = true; stage.classList.add('woodland-view');
    display.applyTheme(new Date());
    document.getElementById('woodland-caption').hidden = false; document.getElementById('leave-woodland').focus(); showCaption();
  }
  function leaveWoodland() {
    state.woodlandView = false; stage.classList.remove('woodland-view'); document.getElementById('woodland-caption').hidden = true; clearTimeout(captionTimer);
    display.applyTheme(new Date());
    if (woodlandReturn && woodlandReturn.isConnected) woodlandReturn.focus(); else focusFirst();
    if (state.previewApp && document.getElementById('app-preview')) window.FramePreview.show(document.getElementById('app-preview'), state.previewApp, launch);
    startLiveThumbnails();
  }
  // Keep one return target as settings and other dialogs replace each other.
  function openModal(title, description) {
    display.stopReview();
    window.FramePreview.clear();
    thumbnails.stop();
    if (modalLayer.hidden) modalReturn = document.activeElement;
    modalLayer.hidden = false; modal.textContent = '';
    var close = button('×', 'close', closeModal); close.setAttribute('aria-label', 'Close dialog'); modal.appendChild(close);
    modal.appendChild(el('div', 'eyebrow', 'R3K5 Edition')); var h = el('h2', '', title); h.id = 'modal-title'; modal.appendChild(h);
    if (description) modal.appendChild(el('p', '', description)); close.focus();
  }
  function closeModal() {
    modalLayer.hidden = true;
    if (modalReturn && modalReturn.isConnected) modalReturn.focus(); else focusFirst();
    startLiveThumbnails();
  }
  function startSceneReview() {
    closeModal();
    go('home');
    display.startReview();
  }
  function weatherModal() {
    var weather = window.FrameWeather.state;
    openModal('Local weather.', weather.location.label + (weather.location.zip ? ' · ' + weather.location.zip : ''));
    var details = el('div'); details.id = 'weather-details'; modal.appendChild(details); display.renderWeather();
    modal.appendChild(el('p', '', 'Weather model data by Open-Meteo. Refreshes every 15 minutes.'));
    var form = el('form', 'weather-form');
    var label = el('label', 'watchlist-label', 'US ZIP code'); label.htmlFor = 'weather-zip';
    var input = el('input', 'watchlist-input'); input.value = weather.location.zip || ''; input.maxLength = 5; input.inputMode = 'numeric'; input.autocomplete = 'postal-code'; input.hidden = true;
    input.id = 'weather-zip';
    // Open the TV keyboard only when the ZIP control is selected.
    var edit = button(input.value || 'Enter ZIP code', 'watchlist-input zip-edit', function () {
      edit.hidden = true; input.hidden = false; input.focus();
    });
    edit.setAttribute('aria-label', 'Edit ZIP code' + (input.value ? ', ' + input.value : ''));
    form.appendChild(label); form.appendChild(edit); form.appendChild(input);
    var error = el('p', 'form-error'); error.setAttribute('role', 'alert'); form.appendChild(error);
    var submit = button('Save weather location', 'text-button', function () {}); submit.type = 'submit'; form.appendChild(submit);
    input.addEventListener('blur', function () {
      input.hidden = true; edit.hidden = false;
      edit.textContent = input.value || 'Enter ZIP code';
      edit.setAttribute('aria-label', 'Edit ZIP code' + (input.value ? ', ' + input.value : ''));
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' || event.keyCode === 10009) {
        event.preventDefault(); event.stopPropagation(); input.blur(); remote.focus(edit);
      } else if (event.key === 'Enter' || event.keyCode === 13) {
        event.preventDefault(); event.stopPropagation(); remote.focus(submit);
      }
    });
    form.addEventListener('submit', function (event) { event.preventDefault(); submit.disabled = true; error.textContent = 'Finding ZIP code…'; window.FrameWeather.setZip(input.value.trim()).then(function () { if (form.isConnected) weatherModal(); }).catch(function (e) { error.textContent = e.message; }).finally(function () { submit.disabled = false; }); }); modal.appendChild(form);
    modal.appendChild(el('span', 'setting-label', 'Location detection'));
    var capability = platform.locationCapability();
    modal.appendChild(el('p', '', capability === false ? 'This TV reports no location provider, including Wi-Fi positioning. Your saved ZIP code supplies local weather.' : 'Detection depends on device support and location permission. Your saved area remains the fallback.'));
    var detect = button('Detect location', 'setting-choice', function () { detect.disabled = true; window.FrameWeather.detect().then(function () { if (detect.isConnected) weatherModal(); }).catch(function (e) { error.textContent = e.message; }).finally(function () { detect.disabled = false; }); }); detect.disabled = capability === false; modal.appendChild(detect);
    modal.appendChild(button('Refresh weather', 'setting-choice', function () { window.FrameWeather.refresh(); }));
    modal.appendChild(button('Weather source ↗', 'setting-choice', function () { platform.openWeb('weather').catch(function (e) { toast(e.message); }); }));
  }
  // Render display and app preferences from the current saved selections.
  function settings() {
    openModal('Display settings.', 'Appearance and preferences for the office TV.');
    modal.appendChild(button('Review Woodland scenes', 'setting-choice', startSceneReview));
    modal.appendChild(button('Local weather · Location', 'setting-choice', weatherModal));
    if (platform.native) modal.appendChild(button('Open Samsung Smart Hub', 'setting-choice', function () {
      closeModal();
      launch({ id: 'com.samsung.tv.csfs', name: 'Samsung Smart Hub' });
    }));
    modal.appendChild(button('LiveNOW preview source', 'setting-choice', previewSourceModal));
    modal.appendChild(el('span', 'setting-label', 'Theme'));
    ['auto', 'day', 'night'].forEach(function (mode) {
      var label = { auto: 'Automatic', day: 'Daytime', night: 'Nighttime' }[mode];
      var choice = button(label, 'setting-choice' + (prefs.themeMode === mode ? ' selected' : ''), function () { prefs.themeMode = mode; save(); tick(); settings(); modal.querySelector('[data-theme-mode="' + mode + '"]').focus(); });
      choice.dataset.themeMode = mode; choice.setAttribute('aria-pressed', String(prefs.themeMode === mode)); modal.appendChild(choice);
    });
    modal.appendChild(el('p', '', 'Automatic uses the TV’s clock. Woodland fades into daytime at 7 a.m. and nighttime at 7 p.m.'));
    modal.appendChild(el('span', 'setting-label', 'Clock'));
    var clock = button(prefs.clock24 ? '24-hour clock' : '12-hour clock', 'setting-choice', function () {
      prefs.clock24 = !prefs.clock24; save(); tick(); settings(); modal.querySelector('[data-clock]').focus();
    }); clock.dataset.clock = ''; modal.appendChild(clock);
    modal.appendChild(el('span', 'setting-label', 'Apps'));
    modal.appendChild(button('Refresh installed apps', 'setting-choice', function () { closeModal(); loadApps(); }));
    var reset = button('Reset preferences', 'setting-choice', confirmReset); modal.appendChild(reset);
    modal.appendChild(button('Version history', 'setting-choice', versionHistory));
  }
  function versionHistory() {
    openModal('Version history', 'Created by Mike Davis');
    history.forEach(function (release) {
      modal.appendChild(el('h3', 'release-version', 'v' + release[0]));
      modal.appendChild(el('p', 'release-notes', release[1]));
    });
  }
  // Reset general preferences while keeping the portfolio privacy choice.
  function confirmReset() {
    openModal('Reset preferences?', 'This resets your favorites, watchlist, theme, and clock preference.');
    var actions = el('div', 'modal-actions'); actions.appendChild(button('Keep preferences', 'text-button secondary', settings));
    actions.appendChild(button('Reset', 'text-button danger', function () {
      var privatePortfolio = prefs.portfolioPrivate === true;
      prefs = preferences.defaults();
      prefs.portfolioPrivate = privatePortfolio;
      save(); tick(); closeModal(); loadApps(); toast('Preferences reset.');
    })); modal.appendChild(actions);
  }
  function previewSourceModal() {
    openModal('LiveNOW preview.', 'Live event URLs can change. Paste the current video URL from the official LiveNOW from FOX YouTube channel. The main LiveNOW tile always opens its official watch page.');
    var form = el('form'); var label = el('label', 'watchlist-label', 'YouTube live-video URL'); var input = el('input', 'watchlist-input'); input.value = window.FramePreview.getSource(); input.maxLength = 250; label.appendChild(input); form.appendChild(label);
    var error = el('p', 'form-error'); error.setAttribute('role', 'alert'); form.appendChild(error);
    var saveButton = button('Save preview source', 'text-button', function () {}); saveButton.type = 'submit'; form.appendChild(saveButton);
    form.addEventListener('submit', function (event) { event.preventDefault(); try { window.FramePreview.setSource(input.value); closeModal(); render(); focusFirst(); toast('Preview source saved.'); } catch (e) { error.textContent = e.message; } }); modal.appendChild(form);
  }
  // Close the innermost interaction before navigating away from its screen.
  function back() {
    if (!modalLayer.hidden) { closeModal(); return; }
    if (display.stopReview()) return;
    if (state.reordering) {
      if (state.movingApp) { var id = state.movingApp; state.movingApp = null; render(); focusApp(id); }
      else toggleReordering();
      return;
    }
    if (state.woodlandView) { leaveWoodland(); return; }
    if (state.marketFullscreen) { toggleMarketFullscreen(); return; }
    if (state.page !== 'home') { go('home'); return; }
    openModal('Leave Frame?', platform.native ? 'Return to your TV.' : 'You are in the browser preview. Close this dialog to keep exploring.');
    var actions = el('div', 'modal-actions'); actions.appendChild(button('Stay here', 'text-button secondary', closeModal));
    if (platform.native) actions.appendChild(button('Exit launcher', 'text-button', function () { platform.exit(); })); modal.appendChild(actions);
  }
  // Keep navigation inside the current overlay when one is open.
  function focusables() {
    var container = !modalLayer.hidden ? modal : state.woodlandView ? document.getElementById('woodland-caption') : stage;
    return remote.nodes(container, state.page === 'home' && container === stage && !state.reordering);
  }
  // Provide a direct route between the watchlist and the highlighted app.
  function crossHomePanels(nodes, current, direction) {
    if (state.page !== 'home' || !modalLayer.hidden || state.woodlandView) return;
    if (direction === 'right' && current.closest('.home-market-panel')) {
      var open = content.querySelector('#app-preview [aria-label="Open selected app"]');
      if (nodes.indexOf(open) >= 0) return open;
    }
    if (direction === 'left' && current.matches('#app-preview [aria-label="Open selected app"]')) {
      if (nodes.indexOf(watchlistReturn) >= 0) return watchlistReturn;
      return content.querySelector('.home-market-panel .office-actions button:last-child') || content.querySelector('.home-market-panel .home-market-switch');
    }
  }
  function move(direction) {
    var nodes = focusables(), current = document.activeElement;
    if (nodes.indexOf(current) < 0) {
      var activeNav = stage.querySelector('.nav.active');
      current = nodes.indexOf(activeNav) >= 0 ? activeNav : nodes[0];
      if (!current) return;
    }
    var target = direction === 'left' ? crossHomePanels(nodes, current, direction) : null;
    var candidates = direction === 'down' && current.closest('.app-row') && !current.matches('.app-row button:first-child') ? nodes.filter(function (node) { return node.id !== 'version-history'; }) : nodes;
    var panelTarget = direction === 'right' ? crossHomePanels(nodes, current, direction) : null;
    target = target || remote.nearest(candidates, current, direction, panelTarget);
    if (direction === 'right' && target && target.closest('#app-preview') && current.closest('.home-market-panel')) watchlistReturn = current;
    if (target || current !== document.activeElement) remote.focus(target || current);
  }
  document.addEventListener('keydown', function (event) {
    if (startup.isLoading()) { event.preventDefault(); return; }
    var key = event.key, code = event.keyCode;
    if (state.reordering && state.movingApp && modalLayer.hidden && document.activeElement.dataset.app === state.movingApp && (key === 'ArrowLeft' || key === 'ArrowRight' || code === 37 || code === 39)) {
      event.preventDefault(); moveFavorite(key === 'ArrowLeft' || code === 37 ? -1 : 1); return;
    }
    if (event.target.tagName === 'INPUT' && key !== 'Escape' && code !== 10009 && key !== 'Tab') return;
    if (state.woodlandView) showCaption();
    var direction = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' })[key] || ({ 37: 'left', 39: 'right', 38: 'up', 40: 'down' })[code];
    if (direction) { event.preventDefault(); move(direction); }
    else if (code === 10009 || key === 'Escape' || key === 'Backspace') { event.preventDefault(); back(); }
    else if (key === 'Tab') {
      var nodes = focusables(), index = nodes.indexOf(document.activeElement);
      event.preventDefault(); if (nodes.length) remote.focus(nodes[(index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length]);
    } else if ((key === 'Enter' || code === 13) && document.activeElement === document.body) {
      event.preventDefault(); if (state.page === 'home') focusHome(); else focusFirst();
    }
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (node) { node.addEventListener('click', function () { go(node.dataset.nav); }); });
  document.getElementById('settings').addEventListener('click', settings);
  document.getElementById('end-scene-review').addEventListener('click', display.stopReview);
  var versionButton = document.getElementById('version-history');
  versionButton.textContent = 'Created by Mike Davis  ·  ';
  versionButton.appendChild(el('span', 'version-number', 'v' + history[0][0]));
  versionButton.addEventListener('click', versionHistory);
  document.getElementById('weather').addEventListener('click', weatherModal);
  // Samsung can send its Home operation to an already-running launcher.
  if (platform.native) window.addEventListener('appcontrol', function () {
    if (startup.isLoading()) return;
    var request = window.tizen.application.getCurrentApplication().getRequestedAppControl();
    if (request && request.appControl.operation === 'http://tizen.org/appcontrol/operation/main') {
      tick();
      window.FrameWeather.refreshWhenVisible();
      openHome();
    }
  });
  window.addEventListener('frameweatherchange', display.renderWeather);
  window.addEventListener('framepreviewstop', function () { startLiveThumbnails(); });
  stage.addEventListener('focus', function (event) { startLiveThumbnails(event.target); }, true);
  window.addEventListener('frameliveguidechange', function () { updateLivePanels(Date.now()); });
  document.getElementById('leave-woodland').addEventListener('click', leaveWoodland);
  stage.addEventListener('mousemove', function () { if (state.woodlandView) showCaption(); });
  // Pause background effects when hidden and refresh device data when the app resumes.
  document.addEventListener('visibilitychange', function () {
    stage.classList.toggle('background-paused', document.hidden);
    if (document.hidden) { display.stopReview(); display.applyTheme(new Date()); }
    else {
      tick(); state.busy = false;
      if (!startup.isLoading()) loadApps(true);
      guide.refresh();
    }
  });
  tick(); display.renderWeather(); setInterval(tick, 10000);
  startup.start(loadApps, focusHome);
  setInterval(guide.refresh, 15 * 60 * 1000);
}());
