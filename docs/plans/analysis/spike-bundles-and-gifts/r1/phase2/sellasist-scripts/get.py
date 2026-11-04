import json,sys,re,html,urllib.request
def get(u):
    r=urllib.request.Request(u,headers={"User-Agent":"Mozilla/5.0"})
    return urllib.request.urlopen(r,timeout=30).read().decode("utf-8","replace")
def text(h):
    h=re.sub(r'<(script|style)[^>]*>.*?</\1>','',h,flags=re.S)
    h=re.sub(r'<img[^>]*alt="([^"]*)"[^>]*>',r'[IMG:\1]',h)
    h=re.sub(r'<br\s*/?>|</p>|</li>|</h\d>|</div>','\n',h)
    h=re.sub(r'<li[^>]*>','- ',h)
    h=re.sub(r'<[^>]+>','',h)
    h=html.unescape(h)
    return re.sub(r'\n\s*\n+','\n',h).strip()
mode=sys.argv[1]
if mode=="search":
    for q in sys.argv[2:]:
        d=json.loads(get(f"https://sellasist.pl/wp-json/wp/v2/search?search={urllib.parse.quote(q)}&per_page=100&subtype=help"))
        print("==",q,len(d))
        for x in d: print(x["id"],html.unescape(x["title"]),x["url"])
else:
    for slug in sys.argv[2:]:
        d=json.loads(get(f"https://sellasist.pl/wp-json/wp/v2/help?slug={slug}"))
        if not d: print("### NONE",slug); continue
        p=d[0]
        c=p.get("content",{}).get("rendered","")
        print("#####",html.unescape(p["title"]["rendered"]),p["link"],"modified",p["modified"])
        t=text(c)
        if len(t)<50:
            hp=get(p["link"])
            m=re.search(r'<article.*?</article>',hp,flags=re.S) or re.search(r'<main.*?</main>',hp,flags=re.S)
            t="(from html) "+text(m.group(0) if m else hp)[:8000]
        print(t[:9000]); print()
