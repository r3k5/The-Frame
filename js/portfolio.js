// Fetches paired portfolio data and draws the Home balance chart.
(function (root) {
  'use strict';
  var config = root.FramePortfolioConfig;
  var snapshot, history, points = [], days = 30;
  var lastBalanceRequest = 0, lastHistoryRequest = 0;
  var balancePending, historyPending, refreshTimer;
  var day = 24 * 60 * 60 * 1000;
  // Balance checks and history refreshes run on separate schedules.
  var balanceInterval = 10 * 60 * 1000, historyInterval = 60 * 60 * 1000;
  var currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  var axisCurrency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  var percentage = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 });
  var syncTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  var chartDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  var chartDateWithYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' });
  var statusText = {
    link_required: 'Link Robinhood on your PC',
    relink_required: 'Reconnect Robinhood on your PC',
    unavailable: 'Portfolio unavailable',
  };

  // Fit the value axis to the selected points and use elapsed time for horizontal spacing.
  function drawChart(chart, values) {
    chart.textContent = '';
    if (values.length < 2) return;
    var totals = values.map(function (point) { return point[1]; });
    var low = Math.min.apply(null, totals), high = Math.max.apply(null, totals);
    var rounding = Math.pow(10, Math.floor(Math.log10(Math.max(high - low, 0.04) / 2)));
    low = Math.floor((low - rounding / 4) / rounding) * rounding;
    high = Math.ceil((high + rounding / 4) / rounding) * rounding;
    var first = values[0][0], last = values[values.length - 1][0];
    var dateFormat = new Date(first).getUTCFullYear() === new Date(last).getUTCFullYear() ? chartDate : chartDateWithYear;
    var right = 557, top = 13, bottom = 81;
    var gridFractions = [0, 0.5, 1];
    var moneyLabels = gridFractions.map(function (fraction) { return axisCurrency.format(high - fraction * (high - low)); });
    var maxLabelLength = Math.max.apply(null, moneyLabels.map(function (value) { return value.length; }));
    var left = Math.max(96, maxLabelLength * 8 + 16);
    var grid = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    grid.setAttribute('class', 'portfolio-chart-grid');
    chart.appendChild(grid);

    function tick(text, x, y, anchor) {
      var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', x);
      label.setAttribute('y', y);
      label.setAttribute('text-anchor', anchor);
      label.textContent = text;
      chart.appendChild(label);
    }

    var gridLines = [];
    gridFractions.forEach(function (fraction, index) {
      var y = top + fraction * (bottom - top);
      gridLines.push('M' + left + ' ' + y + 'H' + right);
      tick(moneyLabels[index], left - 9, y + 5, 'end');
    });
    var dateTicks = last - first >= 3 * day ? [0, 0.5, 1] : [0, 1];
    dateTicks.forEach(function (fraction) {
      var x = left + fraction * (right - left);
      gridLines.push('M' + x + ' ' + top + 'V' + bottom);
      tick(dateFormat.format(first + fraction * (last - first)), x, 103, fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle');
    });
    grid.setAttribute('d', gridLines.join(' '));

    var line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    var coordinates = values.map(function (point) {
      var x = left + (right - left) * (point[0] - first) / (last - first);
      var y = bottom - (bottom - top) * (point[1] - low) / (high - low);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    line.setAttribute('points', coordinates.join(' '));
    chart.appendChild(line);
  }

  // Render only when the portfolio view is mounted on Home.
  function update() {
    var label = document.getElementById('portfolio-status');
    if (!label) return;
    var detail = document.getElementById('portfolio-detail');
    var chart = document.getElementById('portfolio-chart');
    var change = document.getElementById('portfolio-change');
    var connected = snapshot && snapshot.status === 'connected' && snapshot.currency === 'USD' && Number.isFinite(snapshot.total);
    if (connected) {
      label.textContent = currency.format(snapshot.total);
    } else {
      label.textContent = config ? (snapshot ? statusText[snapshot.status] || statusText.unavailable : 'Loading portfolio…') : 'Portfolio connection required';
    }

    var last = points.length ? points[points.length - 1][0] : 0;
    var values = connected ? points.filter(function (point) { return point[0] > last - days * day; }) : [];
    drawChart(chart, values);
    change.textContent = '';
    delete change.dataset.direction;
    change.removeAttribute('aria-label');
    if (values.length > 1) {
      var start = values[0][1], end = values[values.length - 1][1];
      if (start > 0) {
        var rate = (end - start) / start;
        change.textContent = (rate > 0 ? '+' : '') + percentage.format(rate);
        change.dataset.direction = rate < 0 ? 'down' : 'up';
        change.setAttribute('aria-label', 'Change in estimated account value: ' + change.textContent);
      }
    }
    var synced = '';
    var chartStatus = '';
    if (connected) {
      // A fresh read provides a check time. Cached data uses the provider timestamp.
      if (snapshot.freshness === 'realtime' && Number.isFinite(snapshot.checkedAt)) synced = 'Checked ' + syncTime.format(snapshot.checkedAt);
      else if (Number.isFinite(snapshot.asOf)) synced = (snapshot.freshness === 'delayed' ? 'Cached ' : 'Synced ') + syncTime.format(snapshot.asOf);
      if (values.length > 1) chartStatus = 'Est. history';
      else if (!history) chartStatus = 'Loading history…';
      else if (history.status === 'history_disabled') chartStatus = 'Enable Balance History in SnapTrade';
      else chartStatus = 'History unavailable for this period';
    }
    detail.textContent = [synced, chartStatus].filter(Boolean).join('  ·  ');
    Array.prototype.forEach.call(label.closest('.home-market-panel').querySelectorAll('.home-portfolio-ranges button'), function (button) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.days) === days));
    });
  }

  // Send the display token in an Authorization header and reject redirects.
  function request(suffix, timeout) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeout);
    return fetch(config.url + suffix, {
      headers: { Authorization: 'Bearer ' + config.token }, cache: 'no-store', signal: controller.signal, redirect: 'error'
    }).then(function (response) {
      if (!response.ok) throw new Error('Portfolio unavailable');
      return response.json();
    }).finally(function () { clearTimeout(timer); });
  }

  // Pause polling while hidden and retain the last result during a transient failure.
  function refresh() {
    clearTimeout(refreshTimer);
    if (!config || document.hidden) return;
    var now = Date.now();
    if (!balancePending && now - lastBalanceRequest >= balanceInterval) {
      lastBalanceRequest = now;
      balancePending = request('', 20000)
        .then(function (result) { snapshot = result || { status: 'unavailable' }; }, function () {
          if (!snapshot) snapshot = { status: 'unavailable' };
        })
        .finally(function () { balancePending = null; update(); });
    }
    if (!historyPending && now - lastHistoryRequest >= historyInterval) {
      lastHistoryRequest = now;
      historyPending = request('/history', 30000)
        .then(function (result) {
          history = result || { status: 'unavailable' };
          points = Array.isArray(history.points) ? history.points.filter(function (point) {
            return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
          }).slice(-366) : [];
        }, function () { if (!history) history = { status: 'unavailable' }; })
        .finally(function () { historyPending = null; update(); });
    }
    var next = Math.min(lastBalanceRequest + balanceInterval, lastHistoryRequest + historyInterval);
    refreshTimer = setTimeout(refresh, Math.max(1000, next - Date.now()));
    return Promise.all([balancePending, historyPending]);
  }

  document.addEventListener('visibilitychange', refresh);
  root.FramePortfolio = {
    configured: Boolean(config),
    update: update,
    refresh: refresh,
    selectRange: function (range) { days = range; update(); },
  };
}(window));
