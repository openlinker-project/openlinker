#!/usr/bin/env bash
# Build the prototype and assemble one self-contained HTML file. Usage: bash build.sh
set -e
# Paths are relative to this script: P = this prototype folder, W = the repo root.
P="$(cd "$(dirname "$0")" && pwd)"
W="$(cd "$P/../../../../.." && pwd)"
cd "$W/apps/web" && ./node_modules/.bin/vite build --config "$P/vite.config.mjs" 2>&1 | grep -E "built in|error|Error" | grep -v "Could not resolve 'esbuild'"
python3 -I - "$P/dist" "$P/zestawy-i-gratisy-v1.html" <<'PY'
import re, sys
d, out = sys.argv[1], sys.argv[2]
css = re.sub(r'@font-face\s*\{[^}]*\}', '', open(f'{d}/style.css', encoding='utf-8').read())
js = open(f'{d}/app.js', encoding='utf-8').read().replace('</script', '<\\/script')
open(out, 'w', encoding='utf-8').write(f'''<title>Zestawy i gratisy v1</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>{css}</style>
<div id="spike-root"></div>
<script type="module">{js}</script>
''')
print('html', round(len(open(out,encoding='utf-8').read())/1024), 'KB')
PY
