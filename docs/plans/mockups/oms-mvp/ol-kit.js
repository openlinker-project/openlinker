/* OpenLinker mockup kit: builds the real app shell around <main data-ol-page>,
   adds a mockup bar (state switcher, theme, notes). Markup/classes mirror
   apps/web/src/app/app-shell.tsx + nav-registry.ts. */
(function(){
  var NAV = [
    ['Operations', ['Analytics','Insights','Orders','Products','Customers','Listings','Shipments','Fulfilment','Pack bench','Returns','Automations','Sales documents']],
    ['Diagnostics', ['Jobs & Logs','Webhooks','Cursors','Duplicate stock positions']],
    ['Platform', ['Connections','Adapters','Settings']],
    ['AI', ['Prompt templates','Provider settings']],
    ['Administration', ['Users']]
  ];
  var COUNTS = {'Orders':'1 284','Customers':'912','Listings':'3 406','Connections':'7','Jobs & Logs':'3'};
  function el(tag, cls, txt){ var e=document.createElement(tag); if(cls) e.className=cls; if(txt!=null) e.textContent=txt; return e; }
  function build(){
    var page = document.querySelector('[data-ol-page]'); if(!page) return;
    var active = page.getAttribute('data-active') || 'Orders';
    var group = page.getAttribute('data-crumb-group') || 'Operations';
    var crumb = page.getAttribute('data-crumb') || active;
    var shell = el('div','shell'), side = el('div','shell-sidebar');
    var brand = el('div','shell-brand'); var mark = el('span','shell-brand__mark'); mark.textContent='OL';
    brand.appendChild(mark); brand.appendChild(el('span','shell-brand__name','OpenLinker')); side.appendChild(brand);
    var nav = el('nav','shell-nav'); nav.setAttribute('aria-label','Primary');
    NAV.forEach(function(g){
      var sec = el('section','shell-nav__group'); sec.appendChild(el('p','shell-nav__label',g[0]));
      var ul = el('ul','shell-nav__list');
      g[1].forEach(function(label){
        var li = el('li'); var a = el('a','shell-nav__link' + (label===active?' shell-nav__link--active':''));
        a.href='#'; a.addEventListener('click',function(e){e.preventDefault();});
        a.appendChild(el('span','shell-nav__link-label',label));
        if(COUNTS[label]) a.appendChild(el('span','shell-nav__link-count mono-text',COUNTS[label]));
        li.appendChild(a); ul.appendChild(li);
      });
      sec.appendChild(ul); nav.appendChild(sec);
    });
    side.appendChild(nav);
    var main = el('div','shell-main'), top = el('header','shell-topbar');
    var crumbs = el('nav','shell-crumbs'); crumbs.setAttribute('aria-label','Breadcrumb');
    crumbs.appendChild(el('span','shell-crumbs__group',group));
    crumbs.appendChild(el('span','shell-crumbs__sep','/'));
    crumbs.appendChild(el('span','shell-crumbs__current',crumb));
    top.appendChild(crumbs); top.appendChild(el('div','shell-topbar__spacer'));
    var alerts = el('button','button button--ghost shell-topbar__alerts','Alerts 0'); alerts.type='button'; top.appendChild(alerts);
    var chip = el('button','shell-user-chip'); chip.type='button';
    chip.appendChild(el('span','shell-user-chip__avatar','A')); chip.appendChild(el('span','shell-user-chip__name','admin')); top.appendChild(chip);
    var content = el('main','shell-content');
    page.parentNode.insertBefore(shell, page);
    content.appendChild(page); main.appendChild(top); main.appendChild(content);
    shell.appendChild(side); shell.appendChild(main);
  }
  function bar(){
    var b = el('div','mk-bar'); b.appendChild(el('b',null,document.title));
    var states = Array.prototype.slice.call(document.querySelectorAll('[data-mk-state]'));
    var wrap = el('div','mk-bar__states');
    function show(name){
      states.forEach(function(s){ s.hidden = s.getAttribute('data-mk-state') !== name; });
      Array.prototype.forEach.call(wrap.children,function(btn){ btn.setAttribute('aria-pressed', btn.dataset.s===name?'true':'false'); });
      try{ history.replaceState(null,'','#'+name); }catch(e){}
    }
    states.forEach(function(s){
      var name = s.getAttribute('data-mk-state');
      var btn = el('button',null,s.getAttribute('data-mk-label')||name); btn.type='button'; btn.dataset.s=name;
      btn.addEventListener('click',function(){show(name);}); wrap.appendChild(btn);
    });
    if(states.length){ b.appendChild(el('span',null,'Stan:')); b.appendChild(wrap); }
    b.appendChild(el('span','mk-bar__spacer'));
    var theme = el('button',null,'Motyw'); theme.type='button';
    theme.addEventListener('click',function(){ var h=document.documentElement; h.setAttribute('data-theme', h.getAttribute('data-theme')==='dark'?'light':'dark'); });
    b.appendChild(theme);
    if(document.querySelector('.mk-notes')){
      var n = el('button',null,'Adnotacje'); n.type='button'; n.setAttribute('aria-pressed','true');
      n.addEventListener('click',function(){ var off=document.body.classList.toggle('mk-hide-notes'); n.setAttribute('aria-pressed', off?'false':'true'); });
      b.appendChild(n);
    }
    document.body.insertBefore(b, document.body.firstChild);
    if(states.length){
      var h = location.hash.replace('#',''); var ok = states.some(function(s){return s.getAttribute('data-mk-state')===h;});
      show(ok ? h : states[0].getAttribute('data-mk-state'));
      // `location.hash` is only ever read here, at load — a caller that
      // changes the hash on an already-open page (e.g. an e2e page object
      // driving several states off one document without a full reload)
      // otherwise leaves the FIRST state showing forever, silently, since
      // nothing re-derives the hash afterwards. `history.replaceState` in
      // `show()` does not itself fire `hashchange` (only a real navigation
      // or a `location.hash` assignment does), so this listener and that
      // call never re-trigger each other.
      window.addEventListener('hashchange', function(){
        var next = location.hash.replace('#','');
        var known = states.some(function(s){return s.getAttribute('data-mk-state')===next;});
        if(known) show(next);
      });
    }
  }
  function init(){ build(); bar(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
