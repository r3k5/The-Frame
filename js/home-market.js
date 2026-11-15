// Renders the Home portfolio and public watchlist views.
(function (root) {
  'use strict';

  var el = root.FrameUI.element, button = root.FrameUI.button;
  var remote = root.FrameRemoteFocus, portfolio = root.FramePortfolio;
  var watchlistReady;

  function render(watch, prefs, actions) {
    // Privacy mode renders the public watchlist in place of the portfolio.
    var privateView = prefs.portfolioPrivate === true;
    var showPortfolio = !privateView && (prefs.homeMarketView === 'portfolio' || (!prefs.homeMarketView && portfolio.configured));
    watch.textContent = '';
    remote.invalidate();
    watch.setAttribute('aria-label', showPortfolio ? 'Robinhood portfolio' : 'Home watchlist');
    var watchHeading = el('div', 'home-market-heading');
    watchHeading.appendChild(el('h1', '', showPortfolio ? 'Robinhood' : 'Markets'));
    var controls = el('div', 'home-market-controls');
    if (!showPortfolio) controls.appendChild(button('Edit watchlist', '', actions.editWatchlist));
    if (!privateView) {
      controls.appendChild(button(showPortfolio ? 'Watchlist' : 'Robinhood', 'home-market-switch', function () {
        prefs.homeMarketView = showPortfolio ? 'watchlist' : 'portfolio';
        actions.save();
        render(watch, prefs, actions);
        remote.focus(watch.querySelector('.home-market-switch'));
      }));
    }
    if (portfolio.configured || privateView) {
      controls.appendChild(button(privateView ? 'Show portfolio' : 'Hide portfolio', 'home-portfolio-privacy', function () {
        prefs.portfolioPrivate = !privateView;
        if (privateView) prefs.homeMarketView = 'portfolio';
        actions.save();
        render(watch, prefs, actions);
        remote.focus(watch.querySelector('.home-portfolio-privacy'));
      }));
    }
    watchHeading.appendChild(controls);
    watch.appendChild(watchHeading);
    if (showPortfolio) renderPortfolio(watch);
    else renderWatchlist(watch, prefs, actions, privateView);
  }

  // Mount the balance, chart, and period controls for the portfolio renderer.
  function renderPortfolio(watch) {
    watchlistReady = null;
    var summary = el('div', 'home-portfolio-summary');
    var balance = el('strong'), change = el('span');
    balance.id = 'portfolio-status';
    change.id = 'portfolio-change';
    summary.appendChild(balance);
    summary.appendChild(change);
    watch.appendChild(summary);

    var chart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chart.id = 'portfolio-chart';
    chart.setAttribute('viewBox', '0 0 566 108');
    chart.setAttribute('preserveAspectRatio', 'none');
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', 'Estimated Robinhood account value in US dollars by date');
    watch.appendChild(chart);

    var footer = el('div', 'home-portfolio-footer');
    var detail = el('span'), ranges = el('div', 'home-portfolio-ranges');
    detail.id = 'portfolio-detail';
    ranges.setAttribute('role', 'group');
    ranges.setAttribute('aria-label', 'Portfolio chart range');
    [[7, '1W'], [30, '1M'], [90, '3M'], [365, '1Y']].forEach(function (range) {
      var rangeButton = button(range[1], '', function () { portfolio.selectRange(range[0]); });
      rangeButton.dataset.days = range[0];
      ranges.appendChild(rangeButton);
    });
    footer.appendChild(detail);
    footer.appendChild(ranges);
    watch.appendChild(footer);
    portfolio.update();
  }

  // Build the Home quote ticker and remote-friendly shortcuts to full charts.
  function renderWatchlist(watch, prefs, actions, privateView) {
    var quotes = el('div', 'home-quotes');
    var ticker = el('iframe', 'home-ticker');
    ticker.title = 'Market prices and daily changes by TradingView';
    ticker.tabIndex = -1;
    ticker.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    // Wait for the provider frame, whose initial blank document also fires load.
    watchlistReady = new Promise(function (resolve) {
      function loaded() {
        if (!ticker.hasAttribute('src')) return;
        ticker.removeEventListener('load', loaded);
        resolve();
      }
      ticker.addEventListener('load', loaded);
    });
    quotes.appendChild(ticker);
    watch.appendChild(quotes);
    // Paint the remote controls before starting the single pricing widget.
    setTimeout(function () {
      if (!ticker.isConnected) return;
      var config = {
        symbols: prefs.marketSymbols.map(function (symbol) { return { proName: symbol, title: symbol.split(':')[1] }; }),
        showSymbolLogo: false,
        colorTheme: 'dark',
        isTransparent: false,
        displayMode: 'regular',
        locale: 'en',
      };
      ticker.src = 'https://www.tradingview-widget.com/embed-widget/ticker-tape/?locale=en#' + encodeURIComponent(JSON.stringify(config));
    }, 400);
    var symbols = el('div', 'home-market-tabs');
    prefs.marketSymbols.forEach(function (symbol) {
      var tickerName = symbol.split(':')[1];
      var tab = button(tickerName, 'home-symbol-tab', function () { actions.openMarkets(symbol); });
      tab.setAttribute('aria-label', 'Open ' + tickerName + ' chart');
      symbols.appendChild(tab);
    });
    watch.appendChild(symbols);
    var footer = el('div', 'office-actions');
    footer.appendChild(button('Open Markets', 'text-button', function () { actions.openMarkets(); }));
    if (!portfolio.configured && !privateView) footer.appendChild(button('Robinhood portfolio ↗', 'text-button secondary', actions.openRobinhood));
    footer.appendChild(button('Live TV', 'text-button secondary', actions.launchLiveTV));
    footer.appendChild(button('View Woodland', 'text-button secondary', actions.enterWoodland));
    watch.appendChild(footer);
  }

  root.FrameHomeMarket = {
    render: render,
    ready: function (portfolioRequest) { return watchlistReady || portfolioRequest; },
  };
}(window));
