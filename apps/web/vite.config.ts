import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // #2174: the corner "Demo" badge is baked into a static OG image (scrapers
  // don't execute JS/CSS), so the operator-facing env knob is the badge's
  // own text — VITE_OG_BADGE_TEXT — not the image path. This plugin derives
  // the actual path and substitutes it into a plain (non-Vite-native)
  // %OG_IMAGE_PATH% token in index.html, keeping the env surface semantic.
  const fileEnv = loadEnv(mode, process.cwd(), '');
  const ogBadgeText = process.env.VITE_OG_BADGE_TEXT ?? fileEnv.VITE_OG_BADGE_TEXT ?? '';
  const ogImagePath = ogBadgeText ? '/og-image-demo.png' : '/og-image.png';

  return {
    plugins: [
      react(),
      {
        name: 'og-image-path',
        transformIndexHtml(html: string): string {
          return html.replace(/%OG_IMAGE_PATH%/g, ogImagePath);
        },
      },
    ],
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
  };
});
