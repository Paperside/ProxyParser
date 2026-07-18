import { defineConfig } from "@playwright/test";

const backendPort = 7311;
const frontendPort = 7312;
const databasePath = `/tmp/proxyparser-e2e-${process.pid}-${Date.now()}.sqlite`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: [
    {
      command: "bun run --cwd backend start",
      url: `http://127.0.0.1:${backendPort}/api/health`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(backendPort),
        PUBLIC_BASE_URL: `http://127.0.0.1:${backendPort}`,
        DATABASE_PATH: databasePath,
        JWT_SECRET: "e2e-only-secret-not-for-production",
        LATENCY_TEST_URL: "http://127.0.0.1:7313/generate_204"
      }
    },
    {
      command: `bunx vite --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      url: `http://127.0.0.1:${frontendPort}`,
      cwd: "frontend",
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        VITE_API_BASE_URL: `http://127.0.0.1:${backendPort}`
      }
    }
  ]
});
