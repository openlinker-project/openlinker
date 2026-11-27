import re,sys,html
t=open(sys.argv[1],encoding='utf-8',errors='ignore').read()
m=re.search(r'<title>(.*?)</title>',t,re.S); print('==', m.group(1).strip() if m else '')
s=t
i=s.find('Modified on'); 
if i>0: s=s[i:]
s=re.sub(r'<script.*?</script>|<style.*?</style>','',s,flags=re.S)
s=re.sub(r'<[^>]+>',' ',s); s=html.unescape(re.sub(r'\s+',' ',s))
j=s.find('Did you find it helpful')
print(s[:j if j>0 else int(sys.argv[2]) if len(sys.argv)>2 else 6000][:int(sys.argv[2]) if len(sys.argv)>2 else 8000])
