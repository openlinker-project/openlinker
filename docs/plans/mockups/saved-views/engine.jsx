const { useState, useMemo, useEffect, useRef } = React;

/* ---------- icons ---------- */
const P = {
  search:'M7 12.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11zM11 11l3.5 3.5', right:'M6 3l5 5-5 5', plus:'M8 3v10M3 8h10', x:'M4 4l8 8M12 4l-8 8',
  filters:'M2 4h12M4 8h8M6 12h4', sliders:'M2 5h7M12 5h2M2 11h2M7 11h7M9 3v4M4 9v4',
  lock:'M4 7V5a4 4 0 118 0v2M3 7h10v7H3z', up:'M4 10l4-4 4 4', grip:'M6 3.5h.01M10 3.5h.01M6 8h.01M10 8h.01M6 12.5h.01M10 12.5h.01', sort:'M5 3v10M2.5 10.5L5 13l2.5-2.5M11 13V3M8.5 5.5L11 3l2.5 2.5', down:'M4 6l4 4 4-4', dots:'M3 8h.01M8 8h.01M13 8h.01', menu:'M2 4h12M2 8h12M2 12h12',
  warn:'M8 2l6.5 11.5h-13zM8 6.5v3.2M8 11.4v.01', refresh:'M13 3v4H9M3 13V9h4M3.5 7A5 5 0 0112 4.5L13 7M12.5 9A5 5 0 014 11.5L3 9',
};
const Ic = ({ n, s = 14, fill }) => <svg width={s} height={s} viewBox="0 0 16 16" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[n]} /></svg>;
const Logo = () => <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><rect width="26" height="26" rx="6" fill="oklch(24% .02 60)"/><path d="M8 17.5c-2-1.8-2-5 0-6.8 1.4-1.2 3.4-1.2 4.8 0l1.6 1.4M18 8.5c2 1.8 2 5 0 6.8-1.4 1.2-3.4 1.2-4.8 0l-1.6-1.4" fill="none" stroke="oklch(72% .18 50)" strokeWidth="2.2" strokeLinecap="round"/></svg>;

/* ---------- helpers ---------- */
function useOutside(open, close, onEscape) {
  const ref = useRef(null);
  const esc = useRef(onEscape); esc.current = onEscape;
  useEffect(() => {
    if (!open) return;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const key = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); (esc.current || close)(); } };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  return ref;
}
function useRestoreFocus() { useEffect(() => { const prev = document.activeElement; return () => { if (prev && prev.focus) prev.focus(); }; }, []); }
function useFocusTrap(ref) {
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea,[tabindex]:not([tabindex="-1"])';
    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const f = Array.from(el.querySelectorAll(sel)).filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);
}
function useNarrow() {
  const [n, setN] = useState(typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => { const f = () => setN(window.innerWidth < 768); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  return n;
}
function Btn({ tone, size, className = '', ...p }) { return <button type="button" className={['button', tone ? 'button--' + tone : '', size ? 'button--' + size : '', className].filter(Boolean).join(' ')} {...p} />; }
const badge = (tone, label, dot) => <span className={'status-badge' + (tone ? ' status-badge--' + tone : '')}>{dot && <span className="status-badge__dot" />}{label}</span>;
const Chip = ({ children }) => <span className="chip">{children}</span>;
const IdChip = ({ id, copy = true }) => <span className="idrow2"><span className="idchip">{id}</span>{copy && <button type="button" className="copy hov">Copy</button>}</span>;
const Tile = ({ t }) => <span className="thumb">{String(t)[0]}</span>;
const Dot = ({ c }) => <span className="cdot" style={{ '--channel': c }} />;
const chanColor = (n) => ({ Allegro: 'var(--channel-allegro)', PrestaShop: 'var(--channel-prestashop)', Shopify: 'var(--channel-shopify)', WooCommerce: 'var(--channel-woocommerce)' })[n] || 'var(--text-muted)';
const SortArrow = ({ on, dir }) => <span className={'sarr' + (on ? ' on' : '') + (on && dir === 'desc' ? ' desc' : '')} aria-hidden="true"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 8.5V1.5M2 4.5l3-3 3 3" /></svg></span>;
function SortField({ s, set, k, label }) { const on = s.key === k; return <button type="button" className={'sortbtn2' + (on ? ' act' : '')} aria-label={label + (on ? ', sorted ' + (s.dir === 'asc' ? 'ascending' : 'descending') : ', sort')} onClick={() => set(k)}><span className="stxt">{label}</span><SortArrow on={on} dir={s.dir} /></button>; }
const Stack = ({ s, set, items, end }) => <span className={'sortstack' + (end ? ' end' : '')}>{items.map(([k, l]) => k ? <SortField key={l} s={s} set={set} k={k} label={l} /> : <span key={l} className="sortbtn2 static">{l}</span>)}</span>;

/* ---------- generic view logic (config driven) ---------- */
const sig = (d) => JSON.stringify([d.f, d.sort.key, d.sort.dir, d.columns, d.parts || {}]);
/* multi-field columns: which fields a column shows, and in what order */
const partIds = (c) => c.parts.map((p) => p.id);
const partsOf = (c, d) => { const ids = (d.parts || {})[c.id]; return (ids || partIds(c)).map((id) => c.parts.find((p) => p.id === id)).filter(Boolean); };
const setPartsIn = (c, d, ids) => { const parts = { ...(d.parts || {}) }; if (ids.join() === partIds(c).join()) delete parts[c.id]; else parts[c.id] = ids; return { ...d, parts }; };
const colHead = (c, d, s, set) => {
  if (!c.parts) return typeof c.head === 'function' ? c.head(s, set) : null;
  const vis = partsOf(c, d); if (!vis.some((p) => p.sort)) return null;
  return <Stack end={c.right} s={s} set={set} items={vis.filter((p) => p.hl).map((p) => [p.sort || null, p.hl])} />;
};
const colCell = (c, d, r) => c.parts ? <>{partsOf(c, d).map((p) => <React.Fragment key={p.id}>{p.cell(r)}</React.Fragment>)}</> : c.cell(r);
function matches(cfg, row, f) {
  return Object.entries(f).every(([k, v]) => {
    if (v === '' || v === false || v === undefined) return true;
    const fc = cfg.filters.find((x) => x.key === k);
    return fc && fc.test ? fc.test(row, v) : row[k] === v;
  });
}
function run(cfg, d, search) {
  const q = search.trim().toLowerCase();
  const out = cfg.rows.filter((r) => matches(cfg, r, d.f) && (!q || !cfg.search || cfg.search(r, q)));
  const f = cfg.cmp[d.sort.key] || cfg.cmp[cfg.defaultSort.key];
  out.sort((a, b) => { const x = f(a), y = f(b); const r = x < y ? -1 : x > y ? 1 : 0; return d.sort.dir === 'asc' ? r : -r; });
  return out;
}
const sortLabel = (cfg, s) => (cfg.sorts.find((x) => x.key === s.key && x.dir === s.dir) || { label: s.key + (s.dir === 'asc' ? ', ascending' : ', descending') }).label;
const optLabel = (fc, v) => { const o = (fc.options || []).find((x) => x[0] === v); return o ? o[1] : String(v); };
function reconcile(cfg, d) {
  const issues = []; let columns = [];
  const colIds = cfg.columns.map((c) => c.id);
  d.columns.forEach((id) => { if (colIds.includes(id)) columns.push(id); else issues.push('Column “' + id + '” no longer exists.'); });
  if (!columns.length) columns = cfg.defCols;
  const parts = {};
  Object.entries(d.parts || {}).forEach(([cid, ids]) => { const c = cfg.columns.find((x) => x.id === cid); if (!c || !c.parts) return; const ok = ids.filter((id) => c.parts.some((p) => p.id === id)); if (ids.length !== ok.length) issues.push('A field of “' + c.label + '” no longer exists.'); if (ok.length && ok.join() !== partIds(c).join()) parts[cid] = ok; });
  const f = {};
  Object.entries(d.f).forEach(([k, v]) => {
    const fc = cfg.filters.find((x) => x.key === k);
    if (fc && fc.options && !fc.options.some((o) => o[0] === v)) issues.push(fc.label + ' “' + v + '” no longer exists, so this view now shows every ' + fc.label.toLowerCase() + '.');
    else f[k] = v;
  });
  let sort = d.sort;
  if (!cfg.cmp[sort.key]) { issues.push('Sort field no longer exists, using “' + sortLabel(cfg, cfg.defaultSort) + '”.'); sort = cfg.defaultSort; }
  return { def: { ...d, columns, f, sort, parts }, issues };
}
function changes(a, b) {
  const out = [];
  if (JSON.stringify(a.f) !== JSON.stringify(b.f)) out.push('Filters');
  if (a.sort.key !== b.sort.key || a.sort.dir !== b.sort.dir) out.push('Sort');
  if (a.columns.join() !== b.columns.join()) out.push('Columns');
  else if (JSON.stringify(a.parts || {}) !== JSON.stringify(b.parts || {})) out.push('Fields');
  return out;
}
const toQuery = (cfg, d) => '?' + Object.entries(d.f).filter(([, v]) => v !== '' && v !== false).map(([k, v]) => k + '=' + (v === true ? '1' : encodeURIComponent(v))).concat('sort=' + d.sort.key + ':' + d.sort.dir).join('&');
const uniqueName = (base, views) => { let n = base, i = 2; while (views.some((v) => v.name.toLowerCase() === n.toLowerCase())) { n = base.replace(/ \(copy.*\)$/, '') + ' (copy ' + i + ')'; i++; } return n; };

/* ---------- Views menu ---------- */
function AllViews({ cfg, views, pinned, active, defaultId, role, locked, onSelect, onPin, onDefault, onDuplicate, onRename, onDelete, onNew }) {
  const [open, setOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState(null);
  const ref = useOutside(open, () => { setOpen(false); setRowMenu(null); }, () => { if (rowMenu) setRowMenu(null); else setOpen(false); });
  const canEdit = (v) => v.scope === 'personal' || (v.scope === 'shared' && role === 'admin');
  const close = () => { setOpen(false); setRowMenu(null); };
  const hidden = views.filter((v) => !pinned.includes(v.id)).length;
  const groups = cfg.userViews ? [['system', 'Built-in'], ['shared', 'Shared'], ['personal', 'Mine']] : [['system', 'Built-in']];
  return (
    <div className="rel" ref={ref} style={{ alignSelf: 'center', marginBottom: 2 }}>
      <button type="button" className="button button--ghost button--sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>Views{hidden > 0 && <span className="hint">{hidden}</span>}<Ic n="down" s={11} /></button>
      {open && (
        <div className="menu menu--right" role="dialog" aria-label="Views" style={{ minWidth: 320 }}>
          {groups.map(([scope, label]) => (
            <div key={scope}>
              <div className="menu__label">{label}</div>
              {views.filter((v) => v.scope === scope).length === 0 && <div className="menu__note">None yet.</div>}
              {views.filter((v) => v.scope === scope).map((v) => (
                <div key={v.id} className="vrow">
                  <button type="button" className="menu__item" aria-current={v.id === active.id} onClick={() => { onSelect(v.id); close(); }}>
                    <span className="name">{v.name}</span>{v.id === defaultId && <span className="hint">Default</span>}
                  </button>
                  {cfg.userViews && <button type="button" className="more" aria-label={'Actions for ' + v.name} aria-expanded={rowMenu === v.id} onClick={() => setRowMenu(rowMenu === v.id ? null : v.id)}><Ic n="dots" /></button>}
                  {rowMenu === v.id && (
                    <div className="sub" role="menu" aria-label={v.name}>
                      {!locked.includes(v.id) && <button type="button" role="menuitem" className="menu__item" onClick={() => { onPin(v.id); close(); }}>{pinned.includes(v.id) ? 'Unpin from strip' : 'Pin to strip'}</button>}
                      <button type="button" role="menuitem" className="menu__item" onClick={() => { onDefault(v.id); close(); }}>{v.id === defaultId ? 'Default for me ✓' : 'Open by default'}</button>
                      <button type="button" role="menuitem" className="menu__item" onClick={() => { onDuplicate(v.id); close(); }}>Duplicate to mine</button>
                      {canEdit(v) && <button type="button" role="menuitem" className="menu__item" onClick={() => { onRename(v.id); close(); }}>Rename</button>}
                      {canEdit(v) && <button type="button" role="menuitem" className="menu__item danger" onClick={() => { onDelete(v.id); close(); }}>Delete</button>}
                    </div>)}
                </div>))}
            </div>))}
          {cfg.userViews && <><div className="menu__sep" /><button type="button" className="menu__item" onClick={() => { onNew(); close(); }}><Ic n="plus" /><span className="name">Save current filters as new view…</span></button></>}
        </div>
      )}
    </div>
  );
}

/* ---------- side panels ---------- */
function SidePanel({ title, onClose, footer, children }) {
  const ref = useRef(null);
  useFocusTrap(ref); useRestoreFocus();
  useEffect(() => { const k = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose(); } }; document.addEventListener('keydown', k); const first = ref.current && ref.current.querySelector('select,input,button'); if (first) first.focus(); return () => document.removeEventListener('keydown', k); }, []);
  return (
    <>
      <div className="panel-scrim" onMouseDown={onClose} />
      <div className="panel" ref={ref} role="dialog" aria-modal="true" aria-label={title}>
        <div className="panel__head"><span>{title}</span><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Ic n="x" /></button></div>
        <div className="panel__body">{children}</div>
        <div className="panel__foot">{footer}</div>
      </div>
    </>
  );
}
/* drag and drop reordering (mouse) + Arrow keys on the grip (keyboard) */
function useDnd(onMove) {
  const [from, setFrom] = useState(null); const [over, setOver] = useState(null);
  const [flash, setFlash] = useState(null);
  const end = () => { setFrom(null); setOver(null); };
  const mv = (f, t) => { onMove(f, t); setFlash(t); setTimeout(() => setFlash(null), 700); };
  return {
    from, over, move: mv,
    row: (i) => ({ draggable: true, onDragStart: (ev) => { setFrom(i); ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', String(i)); } catch (x) {} }, onDragOver: (ev) => { if (from === null) return; ev.preventDefault(); setOver(i); }, onDrop: (ev) => { ev.preventDefault(); if (from !== null && from !== i) mv(from, i); end(); }, onDragEnd: end }),
    cls: (i) => (flash === i ? ' flash' : '') + (from === i ? ' dragging' : '') + (over === i && from !== null && from !== i ? (from < i ? ' drop-after' : ' drop-before') : ''),
    key: (i) => (ev) => { if (ev.key === 'ArrowUp') { ev.preventDefault(); mv(i, i - 1); } else if (ev.key === 'ArrowDown') { ev.preventDefault(); mv(i, i + 1); } },
  };
}
const MoveBtns = ({ label, i, n, move }) => <><button type="button" className="icon-btn mv" aria-label={'Move ' + label + ' up'} disabled={i === 0} onClick={() => move(i, i - 1)}><Ic n="up" /></button><button type="button" className="icon-btn mv" aria-label={'Move ' + label + ' down'} disabled={i === n - 1} onClick={() => move(i, i + 1)}><Ic n="down" /></button></>;
const Grip = ({ label, onKeyDown }) => <button type="button" className="grip" aria-label={label + '. Drag, or use Arrow Up and Arrow Down.'} onKeyDown={onKeyDown}><Ic n="grip" s={14} /></button>;
const reorder = (a, f, t) => { if (t < 0 || t >= a.length) return a; const n = a.slice(); const [x] = n.splice(f, 1); n.splice(t, 0, x); return n; };
function PartsEditor({ c, cur, patch, say }) {
  const vis = partsOf(c, cur); const visIds = vis.map((p) => p.id);
  const off = c.parts.filter((p) => !visIds.includes(p.id));
  const set = (ids) => patch(setPartsIn(c, cur, ids));
  const dnd = useDnd((f, t) => { if (t < 0 || t >= visIds.length) return; set(reorder(visIds, f, t)); say(vis[f].label + ' is now line ' + (t + 1) + ' of ' + visIds.length + ' in ' + c.label + '.'); });
  return (
    <div className="partlist" onDragStart={(x) => x.stopPropagation()} onDragOver={(x) => x.stopPropagation()} onDrop={(x) => x.stopPropagation()} onDragEnd={(x) => x.stopPropagation()} role="group" aria-label={'Fields in ' + c.label}>
      <span className="partlist__hint">Shown top to bottom in each cell</span>
      {vis.map((p, i) => (
        <div className={'colrow colrow--sub' + dnd.cls(i)} key={p.id} {...dnd.row(i)}>
          <Grip label={'Move ' + p.label} onKeyDown={dnd.key(i)} />
          <label><input type="checkbox" checked disabled={vis.length === 1} onChange={() => set(visIds.filter((x) => x !== p.id))} /><span className="fld"><b>{p.label}</b></span>{p.sort && <span className="sortable" title="Sortable from the column header"><Ic n="sort" s={12} /></span>}</label>
          <MoveBtns label={p.label} i={i} n={vis.length} move={dnd.move} />
        </div>))}
      {off.map((p) => <div className="colrow colrow--sub colrow--off" key={p.id}><span className="grip grip--ph" /><label><input type="checkbox" checked={false} onChange={() => set(visIds.concat(p.id))} /><span className="fld"><b>{p.label}</b></span></label></div>)}
      {vis.length === 1 && <span className="partlist__hint">A column keeps at least one field. Untick the column itself to hide it.</span>}
    </div>
  );
}
function ColumnsSort({ cfg, cur, patch }) {
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState('');
  const [open2, setOpen2] = useState(null);
  const cols = cur.columns; const L = cfg.locked;
  const hidden = cfg.columns.filter((c) => !cols.includes(c.id));
  const get = (id) => cfg.columns.find((c) => c.id === id);
  const setCols = (c) => patch({ columns: c });
  const dnd = useDnd((f, t) => { if (t < 0 || t >= cols.length) return; setCols(reorder(cols, f, t)); setLive(get(cols[f]).label + ' moved to position ' + (t + 2) + ' of ' + (cols.length + 1) + '.'); });
  const sortVal = cur.sort.key + ':' + cur.sort.dir;
  const known = cfg.sorts.some((x) => x.key + ':' + x.dir === sortVal);
  return (
    <>
      <button type="button" className="button button--secondary button--sm" style={{ height: '2rem' }} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Ic n="sliders" s={14} />Columns &amp; sort</button>
      {open && (
        <SidePanel title="Columns & sort" onClose={() => setOpen(false)}
          footer={<><Btn tone="secondary" onClick={() => patch({ columns: cfg.defCols, sort: cfg.defaultSort, parts: {} })}>Restore defaults</Btn><Btn onClick={() => setOpen(false)}>Done</Btn></>}>
          <div className="panel__sec">
            <div className="field"><label className="field__label" htmlFor="cs-sort">Sort</label>
              <select id="cs-sort" className="control" value={known ? sortVal : ''} onChange={(e) => { const [key, dir] = e.target.value.split(':'); patch({ sort: { key, dir } }); }}>
                {!known && <option value="">{sortLabel(cfg, cur.sort)}</option>}
                {cfg.sorts.map((x) => <option key={x.label} value={x.key + ':' + x.dir}>{x.label}</option>)}</select>
              <span className="field__hint">You can also click a field in a column header.</span></div>
          </div>
          <div className="panel__sec">
            <div className="field__label" style={{ marginBottom: 6 }}>Columns</div>
            <div className="colrow colrow--locked"><label><Ic n="lock" s={13} /><span className="fld"><b>{L.label}</b><span>{L.fields}</span></span></label><span className="hint">Always</span></div>
            {cols.map((id, i) => { const c = get(id); const vis = c.parts ? partsOf(c, cur) : []; const isOpen = open2 === id; return (
              <div className={'colgrp' + dnd.cls(i)} key={id} {...dnd.row(i)}>
                <div className="colrow">
                  <Grip label={'Move ' + c.label} onKeyDown={dnd.key(i)} />
                  <label><input type="checkbox" checked onChange={() => setCols(cols.filter((x) => x !== id))} /><span className="fld"><b>{c.label}</b>{(c.parts || c.fields) && <span>{c.parts ? vis.map((p) => p.label).join(', ') : c.fields}</span>}</span></label>
                  <MoveBtns label={c.label} i={i} n={cols.length} move={dnd.move} />
                  {c.parts ? <button type="button" className={'disc' + (isOpen ? ' open' : '')} aria-label={'Fields of ' + c.label} aria-expanded={isOpen} onClick={() => setOpen2(isOpen ? null : id)}>Fields<Ic n="right" s={12} /></button> : <span className="disc disc--ph" aria-hidden="true" />}
                </div>
                {isOpen && c.parts && <PartsEditor c={c} cur={cur} patch={patch} say={setLive} />}
              </div>); })}
            {hidden.length > 0 && <div className="field__label" style={{ margin: '14px 0 4px' }}>Hidden</div>}
            {hidden.map((c) => <div className="colrow" key={c.id}><label><input type="checkbox" checked={false} onChange={() => setCols(cols.concat(c.id))} /><span className="fld"><b>{c.label}</b>{c.fields && <span>{c.fields}</span>}</span></label></div>)}
          </div>
          {!cfg.userViews && <div className="panel__sec"><span className="field__hint">Saved for you on this list. This list has no custom views.</span></div>}
          <div className="sr-only" role="status" aria-live="polite">{live}</div>
        </SidePanel>
      )}
    </>
  );
}
function FiltersPanel({ cfg, cur, patch, count, onClose }) {
  const vis = cfg.filters.filter((f) => !f.hidden);
  const clear = () => { const f = { ...cur.f }; vis.forEach((x) => { delete f[x.key]; }); patch({ f }); };
  const setF = (k, v) => { const f = { ...cur.f }; if (v === '' || v === false) delete f[k]; else f[k] = v; patch({ f }); };
  return (
    <SidePanel title="Filters" onClose={onClose} footer={<><Btn tone="secondary" onClick={clear}>Clear all</Btn><Btn onClick={onClose}>Show {count} {cfg.noun}</Btn></>}>
      {vis.map((fc) => fc.type === 'check'
        ? <div className="panel__sec" key={fc.key}><label className="checkrow"><input type="checkbox" checked={!!cur.f[fc.key]} onChange={(e) => setF(fc.key, e.target.checked)} />{fc.label}</label></div>
        : <div className="panel__sec" key={fc.key}><div className="field"><label className="field__label" htmlFor={'f-' + fc.key}>{fc.label}</label>
            <select id={'f-' + fc.key} className="control" value={cur.f[fc.key] || ''} onChange={(e) => setF(fc.key, e.target.value)}><option value="">Any</option>{fc.options.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div></div>)}
    </SidePanel>
  );
}

/* ---------- dialogs ---------- */
function SaveDialog({ cfg, mode, view, cur, role, views, onClose, onSubmit }) {
  useRestoreFocus();
  const fref = useRef(null); useFocusTrap(fref);
  const [name, setName] = useState(mode === 'rename' ? view.name : '');
  const [scope, setScope] = useState('personal');
  const [asDefault, setAsDefault] = useState(false);
  const [touched, setTouched] = useState(false);
  const t = name.trim(); const sc = mode === 'rename' ? view.scope : scope;
  const clash = views.some((v) => v.id !== (view && view.id) && v.name.toLowerCase() === t.toLowerCase());
  const error = !t ? 'Enter a name for this view.' : clash ? 'A view with this name already exists.' : '';
  const chips = [];
  if (mode === 'create') {
    cfg.filters.forEach((fc) => { const v = cur.f[fc.key]; if (!v) return; if (fc.type === 'check') chips.push(fc.label); else if (fc.hidden) { const sv = cfg.systemViews.find((x) => x.def.f[fc.key] === v); chips.push(fc.label + ': ' + (sv ? sv.name : v)); } else chips.push(fc.label + ': ' + optLabel(fc, v)); });
    chips.push('Sort: ' + sortLabel(cfg, cur.sort)); chips.push((cur.columns.length + 1) + ' columns');
  }
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, []);
  const submit = (e) => { e.preventDefault(); setTouched(true); if (!error) onSubmit({ name: t, scope: sc, asDefault }); };
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dialog" ref={fref} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="dlg-t">
        <h3 id="dlg-t">{mode === 'rename' ? 'Rename view' : 'Save as new view'}</h3>
        <div className="field"><label className="field__label" htmlFor="vn">Name</label>
          <input id="vn" className="control" autoFocus value={name} maxLength={60} aria-invalid={touched && !!error} onChange={(e) => setName(e.target.value)} placeholder="e.g. Allegro, ready to pack" />
          {touched && error && <span className="field__error">{error}</span>}</div>
        {mode === 'create' && <>
          <div className="field"><span className="field__label">Who can see it</span>
            <div className="segsm" role="radiogroup"><button type="button" role="radio" aria-checked={scope === 'personal'} onClick={() => setScope('personal')}>Only me</button>
              <button type="button" role="radio" aria-checked={scope === 'shared'} disabled={role !== 'admin'} title={role !== 'admin' ? 'Admins only' : ''} onClick={() => setScope('shared')}>Everyone</button></div>
            <span className="field__hint">{role !== 'admin' ? 'Shared views are created by admins. You can duplicate them to your own.' : scope === 'shared' ? 'Everyone sees it. Only admins can edit or delete it.' : 'Visible only on your account.'}</span></div>
          {scope === 'personal' && <label className="checkrow"><input type="checkbox" checked={asDefault} onChange={(e) => setAsDefault(e.target.checked)} />Open {cfg.title} in this view by default</label>}
          <div className="summary" aria-label="What is saved">{chips.map((c) => <Chip key={c}>{c}</Chip>)}</div></>}
        <div className="dialog__actions"><Btn tone="secondary" onClick={onClose}>Cancel</Btn><Btn type="submit">{mode === 'rename' ? 'Save name' : 'Save view'}</Btn></div>
      </form>
    </div>
  );
}
function ConfirmDialog({ title, body, actions, onClose }) {
  const ref = useRef(null); const dref = useRef(null);
  useFocusTrap(dref); useRestoreFocus();
  useEffect(() => { if (ref.current) ref.current.focus(); const k = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, []);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" ref={dref} role="alertdialog" aria-modal="true" aria-labelledby="cd-t" aria-describedby="cd-b">
        <div><h3 id="cd-t">{title}</h3><p id="cd-b" style={{ marginTop: 4 }}>{body}</p></div>
        <div className="dialog__actions"><button type="button" ref={ref} className="button button--secondary" onClick={onClose}>Cancel</button>{actions}</div>
      </div>
    </div>
  );
}

/* ---------- user menu (real shell: Theme + Density live here) ---------- */
function UserMenu({ role, density, setDensity, theme, setTheme }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const Seg2 = ({ value, onChange, options, label }) => <div className="segsm" role="radiogroup" aria-label={label}>{options.map((o) => <button key={o[0]} type="button" role="radio" aria-checked={value === o[0]} onClick={() => onChange(o[0])}>{o[1]}</button>)}</div>;
  return (
    <div className="rel" ref={ref}>
      <button type="button" className="shell-user" style={{ border: 0, background: open ? 'var(--bg-surface-muted)' : 'transparent', cursor: 'pointer', color: 'inherit' }} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><i>{role.slice(0, 2).toUpperCase()}</i><b>{role}</b></button>
      {open && (
        <div className="menu menu--right" role="menu" style={{ minWidth: 260 }}>
          <div className="menu__note" style={{ padding: '8px 12px' }}><b style={{ color: 'var(--text-primary)', fontSize: '.8125rem' }}>{role}</b><br />{role}@openlinker.local</div>
          <div className="menu__sep" />
          <div className="dsec"><div className="field__label" style={{ marginBottom: 6 }}>Theme</div><Seg2 label="Theme" value={theme} onChange={setTheme} options={[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} /></div>
          <div className="dsec"><div className="field__label" style={{ marginBottom: 6 }}>Density</div><Seg2 label="Density" value={density} onChange={setDensity} options={[['comfortable', 'Comfortable'], ['compact', 'Compact']]} /></div>
          <div className="menu__sep" />
          <button type="button" role="menuitem" className="menu__item" onClick={() => setOpen(false)}>Sign out</button>
        </div>)}
    </div>
  );
}

/* ---------- the list screen (one engine, many configs) ---------- */
const NAV = [['Operations', [['Analytics'], ['System health'], ['Orders', '285', 'orders'], ['Products', null, 'products'], ['Stock movements'], ['Customers', '118', 'customers'], ['Listings', '10', 'listings'], ['Shipments', null, 'shipments'], ['Returns', null, 'returns'], ['Promotions'], ['Automations'], ['Sales documents', null, 'salesdocs'], ['Invoices', null, 'invoices']]],
  ['Diagnostics', [['Jobs & Logs', '461', 'jobs'], ['Webhooks', '0', 'webhooks'], ['Sync progress'], ['Duplicate stock positions']]],
  ['Platform', [['Connections', '10'], ['Adapters'], ['Settings']]], ['AI', [['Prompt templates'], ['Provider settings']]]];

function ListScreen({ cfg, role, theme, setTheme, go }) {
  const narrow = useNarrow();
  const [views, setViews] = useState(cfg.startViews);
  const [pinned, setPinned] = useState(cfg.pinned);
  const [defaultId, setDefaultId] = useState(cfg.systemViews[0].id);
  const [activeId, setActiveId] = useState(cfg.systemViews[0].id);
  const [cur, setCur] = useState(cfg.systemViews[0].def);
  const [search, setSearch] = useState('');
  const [density, setDensity] = useState('comfortable');
  const [dismissed, setDismissed] = useState({});
  const [dialog, setDialog] = useState(null);
  const [panel, setPanel] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [sel, setSel] = useState([]);
  const moreRef = useOutside(moreOpen, () => setMoreOpen(false));
  const tt = useRef(null);
  const LOCKED = cfg.locked_views;
  const active = views.find((v) => v.id === activeId) || views[0];
  const rec = useMemo(() => reconcile(cfg, active.def), [active]);
  const diff = changes(cur, rec.def);
  const dirty = sig(cur) !== sig(rec.def);
  const isCustom = active.scope !== 'system';
  const canEdit = active.scope === 'personal' || (active.scope === 'shared' && role === 'admin');
  const say = (m, undo) => { setToast({ m, undo }); clearTimeout(tt.current); tt.current = setTimeout(() => setToast(null), undo ? 8000 : 5000); };
  const patch = (p) => setCur((c) => ({ ...c, ...p }));
  const setF = (k, v) => setCur((c) => { const f = { ...c.f }; if (v === '' || v === false) delete f[k]; else f[k] = v; return { ...c, f }; });
  const rows = useMemo(() => run(cfg, cur, search), [cur, search]);
  useEffect(() => { setSel([]); }, [activeId]);

  const apply = (id) => {
    const v = views.find((x) => x.id === id); const prevA = activeId, prevC = cur, lost = dirty && isCustom, name = active.name;
    setActiveId(id); setCur(reconcile(cfg, v.def).def);
    if (lost) say('Discarded your changes to “' + name + '”.', () => { setActiveId(prevA); setCur(prevC); setToast(null); });
  };
  const autoPin = (id) => {
    let list = pinned.slice(); let note = '';
    if (list.length >= 6) {
      const out = list.find((p) => !LOCKED.includes(p) && p !== activeId && views.some((x) => x.id === p && x.scope !== 'system'));
      if (out) { list = list.filter((p) => p !== out); note = ' It replaced “' + views.find((x) => x.id === out).name + '” in the strip.'; }
    }
    if (list.length < 6) list.push(id);
    return { list, note };
  };
  const saveChanges = () => { setViews(views.map((v) => v.id === active.id ? { ...v, def: cur } : v)); say('Saved changes to “' + active.name + '”.'); };
  const create = ({ name, scope, asDefault }) => { const id = 'v' + Date.now(); setViews(views.concat({ id, scope, owner: scope === 'shared' ? 'You' : undefined, name, def: cur })); const pin = autoPin(id); setPinned(pin.list); setActiveId(id); if (asDefault) setDefaultId(id); setDialog(null); say('Saved view “' + name + '”' + (scope === 'shared' ? ' for everyone.' : '.') + pin.note); };
  const duplicate = (id) => { const prevA = activeId, prevC = cur, lost = dirty && isCustom && id !== activeId; const s = views.find((v) => v.id === id); const c = { id: 'v' + Date.now(), scope: 'personal', name: uniqueName(s.name + ' (copy)', views), def: id === activeId ? cur : reconcile(cfg, s.def).def }; setViews(views.concat(c)); setActiveId(c.id); setCur(c.def); say(id === activeId && dirty ? 'Copied with your current changes.' : 'Copied to your views.', lost ? () => { setActiveId(prevA); setCur(prevC); setToast(null); } : undefined); };
  const rename = ({ name }) => { setViews(views.map((v) => v.id === dialog.view.id ? { ...v, name } : v)); setDialog(null); say('Renamed to “' + name + '”.'); };
  const remove = () => { const id = dialog.view.id; const rest = views.filter((v) => v.id !== id); setViews(rest); setPinned(pinned.filter((p) => p !== id)); setDialog(null); if (defaultId === id) setDefaultId(cfg.systemViews[0].id); if (activeId === id) { setActiveId(cfg.systemViews[0].id); setCur(rest[0].def); } say('Deleted “' + dialog.view.name + '”.' + (defaultId === id ? ' ' + cfg.title + ' now opens in ' + cfg.systemViews[0].name + '.' : '')); };
  const togglePin = (id) => { if (LOCKED.includes(id) && pinned.includes(id)) { say('This view always stays in the strip.'); return; } if (pinned.includes(id)) setPinned(pinned.filter((p) => p !== id)); else if (pinned.length >= 6) say('The strip holds 6 views. Unpin one first.'); else setPinned(pinned.concat(id)); };
  const setSort = (key) => patch({ sort: cur.sort.key === key ? { key, dir: cur.sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: (cfg.sorts.find((s) => s.key === key) || { dir: 'desc' }).dir } });
  const colById = (id) => cfg.columns.find((c) => c.id === id);
  const cols = cur.columns.map(colById).filter(Boolean);
  const nOf = (v) => cfg.liveCounts && v.scope === 'system' ? run(cfg, { ...v.def, sort: cfg.defaultSort }, '').length : v.n;

  const chips = [];
  cfg.filters.filter((fc) => !fc.hidden).forEach((fc) => { const v = cur.f[fc.key]; if (!v) return; chips.push(fc.type === 'check' ? ['', fc.label, () => setF(fc.key, false)] : [fc.label, optLabel(fc, v), () => setF(fc.key, '')]); });
  const nFilters = chips.length;
  if (isCustom) cfg.filters.filter((fc) => fc.hidden).forEach((fc) => { const v = cur.f[fc.key]; if (!v) return; const sv = cfg.systemViews.find((x) => x.def.f[fc.key] === v); chips.push([fc.label, sv ? sv.name : String(v), () => setF(fc.key, '')]); });
  const visibleIds = pinned.filter((id) => views.some((v) => v.id === id));
  if (!visibleIds.includes(activeId)) visibleIds.push(activeId);
  const tabs = visibleIds.map((id) => views.find((v) => v.id === id)).filter(Boolean);
  const firstCustom = tabs.findIndex((v) => v.scope !== 'system');
  const showStrip = true;
  const banner = cfg.banner ? cfg.banner(cfg.rows) : null;
  const L = cfg.locked;
  const lockedTh = typeof L.head === 'function' ? L.head(cur.sort, setSort) : L.head;
  const allSel = rows.length > 0 && sel.length === rows.length;

  return (
    <div className={'frame ' + density}>
      <div className="shell">
        <aside className="shell-sidebar">
          <div className="shell-brand"><Logo /><span className="shell-brand__name">OpenLinker</span><span className="context-chip"><b>Dev</b><span>v0.19.0</span></span></div>
          <nav className="shell-nav" aria-label="Primary">
            {NAV.map(([g, items]) => (
              <section className="shell-nav__group" key={g}><p className="shell-nav__label">{g}</p><ul className="shell-nav__list">
                {items.map(([l, c, pg]) => <li key={l}><a className={'shell-nav__link' + (pg === cfg.id ? ' shell-nav__link--active' : '') + (pg ? '' : ' is-off')} href={'#' + (pg || '')} aria-current={pg === cfg.id ? 'page' : undefined} aria-disabled={pg ? undefined : 'true'} title={pg ? undefined : 'Not part of this prototype'} onClick={(e) => { e.preventDefault(); if (pg && pg !== cfg.id) go(pg); }}><span className="shell-nav__link-label">{l}</span>{c && <span className="shell-nav__link-count">{c}</span>}</a></li>)}
              </ul></section>))}
          </nav>
          <div className="shell-workspace"><strong className="shell-workspace__name">Default organization</strong><div className="shell-workspace__user"><span>{role}</span><span>Sign out</span></div></div>
        </aside>
        <div className="shell-main">
          <header className="shell-topbar">
            <span className="shell-hamburger"><Ic n="menu" s={16} /></span>
            <nav className="shell-crumbs" aria-label="Breadcrumb"><span>{cfg.crumb}</span><span className="sep">/</span><span className="cur">{cfg.title}</span></nav>
            <span className="shell-search"><Ic n="search" /><span className="ph">Search orders, products, connections…</span><kbd>⌘K</kbd></span>
            <span className="spacer" />
            <span className="shell-alerts">Alerts <span className="mono">0</span></span>
            <UserMenu role={role} density={density} setDensity={setDensity} theme={theme} setTheme={setTheme} />
          </header>
          <main className="shell-content">
            <section className="page-section">
              <div className="page-header">
                <div><p className="eyebrow">Synced 12:23</p><h2 className="page-title">{cfg.title}</h2><p className="page-desc">{cfg.desc}</p></div>
                <div className="page-actions">
                  {!narrow && [...(cfg.actions || [])].sort((a, b) => (a.primary ? 1 : 0) - (b.primary ? 1 : 0)).map((a) => <Btn key={a} tone={a.primary ? undefined : 'secondary'} size="sm" onClick={() => say(a.label + ' is not part of this prototype.')}>{a.label}</Btn>)}
                  <Btn tone="ghost" size="sm" aria-label="Refresh (R)"><Ic n="refresh" />{!narrow && 'Refresh'}</Btn>
                  <div className="rel" ref={moreRef}>
                    <Btn tone="ghost" size="sm" className="button--icon" aria-label="More actions" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}><Ic n="dots" /></Btn>
                    {moreOpen && <div className="menu menu--right" role="menu">{(narrow ? (cfg.actions || []).map((a) => a.label) : []).concat(cfg.menu || []).map((m) => <button key={m} type="button" role="menuitem" className="menu__item" onClick={() => setMoreOpen(false)}>{m}</button>)}</div>}
                  </div>
                </div>
              </div>

              {showStrip && (
                <div className="vstrip">
                  <div className="vtabs" role="group" aria-label="Views">
                    {tabs.map((v, i) => { const n = nOf(v); return (
                      <React.Fragment key={v.id}>
                        {i === firstCustom && firstCustom > 0 && <span className="vsep" aria-hidden="true" />}
                        <button type="button" className="vtab" aria-current={v.id === activeId ? 'true' : undefined} aria-label={n !== undefined ? v.name + ', ' + n : undefined} onClick={() => v.id !== activeId && apply(v.id)}>
                          {v.name}{n !== undefined && <span className={'n' + (v.tone === 'error' && n > 0 ? ' err' : v.tone === 'warning' && n > 0 ? ' warn' : '')}>{n}</span>}
                        </button>
                      </React.Fragment>); })}
                  </div>
                  {<AllViews cfg={cfg} views={views} pinned={pinned} active={active} defaultId={defaultId} role={role} locked={LOCKED} onSelect={apply} onPin={togglePin}
                    onDefault={(id) => { setDefaultId(id); say(cfg.title + ' will open in “' + views.find((v) => v.id === id).name + '”.'); }} onDuplicate={duplicate}
                    onRename={(id) => setDialog({ mode: 'rename', view: views.find((v) => v.id === id) })} onDelete={(id) => setDialog({ mode: 'delete', view: views.find((v) => v.id === id) })} onNew={() => setDialog({ mode: 'create' })} />}
                </div>)}

              <div className="tb" role="search">
                {cfg.search && <div className="sbox"><Ic n="search" /><input className="control with-icon" aria-label={'Search ' + cfg.noun} placeholder={narrow ? 'Search' : cfg.searchPh} value={search} onChange={(e) => setSearch(e.target.value)} /><kbd>/</kbd></div>}
                {cfg.filters.some((f) => !f.hidden) && <Btn tone="secondary" size="sm" style={{ height: '2rem' }} onClick={() => setPanel(true)}><Ic n="filters" s={14} />Filters{nFilters > 0 && <span className="badge-n">{nFilters}</span>}</Btn>}
                <ColumnsSort cfg={cfg} cur={cur} patch={patch} />
                {!narrow && cfg.needs && <div className="needs"><span>Needs a look</span>
                  {cfg.needs.map((nd, i) => <React.Fragment key={nd.label}>{i > 0 && <span>·</span>}<button type="button" className={'nbtn ' + (nd.n > 0 && nd.tone ? 'e' : 't')} onClick={() => nd.view ? apply(nd.view) : nd.apply ? patch({ f: { ...cur.f, ...nd.apply } }) : null}><span className="n"><b>{nd.n}</b> {nd.label}</span></button></React.Fragment>)}</div>}
              </div>

              {(chips.length > 0 || (dirty && cfg.userViews)) && (
                <div className="applied">
                  {chips.map(([k, v, rm]) => <span className="fchip" key={k + v}>{k && <span className="k">{k}:</span>}{v}<button type="button" aria-label={'Remove filter ' + (k ? k + ' ' : '') + v} onClick={rm}><Ic n="x" s={10} /></button></span>)}
                  {chips.length > 1 && <button type="button" className="linkbtn" onClick={() => patch({ f: Object.fromEntries(Object.entries(cur.f).filter(([k]) => cfg.filters.find((x) => x.key === k && x.hidden) && !isCustom)) })}>Clear all</button>}
                  {cfg.userViews && dirty && isCustom && (
                    <div className={'edited' + (narrow ? ' edited--bar' : '')} role="group" aria-label="Unsaved view changes">
                      <span className="tag"><span className="edited-dot" aria-hidden="true" />Edited · {diff.join(', ')}</span>
                      <Btn tone="ghost" size="sm" onClick={() => setCur(rec.def)}>Reset</Btn>
                      {canEdit && <button type="button" className="linkbtn" onClick={() => setDialog({ mode: 'create' })}>Save as new…</button>}
                      {canEdit ? <Btn size="sm" onClick={saveChanges}>Save changes</Btn> : <Btn size="sm" onClick={() => setDialog({ mode: 'create' })}>Save as my view…</Btn>}
                    </div>)}
                  {cfg.userViews && dirty && !isCustom && <Btn tone="secondary" size="sm" style={{ marginLeft: 'auto' }} onClick={() => setDialog({ mode: 'create' })}>Save as view…</Btn>}
                </div>)}

              {banner && !dismissed['b' + cfg.id] && (
                <div className={'note note--' + banner.tone} role="note"><span style={{ marginTop: 2 }}><Ic n="warn" /></span>
                  <div className="body"><b>{banner.title}</b> {banner.body} {banner.link && <button type="button" className="lnk" onClick={() => banner.link.view ? apply(banner.link.view) : patch({ f: { ...cur.f, ...banner.link.apply } })}>{banner.link.label}</button>}</div></div>)}

              {rec.issues.length > 0 && !dismissed[active.id] && (
                <div className="repair" role="alert"><span style={{ marginTop: 2 }}><Ic n="warn" /></span>
                  <div className="body"><b>This view needs repair.</b> Missing items are skipped until you fix it.<ul>{rec.issues.map((i) => <li key={i}>{i}</li>)}</ul></div>
                  <div className="act">{canEdit ? <Btn size="sm" onClick={saveChanges}>Remove missing items and save</Btn> : <Btn size="sm" onClick={() => setDialog({ mode: 'create' })}>Save as my view…</Btn>}<Btn tone="secondary" size="sm" onClick={() => setDismissed({ ...dismissed, [active.id]: true })}>Dismiss</Btn></div></div>)}

              {narrow ? (
                <div className="cards" key={activeId}>
                  {rows.map((r, i) => { const [a, b] = cfg.card(r); return (
                    <div className="card" key={i}>
                      <div className="card__top">{cfg.select && <input type="checkbox" aria-label="Select row" />}{L.cell(r)}<span className="spacer" /><Ic n="right" /></div>
                      <div className="card__line"><span>{a}</span></div><div className="card__line"><span className="l2">{b}</span></div>
                    </div>); })}
                  {rows.length === 0 && <div className="empty"><span>Nothing matches these filters.</span></div>}
                </div>
              ) : (
                <div className="data-table__container" key={activeId}>
                  <table className="data-table">
                    <caption className="sr-only">{cfg.title}</caption>
                    <thead><tr>
                      {cfg.select && <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all" checked={allSel} onChange={() => setSel(allSel ? [] : rows.map((_, i) => i))} /></th>}
                      <th aria-sort={L.sorts && L.sorts.includes(cur.sort.key) ? (cur.sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>{lockedTh}</th>
                      {cols.map((c) => { const on = c.sorts ? c.sorts.includes(cur.sort.key) : (c.sort && cur.sort.key === c.sort); return (
                        <th key={c.id} className={c.right ? 'end' : ''} aria-sort={on ? (cur.sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                          {colHead(c, cur, cur.sort, setSort) || (c.parts && !c.sort ? c.head : null) || (typeof c.head === 'function' ? c.head(cur.sort, setSort) : c.sort ? <button type="button" onClick={() => setSort(c.sort)}><span className="stxt">{c.head}</span><SortArrow on={cur.sort.key === c.sort} dir={cur.sort.dir} /></button> : c.head)}</th>); })}
                      <th style={{ width: 44 }}><span className="sr-only">Open</span></th>
                    </tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          {cfg.select && <td><input type="checkbox" aria-label="Select row" checked={sel.includes(i)} onChange={() => setSel(sel.includes(i) ? sel.filter((x) => x !== i) : sel.concat(i))} /></td>}
                          <td>{L.cell(r)}</td>
                          {cols.map((c) => <td key={c.id} className={(c.right ? 'end ' : '') + (c.nw ? 'nw' : '')}>{colCell(c, cur, r)}</td>)}
                          <td><span className="rowgo"><Ic n="right" s={12} /></span></td>
                        </tr>))}
                    </tbody>
                  </table>
                  {rows.length === 0 && <div className="empty"><span>Nothing matches these filters.</span><Btn tone="secondary" size="sm" onClick={() => { patch({ f: {} }); setSearch(''); }}>Clear filters</Btn></div>}
                </div>)}
              {sel.length > 0 && cfg.bulk && (
                <div className="bulk" role="region" aria-label="Bulk actions"><b>{sel.length}</b> selected{cfg.bulkNote && <span className="l2" style={{ flex: 1 }}>{cfg.bulkNote}</span>}<span className="spacer" />
                  <Btn tone="ghost" size="sm" onClick={() => setSel([])}>Clear</Btn>{cfg.bulk.map((b) => <Btn key={b.label} tone={b.primary ? undefined : 'secondary'} size="sm" onClick={() => say(b.label + ' is not part of this prototype.')}>{b.label}</Btn>)}</div>)}
              <div className="tfoot"><span>Showing 1–{rows.length} of <span className="tabular">{rows.length}</span> sample rows</span><span className="qs">List address <code>{toQuery(cfg, cur)}</code></span></div>
            </section>
          </main>
        </div>
      </div>
      {panel && <FiltersPanel cfg={cfg} cur={cur} patch={patch} count={rows.length} onClose={() => setPanel(false)} />}
      {dialog && dialog.mode === 'create' && <SaveDialog cfg={cfg} mode="create" cur={cur} role={role} views={views} onClose={() => setDialog(null)} onSubmit={create} />}
      {dialog && dialog.mode === 'rename' && <SaveDialog cfg={cfg} mode="rename" view={dialog.view} cur={cur} role={role} views={views} onClose={() => setDialog(null)} onSubmit={rename} />}
      {dialog && dialog.mode === 'delete' && <ConfirmDialog title={'Delete “' + dialog.view.name + '”?'} onClose={() => setDialog(null)}
        body={(dialog.view.scope === 'shared' ? 'It disappears for everyone. ' : '') + (dialog.view.id === activeId && dirty ? 'Your unsaved changes will be lost too. ' : '') + 'Records are not affected. Only the saved filters and columns are removed.'}
        actions={<Btn tone="danger" onClick={remove}>Delete view</Btn>} />}
      {toast && <div className="toast" role="status">{toast.m}{toast.undo && <button type="button" className="undo" onClick={toast.undo}>Undo</button>}</div>}
      <div className="sr-only" role="status" aria-live="polite">{dirty && isCustom ? 'View ' + active.name + ' has unsaved changes: ' + diff.join(', ') + '.' : ''}</div>
    </div>
  );
}
