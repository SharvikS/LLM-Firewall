import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_DASHBOARD_PORT ?? 3100);
const gatewayPort = Number(process.env.PLAYWRIGHT_GATEWAY_PORT ?? 18080);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
  },
  webServer: {
    command: [
      `NEXT_TELEMETRY_DISABLED=1`,
      `NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:${gatewayPort}`,
      `ADMIN_TOKEN=playwright-admin-token`,
      `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    ].join(' '),
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
