// Reads one linked Robinhood portfolio through SnapTrade and exposes display data.
const { createHmac, timingSafeEqual } = require('node:crypto');

const displayTokenPattern = /^[A-Za-z0-9_-]{32,128}$/;
const cacheMilliseconds = 10 * 60 * 1000;
const historyCacheMilliseconds = 60 * 60 * 1000;
// Keep portfolio responses out of browser and proxy caches.
const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function response(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

function createPortfolioFeed(env, { coalesce = false } = {}) {
  const { SNAPTRADE_CLIENT_ID: clientId, SNAPTRADE_CONSUMER_KEY: consumerKey, FRAME_PORTFOLIO_TOKEN: token } = env;
  const configured = Boolean(clientId && consumerKey && displayTokenPattern.test(token || ''));
  const expected = configured ? Buffer.from(`Bearer ${token}`) : null;

  // Sign the exact path and query sent to SnapTrade. Keep the consumer key on the server.
  async function snapTrade(path, resource) {
    const query = new URLSearchParams({ clientId, timestamp: String(Math.floor(Date.now() / 1000)) }).toString();
    const payload = JSON.stringify({ content: null, path: '/api/v1' + path, query });
    const signature = createHmac('sha256', consumerKey).update(payload).digest('base64');
    let result;
    let failure;
    try {
      result = await fetch(`https://api.snaptrade.com/api/v1${path}?${query}`, {
        headers: { Signature: signature },
        signal: AbortSignal.timeout(8000),
        redirect: 'manual',
      });
      if (result.ok) return await result.json();
    } catch (error) {
      failure = ['AbortError', 'TimeoutError', 'TypeError', 'SyntaxError'].includes(error.name) ? error.name : 'Error';
    }
    throw Object.assign(new Error('SnapTrade request failed'), {
      resource,
      upstreamStatus: result?.status ?? null,
      failure,
    });
  }

  // Select a read-only Robinhood connection before querying any accounts.
  async function readAccounts(forHistory = false) {
    const connections = await snapTrade('/authorizations', 'connections');
    const robinhood = connections.filter(connection => connection.type === 'read' && connection.brokerage?.slug === 'ROBINHOOD');
    const connectionId = env.FRAME_ROBINHOOD_CONNECTION_ID;
    const connection = connectionId ? robinhood.find(item => item.id === connectionId) : robinhood.length === 1 ? robinhood[0] : null;
    if (!connection) return { status: 'link_required' };
    if (connection.disabled) return { status: 'relink_required' };

    // The history route uses the daily account list so reading a chart does not refresh live balances.
    const accountPath = forHistory ? '/accounts/all' : `/connections/${encodeURIComponent(connection.id)}/accounts`;
    const { results } = await snapTrade(accountPath, 'accounts');
    const accounts = results.filter(account => account.kind === 'investment' && account.status !== 'closed' &&
      account.status !== 'archived' && !account.is_paper && (!forHistory || account.connection_id === connection.id));
    if (!accounts.length) return { status: 'unavailable' };
    return { status: 'connected', accounts, freshnessMode: connection.data_freshness_mode };
  }

  // Report the sum and use the oldest account sync time so the total is dated conservatively.
  async function readPortfolio() {
    const { status, accounts, freshnessMode } = await readAccounts();
    if (status !== 'connected') return { status };
    if (accounts.some(account => account.net_value?.currency !== 'USD' || !Number.isFinite(account.net_value.amount))) {
      return { status: 'unavailable' };
    }
    const syncTimes = accounts.map(account => Date.parse(account.sync_status?.balances || ''));
    const modes = [freshnessMode?.institution, freshnessMode?.snaptrade];
    const freshness = modes.includes('delayed') ? 'delayed' : modes.every(mode => mode === 'realtime') ? 'realtime' : 'unknown';
    return {
      status: 'connected',
      currency: 'USD',
      total: accounts.reduce((total, account) => total + account.net_value.amount, 0),
      asOf: syncTimes.every(Number.isFinite) ? Math.min(...syncTimes) : null,
      checkedAt: Date.now(),
      freshness,
    };
  }

  // Combine per-account history by date and omit dates with missing accounts.
  async function readHistory() {
    const { status, accounts } = await readAccounts(true);
    if (status !== 'connected') return { status };
    const histories = await Promise.all(accounts.map(account =>
      snapTrade(`/accounts/${encodeURIComponent(account.id)}/balanceHistory`, 'history')));
    const totalsByDate = new Map();
    for (const history of histories) {
      if (history.currency !== 'USD' || !Array.isArray(history.history)) return { status: 'unavailable' };
      const accountValues = new Map();
      for (const point of history.history) {
        const date = typeof point.date === 'string' && Date.parse(point.date.slice(0, 10) + 'T00:00:00Z');
        const total = (typeof point.total_value === 'number' || typeof point.total_value === 'string' && point.total_value.trim()) ? Number(point.total_value) : NaN;
        if (Number.isFinite(date) && Number.isFinite(total)) accountValues.set(date, total);
      }
      for (const [date, total] of accountValues) {
        const entry = totalsByDate.get(date) || { total: 0, count: 0 };
        entry.total += total;
        entry.count += 1;
        totalsByDate.set(date, entry);
      }
    }
    const points = [...totalsByDate]
      .filter(([, entry]) => entry.count === accounts.length && Number.isFinite(entry.total))
      .sort(([first], [second]) => first - second)
      .slice(-366)
      .map(([date, entry]) => [date, entry.total]);
    return { status: 'connected', points };
  }

  let cached, pending;
  async function portfolio() {
    const started = Date.now();
    if (cached && started - cached.time < cacheMilliseconds) return cached.data;
    if (pending) return pending;
    const load = readPortfolio().then(data => {
      if (!cached || started >= cached.time) cached = { data, time: started };
      return data;
    });
    if (coalesce) pending = load;
    try { return await load; }
    finally { if (coalesce) pending = null; }
  }

  let cachedHistory;
  async function portfolioHistory() {
    const started = Date.now();
    if (cachedHistory && started - cachedHistory.time < historyCacheMilliseconds) return cachedHistory.data;
    let data;
    try {
      data = await readHistory();
    } catch (error) {
      if (error.resource !== 'history' || error.upstreamStatus !== 403) throw error;
      data = { status: 'history_disabled' };
    }
    if (!cachedHistory || started >= cachedHistory.time) cachedHistory = { data, time: started };
    return data;
  }

  return async function handlePortfolio(request) {
    const url = new URL(request.url);
    if (!['/portfolio', '/portfolio/history'].includes(url.pathname) || url.search) return response(404);
    if (request.method === 'OPTIONS') return response(204);
    if (request.method !== 'GET') return response(405);
    if (!configured) return response(503, { status: 'unavailable' });
    // Check the display token before reading account data.
    const actual = Buffer.from(request.headers.get('Authorization') || '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return response(401);
    try { return response(200, await (url.pathname === '/portfolio/history' ? portfolioHistory() : portfolio())); }
    catch (error) {
      return response(503, {
        status: 'unavailable',
        resource: error.resource,
        upstreamStatus: error.upstreamStatus,
        failure: error.failure,
      });
    }
  };
}

module.exports = { createPortfolioFeed };
