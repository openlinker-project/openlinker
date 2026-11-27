#!/usr/bin/env bash
# Build app4 and assemble one self-contained HTML file. Usage: bash build.sh
set -e
S=/tmp/claude-1000/-home-nor-projekty-blocky-openlinker-pnpm-10--claude-worktrees-zestawy-gratisy-rekonesans-c15354/52953735-93f8-46bc-a17f-aa140611c437/scratchpad/spike
W=/home/nor/projekty/blocky/openlinker-pnpm-10/.claude/worktrees/zestawy-gratisy-rekonesans-c15354
cd $W/apps/web && ./node_modules/.bin/vite build --config $S/app4/vite.config.mjs 2>&1 | grep -E "built in|error|Error" | grep -v "Could not resolve 'esbuild'"
python3 -I - "$S/app4/dist" "$S/zestawy-i-gratisy-ux.html" <<'PY'
import re, sys
d, out = sys.argv[1], sys.argv[2]
css = re.sub(r'@font-face\s*\{[^}]*\}', '', open(f'{d}/style.css', encoding='utf-8').read())
js = open(f'{d}/app.js', encoding='utf-8').read().replace('</script', '<\\/script')
open(out, 'w', encoding='utf-8').write(f'''<title>Zestawy i gratisy w praktyce</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>{css}</style>
<div id="spike-root"></div>
<script type="module">{js}</script>
''')
print('html', round(len(open(out,encoding='utf-8').read())/1024), 'KB')
PY
