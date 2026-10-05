// Playwright config for the end-to-end approval flow (npm run test:e2e).
//
// Playwright is not a project dependency: the runner comes from a global
// install (see e2e/run.sh). The app and the worker must already be running
// with METRICOOL_FAKE=1 (README, "Test end-to-end").
const config = {
  testDir: ".",
  testMatch: /.*\.spec\.mjs$/,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "../test-results/e2e",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "it-IT",
    timezoneId: "Europe/Rome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
  },
};

export default config;
