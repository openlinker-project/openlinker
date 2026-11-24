#!/bin/bash
# usage: dl.sh topic  -> prints text
t=$1; f=docs/$t.html
curl -sL -A "Mozilla/5.0" "https://docs.linnworks.com/article/documentation/$t" -o "$f"
python3 -I -c "
import re,html,sys
t=open('$f',encoding='utf-8',errors='ignore').read()
m=re.search(r'<title>(.*?)</title>',t,re.S); print('=== $t |', m.group(1).strip() if m else '')
t=re.sub(r'<script.*?</script>|<style.*?</style>','',t,flags=re.S)
t=re.sub(r'<(br|/p|/li|/tr|/h[1-6]|li)[^>]*>','\n',t)
s=html.unescape(re.sub(r'<[^>]+>',' ',t))
s=re.sub(r'[ \t]+',' ',s); s=re.sub(r'\n\s*\n+','\n',s)
print(s)
"
