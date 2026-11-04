import json,sys,re,html,urllib.request,urllib.parse
def req(u,data=None):
    r=urllib.request.Request(u,data=data,headers={"User-Agent":"Mozilla/5.0"})
    return urllib.request.urlopen(r,timeout=30).read().decode("utf-8","replace")
def text(h):
    h=re.sub(r'<(script|style)[^>]*>.*?</\1>','',h,flags=re.S)
    h=re.sub(r'<img[^>]*?alt="([^"]*)"[^>]*>',r'[IMG:\1]',h)
    h=re.sub(r'<br\s*/?>|</p>|</li>|</h\d>|</tr>','\n',h)
    h=re.sub(r'<li[^>]*>','- ',h); h=re.sub(r'<h(\d)[^>]*>',lambda m:'#'*int(m.group(1))+' ',h)
    h=re.sub(r'<[^>]+>','',h); h=html.unescape(h)
    return re.sub(r'[ \t]+',' ',re.sub(r'\n\s*\n+','\n',h)).strip()
for slug in sys.argv[1:]:
    d=json.loads(req(f"https://sellasist.pl/wp-json/wp/v2/help?slug={slug}"))
    if not d: print("### NONE",slug); continue
    p=d[0]
    body=urllib.parse.urlencode({"action":"get_page_sections","post_id":p["id"]}).encode()
    try:
        r=json.loads(req("https://sellasist.pl/wp-admin/admin-ajax.php",body))
        t=text(r["data"]["html"]) if r.get("success") else "FAIL "+str(r)[:200]
    except Exception as e: t="ERR "+str(e)
    print("#####",html.unescape(p["title"]["rendered"]),"|",p["link"],"| modified",p["modified"][:10]); print(t[:12000]); print()
