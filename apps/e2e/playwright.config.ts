/**
 * Playwright configuration
 *
 * Projects:
 *   - `setup`        — logs in once, writes `.auth/admin.json` (auth artifact).
 *   - `smoke`        — read-only substrate proof (health + login + connections).
 *   - `golden-path`  — the S1-S4 operator-setup flow; serial (`workers: 1`) so
 *                      the mutating steps don't interleave.
 *   - `full-flow`    — the attended S0-S9 full golden path across all 6 systems;
 *                      serial, `retries: 0` (a re-run would double-mutate), driven
 *                      headed in a coordinated operator session.
 *   - `access-control` — demo mode, registration, RBAC, and UI-reflection checks.
 *                      Self-configuring (asserts correct-for-mode, skips otherwise);
 *                      independent of the golden-path projects. `retries: 1`
 *                      (idempotent: each run provisions a fresh unique viewer).
 *
 * Reporters: html + list. Retries are per-project: read-only projects (setup,
 * smoke) retry once; the mutating golden-path project runs with `retries: 0` —
 * a silent retry would double-mutate the stack (publish twice, create offers
 * twice). Trace/video/screenshot retained on failure.
 *
 * @module playwright.config
 */
import { defineConfig, devices } from '@playwright/test';
import { resolveEnv } from './src/config/env';

const env = resolveEnv();

/** Shared browser session artifact written by the `setup` project. */
export const STORAGE_STATE = '.auth/admin.json';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: env.webUrl,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      retries: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'smoke',
      testMatch: /smoke\/.*\.spec\.ts/,
      retries: 1,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      // Mutating project — never retried (a retry would double-mutate).
      name: 'golden-path',
      testMatch: /golden-path\/operator-setup\.spec\.ts/,
      retries: 0,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      // Attended S0-S9 run. `retries: 0` — the flow mutates external systems, so
      // a silent retry would double-buy / double-issue. Run headed via
      // `--project=full-flow --headed`.
      name: 'full-flow',
      testMatch: /golden-path\/full-flow\.spec\.ts/,
      retries: 0,
      // The attended flow waits on worker jobs (up to 300 s), manual dashboard
      // checkpoints and the purchase pause (up to 30 min) — the global 90 s
      // per-test timeout would kill S0 before the first sync completes.
      timeout: 40 * 60_000,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      // Access-control coverage — independent of golden-path/full-flow. Depends
      // only on `setup` for the admin storageState the UI-reflection spec's
      // admin-session assertions consume; the viewer/guest browser cases build
      // their own fresh contexts. `retries: 1` is safe — every run provisions a
      // fresh, uniquely-named viewer (no double-mutation of shared state).
      name: 'access-control',
      testMatch: /access-control\/.*\.spec\.ts/,
      retries: 1,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
  ],
});
