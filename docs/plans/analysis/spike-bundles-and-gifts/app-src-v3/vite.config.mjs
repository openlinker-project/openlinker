import { defineConfig } from '/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/zestawy-gratisy-rekonesans-c15354/apps/web/node_modules/vite/dist/node/index.js';
export default defineConfig({
  root: '/tmp/claude-1000/-home-nor-projekty-blocky-openlinker-pnpm-10--claude-worktrees-zestawy-gratisy-rekonesans-c15354/52953735-93f8-46bc-a17f-aa140611c437/scratchpad/spike/app3',
  publicDir: false,
  resolve: {
    alias: [
      { find: '@web', replacement: '/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/zestawy-gratisy-rekonesans-c15354/apps/web/src' },
      { find: /^react$/, replacement: '/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/zestawy-gratisy-rekonesans-c15354/apps/web/node_modules/react' },
      { find: /^react\/jsx-runtime$/, replacement: '/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/zestawy-gratisy-rekonesans-c15354/apps/web/node_modules/react/jsx-runtime.js' },
      { find: /^react-dom\/client$/, replacement: '/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/zestawy-gratisy-rekonesans-c15354/apps/web/node_modules/react-dom/client.js' },
    ],
  },
  esbuild: { jsx: 'automatic' },
  define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('http://localhost:3000') },
  build: { outDir: '/tmp/claude-1000/-home-nor-projekty-blocky-openlinker-pnpm-10--claude-worktrees-zestawy-gratisy-rekonesans-c15354/52953735-93f8-46bc-a17f-aa140611c437/scratchpad/spike/app3/dist', emptyOutDir: true, cssCodeSplit: false, assetsInlineLimit: 0, modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: '[name][extname]' } } },
  server: { fs: { allow: ['/tmp/claude-1000/-home-nor-projekty-blocky-openlinker-pnpm-10--claude-worktrees-zestawy-gratisy-rekonesans-c15354/52953735-93f8-46bc-a17f-aa140611c437/scratchpad/spike/app3', '/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/zestawy-gratisy-rekonesans-c15354/apps/web', '/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/zestawy-gratisy-rekonesans-c15354/apps/web/../..'] } },
});
