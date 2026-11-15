// Adapts the shared portfolio feed to the Cloudflare Worker runtime.
import feed from './portfolio-feed.cjs';

// Keep each Worker environment’s credentials and in-memory cache separate.
const handlers = new WeakMap();

export default {
  fetch(request, env) {
    let handler = handlers.get(env);
    if (!handler) {
      handler = feed.createPortfolioFeed(env);
      handlers.set(env, handler);
    }
    return handler(request);
  },
};
