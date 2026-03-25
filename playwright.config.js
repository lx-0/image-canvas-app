// @ts-check
const { defineConfig } = require('@playwright/test');

const E2E_PORT = 3900;

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    command: `PORT=${E2E_PORT} node src/server.js`,
    port: E2E_PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
});
