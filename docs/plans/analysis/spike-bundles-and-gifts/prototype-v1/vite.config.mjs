// Paths are relative to this file: R = this prototype folder, W = the repo root.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from '../../../../../apps/web/node_modules/vite/dist/node/index.js';
const R = fileURLToPath(new URL('.', import.meta.url));
const W = resolve(R, '../../../../..');
export default defineConfig({
  root: R,
  publicDir: false,
  resolve: {
    alias: [
      { find: '@web', replacement: W + '/apps/web/src' },
      { find: /^react$/, replacement: W + '/apps/web/node_modules/react' },
      { find: /^react\/jsx-runtime$/, replacement: W + '/apps/web/node_modules/react/jsx-runtime.js' },
      { find: /^react-dom\/client$/, replacement: W + '/apps/web/node_modules/react-dom/client.js' },
      { find: /^react-dom$/, replacement: W + '/apps/web/node_modules/react-dom' },
      { find: /^react-router-dom$/, replacement: W + '/apps/web/node_modules/react-router-dom' },
      { find: /^@tanstack\/react-query$/, replacement: W + '/apps/web/node_modules/@tanstack/react-query' },
    ],
  },
  esbuild: { jsx: 'automatic' },
  define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('http://localhost:3000'), __APP_VERSION__: JSON.stringify('prototype') },
  build: { outDir: resolve(R, 'dist'), emptyOutDir: true, cssCodeSplit: false, assetsInlineLimit: 0, modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: '[name][extname]' } } },
});
