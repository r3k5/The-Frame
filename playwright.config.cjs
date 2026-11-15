// Runs launcher integration tests against the local preview server.
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1920, height: 1080 } },
  webServer: { command: 'node tools/serve.cjs', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
  reporter: 'list'
});
