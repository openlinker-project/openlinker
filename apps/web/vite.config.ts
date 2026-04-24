import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
  },
  test: {
    environment: 'happy-dom',
    // Self-hosted CI runner (added 2026-04 via 444244f) is materially slower
    // than ubuntu-latest; RTL tests with multiple async state transitions
    // (wizards, dialogs + API calls, nested queries) can exceed the 5000ms
    // vitest default. Local runs complete in 2–3s per test; CI stretches
    // each transform/import pass by ~20×. Bumping to 10s keeps hangs
    // failing visibly while accommodating the runner.
    testTimeout: 10000,
    teardownTimeout: 10000,
    setupFiles: './src/test/setup.ts',
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
