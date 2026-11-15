// Serves the portfolio feed over loopback for a local HTTPS reverse proxy.
const { createServer } = require('node:http');
const { createPortfolioFeed } = require('./portfolio-feed.cjs');

// Concurrent local requests can share a single pending balance lookup.
const handlePortfolio = createPortfolioFeed(process.env, { coalesce: true });
const port = Number(process.env.FRAME_PORTFOLIO_PORT || 4180);
createServer(async (request, response) => {
  const result = await handlePortfolio(new Request(new URL(request.url, 'http://127.0.0.1'), {
    method: request.method,
    headers: request.headers,
  }));
  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(await result.text());
}).listen(port, '127.0.0.1', () => console.log('Portfolio service listening on loopback.'));
