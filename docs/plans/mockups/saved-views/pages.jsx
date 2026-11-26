/* ---------- config builder ---------- */
function build(c) {
  const cfg = { actions: [], menu: [], filters: [], ...c };
  cfg.columns.forEach((x) => { if (x.parts) { x.fields = x.parts.map((q) => q.label).join(', '); x.sorts = x.parts.filter((q) => q.sort).map((q) => q.sort); } });
  cfg.defCols = cfg.columns.filter((x) => x.def).map((x) => x.id);
  cfg.defaultSort = { key: cfg.sorts[0].key, dir: cfg.sorts[0].dir };
  const view = (id, name, f, o = {}) => ({ id, scope: 'system', name, n: o.n, tone: o.tone, def: { f: f || {}, sort: o.sort || cfg.defaultSort, columns: o.columns || cfg.defCols, parts: o.parts || {} } });
  cfg.systemViews = cfg.sys.map(([id, name, f, o]) => view(id, name, f, o));
  const cust = (cfg.custom || []).map(([id, scope, name, f, o, owner]) => ({ id, scope, name, owner, def: { f: f || {}, sort: (o && o.sort) || cfg.defaultSort, columns: (o && o.columns) || cfg.defCols, parts: (o && o.parts) || {} } }));
  cfg.startViews = cfg.systemViews.concat(cust);
  cfg.pinned = cfg.pin || cfg.systemViews.slice(0, 6).map((v) => v.id);
  cfg.locked_views = cfg.lockViews || cfg.systemViews.slice(0, 2).map((v) => v.id);
  cfg.userViews = cfg.userViews !== false;
  return cfg;
}
const rank = { late: 0, soon: 1, later: 2 };
const copyLine = (id) => <span className="idrow"><b>{id}</b><button type="button" className="copy hov">Copy</button></span>;

/* ================= ORDERS ================= */
const O = (id, item, more, customer, city, source, dest, health, stage, reason, shipment, carrier, total, pay, doc, created, gift, shipby, tags, stock, ret) => ({ id, item, more, customer, city, source, dest, health, stage, reason, shipment, carrier, total, pay, doc, created, gift, shipby, tags, stock, ret });
const ORDER_ROWS = [
  O(1147, 'OL Seed Mug', 0, 'Anna Testowa', 'Warszawa', 'Shopify', 'Shopify', 'attention', 'failed', 'Product not found in PrestaShop', 'not_shipped', 'InPost Kurier', 53.99, 'paid', 'un', '18 Nov 2026, 11:48', false, 'late', ['qa'], 'Reserved', '—'),
  O(1145, 'OL Seed T-shirt - L', 1, 'Anna Testowa', 'Warszawa', 'Shopify', 'PrestaShop', 'attention', 'failed', 'Product not found in PrestaShop', 'not_shipped', 'InPost Kurier', 119.88, 'paid', 'un', '18 Nov 2026, 11:39', false, 'late', [], 'Reserved', '—'),
  O(1146, 'OL Seed Mug', 0, 'Anna Testowa', 'Warszawa', 'Shopify', 'PrestaShop', 'attention', 'failed', 'Product not found in PrestaShop', 'not_shipped', 'InPost Kurier', 53.99, 'paid', 'ok', '18 Nov 2026, 11:39', false, 'soon', [], 'Reserved', '—'),
  O(1144, 'OL Seed Mug', 0, 'Anna Testowa', 'Warszawa', 'Shopify', 'PrestaShop', 'dispatch', 'dispatched', '', 'dispatched', 'InPost Kurier', 53.99, 'paid', 'ok', '18 Nov 2026, 11:31', false, 'later', [], 'Shipped', '—'),
  O(1143, 'Seed Hoodie - M', 2, 'Piotr Nowak', 'Kraków', 'Allegro', 'PrestaShop', 'dispatch', 'ready', '', 'not_shipped', 'DPD', 289.0, 'paid', 'un', '18 Nov 2026, 10:12', true, 'soon', ['vip'], 'Reserved', '—'),
  O(1142, 'Candle Set', 1, 'Marta Zielińska', 'Gdańsk', 'WooCommerce', 'PrestaShop', 'mapping', 'mapping', 'No product mapping for SKU', 'not_shipped', '—', 129.0, 'pending', 'un', '18 Nov 2026, 09:58', true, 'later', [], '—', '—'),
  O(1141, 'Water Bottle 750 ml', 0, 'Jan Wiśniewski', 'Łódź', 'PrestaShop', 'Shopify', 'synced', 'synced', '', 'dispatched', 'InPost Paczkomat', 54.5, 'paid', 'ok', '17 Nov 2026, 17:20', false, 'later', [], 'Shipped', '—'),
  O(1140, 'Seed Mug', 3, 'Ewa Dąbrowska', 'Poznań', 'Allegro', 'PrestaShop', 'mapping', 'mapping', 'No product mapping for SKU', 'not_shipped', '—', 412.2, 'paid', 'un', '17 Nov 2026, 16:02', false, 'late', ['b2b'], '—', '—'),
  O(1139, 'Notebook A5', 0, 'Tomasz Lewandowski', 'Wrocław', 'Shopify', 'PrestaShop', 'deleted', 'failed', 'Source order deleted', 'not_shipped', '—', 179.0, 'paid', 'un', '17 Nov 2026, 14:44', false, 'late', [], '—', 'Requested'),
  O(1138, 'Tote Bag', 1, 'Karolina Wójcik', 'Szczecin', 'Allegro', 'PrestaShop', 'synced', 'synced', '', 'dispatched', 'DPD', 36.99, 'paid', 'ok', '17 Nov 2026, 12:10', true, 'later', [], 'Shipped', '—'),
  O(1137, 'Seed Hoodie - L', 0, 'Michał Kamiński', 'Lublin', 'Shopify', 'PrestaShop', 'dispatch', 'ready', '', 'not_shipped', 'InPost Kurier', 289.0, 'paid', 'ok', '17 Nov 2026, 09:30', false, 'soon', [], 'Reserved', '—'),
  O(1136, 'Candle Set', 0, 'Agnieszka Kaczmarek', 'Katowice', 'PrestaShop', 'Shopify', 'attention', 'failed', 'Carrier rejected the label', 'not_shipped', 'DPD', 120.0, 'paid', 'un', '16 Nov 2026, 18:55', false, 'late', ['qa'], 'Reserved', '—'),
];
const placedOf = (s) => { const m = s.match(/^(\d+) (\w+) (\d+), (.*)$/); return m ? (Number(m[1]) - 2) + ' ' + m[2] + ' ' + m[3] + ', ' + m[4] : s; };
const STG = { failed: ['error', 'Sync failed'], mapping: ['warning', 'Needs mapping'], ready: ['', 'Ready'], dispatched: ['', 'Dispatched'], synced: ['', 'Synced'] };
const ORDERS = build({
  id: 'orders', crumb: 'Operations', title: 'Orders', noun: 'orders', select: true,
  desc: 'Orders from every connected channel and what state they are in.',
  actions: [{ label: 'Export' }], menu: ['How gifts and bundles work'],
  searchPh: 'Search by order number, buyer, email, SKU or tracking number',
  search: (r, q) => String(r.id).includes(q) || r.customer.toLowerCase().includes(q) || r.item.toLowerCase().includes(q),
  rows: ORDER_ROWS,
  filters: [
    { key: 'stage', label: 'Stage', options: [['failed', 'Sync failed'], ['mapping', 'Awaiting mapping'], ['ready', 'Ready'], ['dispatched', 'Dispatched'], ['synced', 'Synced']] },
    { key: 'source', label: 'Source', options: ['Shopify', 'PrestaShop', 'Allegro', 'WooCommerce'].map((s) => [s, s]) },
    { key: 'shipby', label: 'Ship-by', options: [['late', 'Overdue'], ['soon', 'Next 24 h'], ['later', 'Later']] },
    { key: 'gift', label: 'With a gift', type: 'check', test: (r) => r.gift },
    { key: 'health', label: 'Health', hidden: true },
  ],
  cmp: { synced: (r) => -r.id, created: (r) => r.id, placed: (r) => r.id, total: (r) => r.total, pay: (r) => (r.pay === 'paid' ? 1 : 0), shipby: (r) => rank[r.shipby] },
  sorts: [{ key: 'synced', dir: 'desc', label: 'Recently synced' }, { key: 'created', dir: 'desc', label: 'Created, newest' }, { key: 'created', dir: 'asc', label: 'Created, oldest' }, { key: 'total', dir: 'desc', label: 'Total, high to low' }, { key: 'shipby', dir: 'asc', label: 'Ship-by, soonest' }, { key: 'placed', dir: 'desc', label: 'Placed, newest' }, { key: 'pay', dir: 'desc', label: 'Payment, paid first' }],
  locked: { label: 'Order', fields: 'Number, item, copy, retry', head: 'Order', cell: (o) => <span className="ordercell"><Tile t={o.item} /><span><span className="idrow"><b>{o.id}</b><button type="button" className="copy hov">Copy</button></span><span className="l2 itemline"><span className="nm">{o.item}</span>{o.more > 0 && <Chip>+{o.more}</Chip>}</span></span></span> },
  columns: [
    { id: 'customer', label: 'Customer', def: true, nw: true, head: 'Customer', parts: [{ id: 'name', label: 'Name', cell: (o) => <span className="l1">{o.customer}</span> }, { id: 'city', label: 'City', cell: (o) => <span className="l2">{o.city}</span> }] },
    { id: 'channel', label: 'Channel', def: true, head: 'Channel', parts: [{ id: 'source', label: 'Source', cell: (o) => <span className="l1"><Dot c={chanColor(o.source)} />{o.source}</span> }, { id: 'dest', label: 'Destination', cell: (o) => <span className="l2">→ {o.dest}</span> }] },
    { id: 'status', label: 'Status', fields: 'Sync state, reason', def: true, head: 'Status', cell: (o) => { const [t, l] = STG[o.stage]; return t ? <span className="idrow"><span title={o.reason}>{badge(t, l, true)}</span>{o.stage === 'failed' && <button type="button" className="retry hov">Retry</button>}</span> : <span className="l1" style={{ color: 'var(--text-secondary)' }}>{l}</span>; } },
    { id: 'shipment', label: 'Shipment', def: true, nw: true, parts: [{ id: 'carrier', label: 'Carrier', hl: 'Shipment', cell: (o) => <span className="l1">{o.carrier}</span> }, { id: 'state', label: 'Ship-by and state', hl: 'Ship-by', sort: 'shipby', cell: (o) => o.shipby === 'late' && o.shipment !== 'dispatched' ? <span className="l2 err">Overdue</span> : <span className="l2">{o.shipment === 'dispatched' ? 'Dispatched' : 'Not shipped'}</span> }] },
    { id: 'total', label: 'Total, payment, dates', def: true, right: true, parts: [
      { id: 'amount', label: 'Total', hl: 'Total', sort: 'total', cell: (o) => <b className="mono l1" style={{ fontWeight: 600 }}>PLN {o.total.toFixed(2)}</b> },
      { id: 'payment', label: 'Payment', hl: 'Payment', sort: 'pay', cell: (o) => <span className={'l2' + (o.pay === 'pending' ? ' warn' : '')}>{o.pay === 'paid' ? 'Paid' : 'Unpaid'}</span> },
      { id: 'document', label: 'Document', cell: (o) => <span className={'l2' + (o.doc === 'un' ? ' warn' : '')}>{o.doc === 'un' ? 'Document unconfirmed' : 'Document registered'}</span> },
      { id: 'placed', label: 'Placed', hl: 'Placed', sort: 'placed', cell: (o) => <span className="mono l2">{placedOf(o.created)}</span> },
      { id: 'created', label: 'Created', hl: 'Created', sort: 'created', cell: (o) => <span className="mono l2">{o.created}</span> }] },
    { id: 'stock', label: 'Stock', def: false, head: 'Stock', cell: (o) => <span className="mono l2">{o.stock}</span> },
    { id: 'returns', label: 'Returns', def: false, head: 'Returns', cell: (o) => <span className="mono l2">{o.ret}</span> },
    { id: 'tags', label: 'Tags', def: false, head: 'Tags', cell: (o) => o.tags.length ? <span style={{ display: 'inline-flex', gap: 4 }}>{o.tags.map((t) => <Chip key={t}>{t}</Chip>)}</span> : <span className="l2">—</span> },
  ],
  sys: [['all', 'All orders', {}, { n: 285 }], ['attention', 'Needs attention', { health: 'attention' }, { n: 46, tone: 'error' }], ['mapping', 'Awaiting mapping', { health: 'mapping' }, { n: 139 }], ['dispatch', 'Awaiting dispatch', { health: 'dispatch' }, { n: 69, sort: { key: 'shipby', dir: 'asc' } }], ['deleted', 'Source deleted', { health: 'deleted' }, { n: 12, tone: 'error' }], ['synced', 'Synced', { health: 'synced' }, { n: 19 }]],
  custom: [['late', 'shared', 'Late to ship', { shipby: 'late' }, { sort: { key: 'shipby', dir: 'asc' }, columns: ['customer', 'channel', 'shipment', 'total'], parts: { total: ['amount', 'payment', 'created'], shipment: ['state', 'carrier'] } }, 'Marta K.'], ['gift', 'personal', 'Gift orders', { gift: true }, { sort: { key: 'created', dir: 'desc' }, columns: ['customer', 'shipment', 'total', 'tags'] }], ['old', 'personal', 'Allegro archive check', { source: 'Allegro', stage: 'archived' }, { columns: ['customer', 'channel', 'carrierRef', 'total'] }]],
  pin: ['all', 'attention', 'mapping', 'dispatch', 'late', 'gift'],
  needs: [{ n: 31, label: 'late to ship', tone: 'error', apply: { shipby: 'late' } }, { n: 6, label: 'stuck', tone: 'error', apply: { stage: 'failed' } }, { n: 40, label: 'to handle', view: 'attention' }],
  card: (o) => [o.customer + ' · PLN ' + o.total.toFixed(2), o.source + ' → ' + o.dest + (o.stage === 'failed' ? ' · Sync failed' : '')],
});

/* ================= PRODUCTS ================= */
const PN = ['OL Seed Mug', 'OL Seed T-shirt', 'Water Bottle 750 ml', 'Notebook A5', 'Tote Bag', 'Candle Set', 'Seed Hoodie - M', 'Seed Hoodie - L', 'Desk Lamp', 'Phone Stand', 'Sticker Pack', 'Canvas Print'];
const CONNS = [['e2e-shopify-main', 'Shopify', '157eed8d…1917'], ['e2e-prestashop-master', 'PrestaShop', '2a9c04b1…77e0'], ['e2e-shopify-publish', 'Shopify', '9f31ce02…b4a8']];
const PRODUCT_ROWS = PN.map((name, i) => {
  const c = CONNS[i % 3]; const state = [3, 7, 9].includes(i) ? 'low' : i % 2 === 0 ? 'out' : 'in';
  const stock = state === 'out' ? 0 : state === 'low' ? 3 : 1000 - i * 40;
  return { id: i, name, sku: 'qa-' + name.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase().slice(0, 14), conn: c[0], source: c[1], connId: c[2], stock, state, master: stock, price: 29 + i * 11, updated: (18 - (i % 4)) + ' Nov 2026', created: (18 - (i % 6)) + ' Nov 2026', n: i, taxMissing: i !== 5 && i !== 6, deleted: i === 2 || i === 9, bundle: i === 5 || i === 11, listings: i % 3 === 1 ? [['PrestaShop', 1, 1]] : [['PrestaShop', 0, 1], ['Shopify', i % 2, 1]] };
});
const PRODUCTS = build({
  id: 'products', crumb: 'Operations', title: 'Products', noun: 'products', select: true,
  desc: 'Catalogue cockpit - search, stock health, and per-channel listings coverage.',
  actions: [{ label: 'New bundle', primary: true }, { label: 'Cost prices' }], menu: ['How bundles work'],
  searchPh: 'Search by name or SKU…', search: (r, q) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q),
  rows: PRODUCT_ROWS,
  filters: [
    { key: 'conn', label: 'Source', options: CONNS.map((c) => [c[0], c[0]]) },
    { key: 'tax', label: 'Tax rate', options: [['missing', 'Missing'], ['never', 'Never checked']], test: (r, v) => v === 'missing' ? r.taxMissing : false },
    { key: 'bundle', label: 'Show', options: [['yes', 'Bundles'], ['no', 'Without bundles']], test: (r, v) => v === 'yes' ? r.bundle : !r.bundle },
    { key: 'hideDeleted', label: 'Hide products deleted at source', type: 'check', test: (r) => !r.deleted },
    { key: 'onlyDeleted', label: 'Deleted at source', hidden: true, test: (r) => r.deleted },
    { key: 'state', label: 'Stock', hidden: true },
  ],
  cmp: { created: (r) => r.n, updated: (r) => 100 - (r.n % 4), name: (r) => r.name, sku: (r) => r.sku, price: (r) => r.price, stock: (r) => r.stock },
  sorts: [{ key: 'created', dir: 'desc', label: 'Newest first' }, { key: 'updated', dir: 'desc', label: 'Recently updated' }, { key: 'name', dir: 'asc', label: 'Name A to Z' }, { key: 'sku', dir: 'asc', label: 'SKU' }, { key: 'price', dir: 'desc', label: 'Highest price' }, { key: 'stock', dir: 'asc', label: 'Lowest stock' }],
  locked: { label: 'Product', fields: 'Name, SKU', sorts: ['name', 'sku'], head: (s, set) => <Stack s={s} set={set} items={[['name', 'Product'], ['sku', 'SKU']]} />, cell: (p) => <span className="ordercell"><Tile t={p.name} /><span><span className="l1" style={{ fontWeight: 600 }}>{p.name}</span><span className="l2">SKU: {p.sku}</span></span></span> },
  columns: [
    { id: 'source', label: 'Source', def: true, head: 'Source', parts: [{ id: 'platform', label: 'Platform', cell: (p) => <span className="l1"><Dot c={chanColor(p.source)} />{p.source}</span> }, { id: 'conn', label: 'Connection', cell: (p) => <span className="l2">{p.conn}</span> }, { id: 'id', label: 'Connection id', cell: (p) => <IdChip id={p.connId} /> }] },
    { id: 'stock', label: 'Stock', def: true, sort: 'stock', head: 'Stock', parts: [{ id: 'sell', label: 'To sell', cell: (p) => <span className="l1"><b className="mono">{p.stock}</b> to sell</span> }, { id: 'state', label: 'State', cell: (p) => p.state === 'out' ? badge('error', 'Out of stock', true) : p.state === 'low' ? badge('warning', 'Low stock', true) : <span className="l2">In stock</span> }, { id: 'master', label: 'Master quantity', cell: (p) => <span className="l2">master {p.master}</span> }] },
    { id: 'listings', label: 'Listings', fields: 'Per-channel coverage, publish', def: true, head: 'Listings', cell: (p) => <span className="stack">{p.listings.map(([ch, a, b]) => <span key={ch} className="l1"><Dot c={chanColor(ch)} />{ch} <span className="mono">{a}/{b}</span></span>)}{p.listings.some(([, a, b]) => a < b) && <span className="pubchip">+ Publish</span>}</span> },
    { id: 'money', label: 'Price, updated, created', def: true, right: true, parts: [{ id: 'price', label: 'Price', hl: 'Price', sort: 'price', cell: (p) => <b className="mono l1">PLN {p.price.toFixed(2)}</b> }, { id: 'updated', label: 'Last update', hl: 'Updated', sort: 'updated', cell: (p) => <span className="l2">upd. {p.updated}</span> }, { id: 'created', label: 'Created', hl: 'Created', sort: 'created', cell: (p) => <span className="l2">{p.created}</span> }] },
    { id: 'tax', label: 'Tax rate', def: false, head: 'Tax rate', cell: (p) => <span className={'l2' + (p.taxMissing ? ' warn' : '')}>{p.taxMissing ? 'Missing' : '23%'}</span> },
  ],
  sys: [['all', 'All products', {}, { n: 4785 }], ['out', 'Out of stock', { state: 'out' }, { n: 3801, tone: 'error' }], ['low', 'Low stock', { state: 'low' }, { n: 202, tone: 'warning' }], ['over', 'Oversold', { state: 'over' }, { n: 0, tone: 'error' }], ['deleted', 'Deleted at source', { onlyDeleted: true }, { n: 14, tone: 'error' }], ['notax', 'No tax rate', { tax: 'missing' }, { n: 4758 }]],
  custom: [['shopify-out', 'shared', 'Shopify, out of stock', { conn: 'e2e-shopify-main', state: 'out' }, { columns: ['source', 'stock', 'money'] }, 'Marta K.'], ['bundles', 'personal', 'Bundles to check', { bundle: 'yes' }]],
  pin: ['all', 'out', 'low', 'deleted', 'shopify-out', 'bundles'],
  needs: [{ n: 4760, label: 'no tax rate', tone: 'error', apply: { tax: 'missing' } }, { n: 13, label: 'no cost price' }],
  banner: () => ({ tone: 'error', title: '14 products deleted at the source are still on sale', body: 'OpenLinker could not stop the sale on every channel. Open the product to see where and what to do.', link: { label: 'Show these listings', view: 'deleted' } }),
  bulk: [{ label: 'Publish products', primary: true }], bulkNote: 'Up to 100 products at once.',
  card: (p) => [p.sku + ' · PLN ' + p.price.toFixed(2), p.stock + ' to sell · ' + p.conn],
});

/* ================= LISTINGS ================= */
const LN = ['Running Shoe', 'Trail Jacket', 'Wool Socks', 'Gym Bag', 'Yoga Mat', 'Sports Watch', 'Cap', 'Water Flask', 'Headlamp', 'Rain Poncho'];
const LISTING_ROWS = LN.map((name, i) => ({ id: i, name, variant: ['42 · Black', 'M · Olive', 'One size', '30 L', 'Standard', 'S1 · Grey', 'One size', '1 L', 'Standard', 'L'][i], offer: String(15800000000 + i * 137), sku: 'SPT-' + (100 + i), ean: '59011' + (234500 + i * 17), channel: 'Allegro', conn: i < 8 ? 'Allegro Sandbox 2' : 'qa-oauth-publisher-2', connId: i < 8 ? '3eee7f3e…2d93' : '71ab09cd…c410', reauth: i < 8, price: 249 - i * 12, qty: (i * 7) % 23, updated: '18 Nov 2026, 01:' + (10 + i), life: i === 8 ? 'draft' : i === 9 ? 'ended' : 'active', priceChange: i === 2 || i === 5, n: i }));
const LISTINGS = build({
  id: 'listings', crumb: 'Operations', title: 'Listings', noun: 'listings',
  desc: 'Everything you sell on connected channels, and what state it is in right now.',
  actions: [{ label: 'Publish products', primary: true }],
  searchPh: 'Product name, SKU, EAN or external ID', search: (r, q) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q) || r.ean.includes(q) || r.offer.includes(q),
  rows: LISTING_ROWS,
  filters: [{ key: 'conn', label: 'Channel', options: [['Allegro Sandbox 2', 'Allegro Sandbox 2'], ['qa-oauth-publisher-2', 'qa-oauth-publisher-2']] }, { key: 'life', label: 'State', hidden: true }, { key: 'priceChange', label: 'Price changes', hidden: true, test: (r) => r.priceChange }],
  cmp: { updated: (r) => r.n, price: (r) => r.price, qty: (r) => r.qty },
  sorts: [{ key: 'updated', dir: 'desc', label: 'Recently updated' }, { key: 'price', dir: 'desc', label: 'Price, high to low' }, { key: 'qty', dir: 'asc', label: 'Quantity, low to high' }],
  locked: { label: 'Listing', fields: 'Product, variant, offer id, SKU, EAN', head: 'Listing', cell: (r) => <span className="ordercell"><Tile t={r.name} /><span><span className="l1" style={{ fontWeight: 600 }}>{r.name} <Chip>{r.variant}</Chip></span><span className="l2 mono">{r.offer}</span><span className="l2">SKU: {r.sku} · EAN: {r.ean}</span></span></span> },
  columns: [
    { id: 'channel', label: 'Channel', def: true, head: 'Channel', cell: (r) => <span className="l1"><Dot c={r.reauth ? 'var(--status-error)' : chanColor(r.channel)} />{r.channel}</span> },
    { id: 'conn', label: 'Connection', def: true, head: 'Connection', parts: [{ id: 'name', label: 'Name', cell: (r) => <span className="l1">{r.conn}</span> }, { id: 'id', label: 'Connection id', cell: (r) => <IdChip id={r.connId} /> }, { id: 'reauth', label: 'Re-auth warning', cell: (r) => r.reauth ? <span className="l2 err">Re-auth needed</span> : null }] },
    { id: 'price', label: 'Price on channel', def: true, right: true, sort: 'price', head: 'Price', cell: (r) => <b className="mono l1">PLN {r.price.toFixed(2)}</b> },
    { id: 'qty', label: 'Quantity on channel', def: true, right: true, sort: 'qty', head: 'Quantity', cell: (r) => <span className="mono l1">{r.qty}</span> },
    { id: 'updated', label: 'Updated, status read', def: true, sort: 'updated', head: 'Updated', cell: (r) => <span className="mono l2" style={{ color: 'var(--text-secondary)' }}>{r.updated}</span> },
  ],
  sys: [['active', 'Active', { life: 'active' }, { n: 8 }], ['invalid', 'Invalid', { life: 'invalid' }, { n: 0, tone: 'error' }], ['draft', 'Draft', { life: 'draft' }, { n: 1, tone: 'warning' }], ['ended', 'Ended', { life: 'ended' }, { n: 1 }], ['unsynced', 'Unsynced', { life: 'unsynced' }, { n: 0 }], ['price', 'Price changes', { priceChange: true }, { n: 2, tone: 'warning' }]],
  custom: [['reauth', 'shared', 'Allegro, re-auth needed', { conn: 'Allegro Sandbox 2' }, { columns: ['conn', 'price', 'updated'] }, 'Marta K.']],
  pin: ['active', 'invalid', 'draft', 'ended', 'price', 'reauth'], lockViews: ['active', 'invalid'],
  needs: [{ n: 2, label: 'price changes', tone: 'warning', view: 'price' }, { n: 0, label: 'blocked by shop' }, { n: 0, label: 'selling deleted' }],
  card: (r) => [r.sku + ' · PLN ' + r.price.toFixed(2), r.conn + ' · qty ' + r.qty],
});

/* ================= SHIPMENTS ================= */
const SH = [['failed', 'trucker_ID_is_not_set_for_this_org', 'Kurier', 'carrier', 'PENDING'], ['dispatched', '', 'Paczkomat', 'carrier', 'PENDING'], ['dispatched', '', 'OMP-fulfilled', 'omp', 'OMP-FULFILLED'], ['dispatched', '', 'OMP-fulfilled', 'omp', 'OMP-FULFILLED'], ['cancelled', '', 'Kurier', 'carrier', 'PENDING'], ['failed', 'label_rejected_by_carrier', 'Paczkomat', 'carrier', 'PENDING'], ['dispatched', '', 'Paczkomat', 'carrier', 'PENDING'], ['delivered', '', 'Kurier', 'carrier', 'PENDING'], ['intransit', '', 'Paczkomat', 'carrier', 'PENDING'], ['dispatched', '', 'OMP-fulfilled', 'omp', 'OMP-FULFILLED'], ['failed', 'address_validation_failed', 'Kurier', 'carrier', 'PENDING'], ['cancelled', '', 'OMP-fulfilled', 'omp', 'OMP-FULFILLED']];
const SHIP_ROWS = SH.map(([status, err, method, proc, procLabel], i) => ({ id: i, status, err, method, proc, procLabel, order: String(1160 - i), item: PN[i % 12], more: i % 3 === 0 ? 1 : 0, customer: ['Anna Testowa', 'Piotr Nowak', 'Marta Zielińska', 'Jan Wiśniewski'][i % 4], conn: i % 2 ? 'e2e-shopify-main' : 'InPost sandbox', connId: i % 2 ? '157eed8d…1917' : '0d8fe7d0…50b6', created: (18 - (i % 4)) + ' Nov 2026, 14:' + (59 - i), tracking: status === 'dispatched' ? (i === 6 ? 'unsent' : 'with') : 'none', n: 100 - i }));
const SHIPMENTS = build({
  id: 'shipments', crumb: 'Operations', title: 'Shipments', noun: 'shipments',
  searchPh: 'Search by order or customer…', search: (r, q) => r.order.includes(q) || r.customer.toLowerCase().includes(q),
  desc: 'Cross-order rollup of every shipment - filter by status, method, connection, or date.',
  rows: SHIP_ROWS,
  filters: [
    { key: 'proc', label: 'Processor', options: [['omp', 'OMP-fulfilled'], ['carrier', 'Carrier']] },
    { key: 'method', label: 'Method', options: [['Paczkomat', 'Paczkomat'], ['Kurier', 'Kurier'], ['OMP-fulfilled', 'OMP-fulfilled']] },
    { key: 'conn', label: 'Connection', options: [['InPost sandbox', 'InPost sandbox'], ['e2e-shopify-main', 'e2e-shopify-main']] },
    { key: 'tracking', label: 'Tracking', options: [['with', 'With tracking'], ['none', 'Without tracking'], ['unsent', 'Tracking not sent to channel']] },
    { key: 'status', label: 'Status', hidden: true },
  ],
  cmp: { created: (r) => r.n, status: (r) => r.status, method: (r) => r.method },
  sorts: [{ key: 'created', dir: 'desc', label: 'Newest first' }, { key: 'created', dir: 'asc', label: 'Oldest first' }, { key: 'status', dir: 'asc', label: 'Status' }, { key: 'method', dir: 'asc', label: 'Method' }],
  locked: { label: 'Status', fields: 'State, error, time', sorts: ['status'], head: (s, set) => <Stack s={s} set={set} items={[['status', 'Status']]} />, cell: (r) => <><span>{r.status === 'failed' ? badge('error', 'Failed', true) : badge(r.status === 'dispatched' || r.status === 'intransit' ? 'info' : '', r.status === 'intransit' ? 'In transit' : r.status[0].toUpperCase() + r.status.slice(1), true)}</span>{r.err && <span className="l2 err">{r.err}</span>}</> },
  columns: [
    { id: 'order', label: 'Order', fields: 'Number, product', def: true, head: 'Order', cell: (r) => <span className="ordercell"><Tile t={r.item} /><span>{copyLine(r.order)}<span className="l2 itemline"><span className="nm">{r.item}</span>{r.more > 0 && <Chip>+{r.more}</Chip>}</span></span></span> },
    { id: 'action', label: 'Action', def: true, head: 'Action', cell: (r) => <span className={r.status === 'failed' ? 'l1 err' : 'l2'} style={{ fontWeight: 600 }}>{r.status === 'failed' ? 'Fix' : 'View'}</span> },
    { id: 'pm', label: 'Processor and method', fields: 'Processor, method', def: true, sorts: ['method'], head: (s, set) => <Stack s={s} set={set} items={[[null, 'Processor'], ['method', 'Method']]} />, cell: (r) => <><span className="l1"><span className="status-badge">{r.procLabel}</span></span><span className="l2">{r.method}</span></> },
    { id: 'customer', label: 'Customer', def: true, nw: true, head: 'Customer', cell: (r) => <span className="l1">{r.customer}</span> },
    { id: 'conn', label: 'Connection', fields: 'Name, id', def: true, head: 'Connection', cell: (r) => <><span className="l1">{r.conn}</span><IdChip id={r.connId} /></> },
    { id: 'created', label: 'Created', def: true, sort: 'created', head: 'Created', cell: (r) => <span className="mono l2" style={{ color: 'var(--text-secondary)' }}>{r.created}</span> },
  ],
  sys: [['all', 'All shipments', {}, { n: 43 }], ['failed', 'Failed', { status: 'failed' }, { n: 3, tone: 'error' }], ['dispatched', 'Dispatched', { status: 'dispatched' }, { n: 34 }], ['intransit', 'In transit', { status: 'intransit' }, { n: 0 }], ['delivered', 'Delivered', { status: 'delivered' }, { n: 0 }], ['cancelled', 'Cancelled', { status: 'cancelled' }, { n: 6 }], ['draft', 'Draft', { status: 'draft' }, { n: 0 }], ['generated', 'Generated', { status: 'generated' }, { n: 0 }]],
  custom: [['kurier-failed', 'shared', 'Courier failures', { status: 'failed', method: 'Kurier' }, null, 'Marta K.']],
  pin: ['all', 'failed', 'dispatched', 'intransit', 'delivered', 'kurier-failed'],
  needs: [{ n: 3, label: 'to fix', tone: 'error', view: 'failed' }, { n: 1, label: 'tracking not sent', tone: 'error', apply: { tracking: 'unsent' } }, { n: 0, label: 'to send' }],
  card: (r) => ['Order ' + r.order + ' · ' + r.customer, r.method + ' · ' + r.conn],
});

/* ================= RETURNS ================= */
const RT = [['awaiting', 'OPEN', '0 of 1 received', 1, false, false], ['awaiting', 'OPEN', '0 of 2 received', 2, false, false], ['received', 'OPEN', '1 of 1 received', 3, false, false], ['disposed', 'CLOSED', '1 of 1 received', 14, false, false], ['awaiting', 'OPEN', '0 of 1 received', 1, true, false], ['awaiting', 'OPEN', '0 of 1 received', 2, true, false], ['received', 'OPEN', '2 of 2 received', 5, false, true], ['awaiting', 'DECLINED', '0 of 1 received', 9, false, false], ['disposed', 'CLOSED', '1 of 1 received', 20, false, false], ['received', 'OPEN', '1 of 3 received', 4, false, false]];
const RETURN_ROWS = RT.map(([stage, src, recv, days, orphan, blocked], i) => ({ id: i, ret: 'RET-' + (7000 + i * 13), order: orphan ? null : 'ol_order_3dd6…' + (38 + i), srcOrder: String(1100 + i * 7), conn: ['Allegro Sandbox 2', 'e2e-shopify-main', 'qa-V2-oms'][i % 3], connId: ['3eee7f3e…2d93', '157eed8d…1917', 'b2c4d8e1…09aa'][i % 3], days, opened: days + 'd ago', src, stage, recv, orphan, blocked, openNeeds: stage === 'awaiting' && src === 'OPEN', disp: stage === 'received', money: i === 6, n: 100 - days }));
const RETURNS = build({
  id: 'returns', crumb: 'Operations', title: 'Returns', noun: 'returns',
  searchPh: 'Search by return or order id…', search: (r, q) => r.ret.toLowerCase().includes(q) || String(r.srcOrder).includes(q),
  desc: 'Returns reported by your connected channels, newest first.',
  actions: [{ label: '+ Record a return', primary: true }],
  rows: RETURN_ROWS, liveCounts: true,
  filters: [{ key: 'conn', label: 'Source', options: [['Allegro Sandbox 2', 'Allegro Sandbox 2'], ['e2e-shopify-main', 'e2e-shopify-main'], ['qa-V2-oms', 'qa-V2-oms']] }, { key: 'needsRecv', label: 'Needs receiving', hidden: true, test: (r) => r.openNeeds }, { key: 'needsDisp', label: 'Needs disposition', hidden: true, test: (r) => r.disp }, { key: 'blocked', label: 'Restock blocked', hidden: true, test: (r) => r.blocked }, { key: 'money', label: 'Money pending', hidden: true, test: (r) => r.money }, { key: 'orphan', label: 'Unmatched', hidden: true, test: (r) => r.orphan }, { key: 'open', label: 'Open', hidden: true, test: (r) => r.stage !== 'disposed' && r.src === 'OPEN' }],
  cmp: { opened: (r) => r.n },
  sorts: [{ key: 'opened', dir: 'desc', label: 'Opened, newest' }, { key: 'opened', dir: 'asc', label: 'Opened, oldest' }],
  locked: { label: 'Return', fields: 'Return id', sorts: ['opened'], head: 'Return', cell: (r) => <span className="mono l1" style={{ fontWeight: 600 }}>{r.ret}</span> },
  columns: [
    { id: 'order', label: 'Order', fields: 'OpenLinker order, source order', def: true, head: 'Order', cell: (r) => r.order ? <><span className="lnk">{r.order}</span><span className="l2">{r.srcOrder}</span></> : <><span className="l1 err" style={{ fontWeight: 500 }}>Not matched</span><span className="l2">{r.srcOrder}</span></> },
    { id: 'source', label: 'Source', fields: 'Connection, id', def: true, head: 'Source', cell: (r) => <><span className="l1">{r.conn}</span><IdChip id={r.connId} /></> },
    { id: 'opened', label: 'Opened', def: true, sort: 'opened', head: 'Opened', cell: (r) => <span className="l1">{r.opened}</span> },
    { id: 'src', label: 'Source status', def: true, head: 'Source status', cell: (r) => <span className="mono l2" style={{ color: 'var(--text-secondary)' }}>Source: {r.src}</span> },
    { id: 'stage', label: 'Stage', fields: 'Stage, received count', def: true, head: 'Stage', cell: (r) => <><span>{r.blocked ? badge('error', 'Restock blocked', true) : badge('', r.stage === 'awaiting' ? 'Awaiting parcel' : r.stage === 'received' ? 'Received' : 'Disposed')}</span><span className="l2">{r.recv}</span></> },
  ],
  sys: [['all', 'All returns', {}], ['recv', 'Needs receiving', { needsRecv: true }, { tone: 'warning' }], ['disp', 'Needs disposition', { needsDisp: true }, { tone: 'warning' }], ['blocked', 'Restock blocked', { blocked: true }, { tone: 'error' }], ['money', 'Money pending', { money: true }, { tone: 'warning' }], ['orphan', 'Unmatched', { orphan: true }, { tone: 'error' }], ['open', 'All open', { open: true }]],
  custom: [['allegro', 'personal', 'Allegro, awaiting parcel', { conn: 'Allegro Sandbox 2', needsRecv: true }]],
  pin: ['all', 'recv', 'disp', 'blocked', 'orphan', 'allegro'], lockViews: ['all', 'recv'],
  banner: (rows) => { const n = rows.filter((r) => r.orphan).length; return n ? { tone: 'info', title: n + ' returns need an order.', body: 'OpenLinker can’t restock, refund or correct the invoice for these until they’re linked to an order.', link: { label: 'Show orphans', view: 'orphan' } } : null; },
  card: (r) => [r.srcOrder + ' · ' + r.conn, r.opened + ' · ' + r.recv],
});

/* ================= INVOICES ================= */
const INV = [['issued', 'accepted', 'Invoice (faktura)', '8201194127-20261116…'], ['failed', 'na', '—', '—'], ['issued', 'rejected', 'Invoice (faktura)', '8201194127-20261115…'], ['issued', 'awaiting', 'VAT', '—'], ['failed', 'rejected', 'Invoice (faktura)', '—'], ['issued', 'accepted', 'Invoice (faktura)', '8201194127-20261114…'], ['pending', 'na', '—', '—'], ['issued', 'accepted', 'VAT', '8201194127-20261113…']];
const INVOICE_ROWS = INV.map(([status, reg, type, ref], i) => ({ id: i, order: ['2bdf50b0…5c5119', 'a1c203de…98f012', '77e4b1c9…0d33ee', '5c0a9be2…4471a0'][i % 4], item: PN[(i + 3) % 12], more: i % 3 === 0 ? 1 : 0, doc: status === 'issued' ? (13 - i) + '/11/2026' : '—', type, status, reg, ref, taxId: i % 3 === 0 ? 'PL5252556107' : null, conn: i % 2 ? 'inFakt sandbox' : 'KSeF sandbox', connId: i % 2 ? '0d8fe7d0…50b6' : '9a7e21c4…bb10', issued: (16 - (i % 5)) + ' Nov 2026', n: 100 - i }));
const INVOICES = build({
  id: 'invoices', crumb: 'Operations', title: 'Invoices', noun: 'invoices', select: true,
  desc: 'Invoices issued for your orders and where they stand with the tax authority.',
  actions: [], rows: INVOICE_ROWS,
  searchPh: 'Order, document number…', search: (r, q) => r.order.includes(q) || r.doc.includes(q) || r.item.toLowerCase().includes(q),
  filters: [
    { key: 'status', label: 'Status', options: [['pending', 'Pending'], ['issued', 'Issued'], ['failed', 'Failed']] },
    { key: 'reg', label: 'Regulatory status', options: [['na', 'N/A'], ['awaiting', 'Awaiting submission'], ['submitted', 'Submitted'], ['accepted', 'Accepted'], ['rejected', 'Rejected']] },
    { key: 'conn', label: 'Connection', options: [['inFakt sandbox', 'inFakt sandbox'], ['KSeF sandbox', 'KSeF sandbox']] },
    { key: 'taxid', label: 'Buyer tax ID', options: [['with', 'With tax ID'], ['without', 'Without tax ID']], test: (r, v) => v === 'with' ? !!r.taxId : !r.taxId },
  ],
  cmp: { issued: (r) => r.n }, sorts: [{ key: 'issued', dir: 'desc', label: 'Issued, newest' }, { key: 'issued', dir: 'asc', label: 'Issued, oldest' }],
  locked: { label: 'Order', fields: 'Order id, product', head: 'Order', cell: (r) => <span className="ordercell"><Tile t={r.item} /><span>{copyLine(r.order)}<span className="l2 itemline"><span className="nm">{r.item}</span>{r.more > 0 && <Chip>+{r.more}</Chip>}</span></span></span> },
  columns: [
    { id: 'doc', label: 'Document type', fields: 'Number, type', def: true, head: 'Document type', cell: (r) => <><span className="l1"><span className="idchip">{r.doc}</span></span><span className="l2">{r.type}</span></> },
    { id: 'status', label: 'Status', def: true, head: 'Status', cell: (r) => r.status === 'failed' ? badge('error', 'Failed', true) : <span className="l1" style={{ color: 'var(--text-secondary)' }}>{r.status === 'issued' ? 'Issued' : 'Pending'}</span> },
    { id: 'reg', label: 'Regulatory', def: true, head: 'Regulatory', cell: (r) => r.reg === 'rejected' ? badge('error', 'Rejected', true) : r.reg === 'awaiting' ? badge('warning', 'Awaiting submission', true) : <span className="l1" style={{ color: 'var(--text-secondary)' }}>{r.reg === 'accepted' ? 'Accepted' : 'N/A'}</span> },
    { id: 'ref', label: 'Clearance ref.', def: true, head: 'Clearance ref.', cell: (r) => <span className="mono l2">{r.ref}</span> },
    { id: 'tax', label: 'Buyer tax ID', def: true, head: 'Buyer tax ID', cell: (r) => r.taxId ? <span className="mono l1">{r.taxId}</span> : <span className="l2">Not asserted by the source</span> },
    { id: 'conn', label: 'Connection', fields: 'Name, id', def: true, head: 'Connection', cell: (r) => <><span className="l1">{r.conn}</span><IdChip id={r.connId} /></> },
    { id: 'issued', label: 'Issued', def: true, sort: 'issued', head: 'Issued', cell: (r) => <span className="mono l2" style={{ color: 'var(--text-secondary)' }}>{r.issued}</span> },
  ],
  sys: [['all', 'All invoices', {}], ['failed', 'Failed', { status: 'failed' }, { tone: 'error' }], ['rejected', 'Rejected by KSeF', { reg: 'rejected' }, { tone: 'error' }], ['awaiting', 'Awaiting submission', { reg: 'awaiting' }, { tone: 'warning' }], ['notax', 'Without tax ID', { taxid: 'without' }]],
  custom: [['retry', 'shared', 'To retry today', { status: 'failed' }, { columns: ['status', 'reg', 'conn', 'issued'] }, 'Marta K.']],
  pin: ['all', 'failed', 'rejected', 'awaiting', 'notax', 'retry'], liveCounts: true,
  bulk: [{ label: 'Issue invoices' }, { label: 'Retry selected', primary: true }], bulkNote: 'Only failed invoices that were rejected will be retried; others are skipped.',
  card: (r) => [r.doc + ' · ' + r.type, r.conn + ' · ' + r.issued],
});

/* ================= LOGS (system views, no custom views) ================= */
const JT = [['Fetch new orders', 'marketplace.orders.poll'], ['Sync order', 'marketplace.order.sync'], ['Issue invoice', 'invoicing.issue'], ['Update offer quantity', 'marketplace.offerQuantity.update'], ['Register fiscal receipt', 'fiscalization.register']];
const JOB_ROWS = Array.from({ length: 12 }, (_, i) => { const st = [1, 4, 9].includes(i) ? 'dead' : i === 2 ? 'running' : i === 6 ? 'queued' : 'succeeded'; return { id: i, status: st, outcome: st === 'succeeded' ? (i === 10 ? 'business_failure' : 'ok') : '', jt: JT[i % 5], conn: ['e2e-shopify-main', 'Allegro Sandbox 2', 'InPost sandbox', 'System'][i % 4], attempts: st === 'dead' ? '10 / 10' : st === 'queued' ? '2 / 10' : '0 / 10', att: st === 'dead' ? 10 : 0, dur: st === 'queued' || st === 'running' ? '—' : (120 + i * 41) + ' ms', durN: 120 + i * 41, err: st === 'dead' ? ['connection_timeout', 'product_not_found', 'carrier_rejected'][i % 3] : '', created: '18 Nov 2026, 15:' + (30 - i), n: 100 - i }; });
const JOBS = build({
  id: 'jobs', crumb: 'Diagnostics', title: 'Sync Jobs', noun: 'jobs', userViews: false, actions: [],
  searchPh: 'Search by job type or error…', search: (r, q) => r.jt[0].toLowerCase().includes(q) || r.jt[1].toLowerCase().includes(q) || r.err.includes(q),
  desc: 'Background work OpenLinker runs for your connections. Filter to find what stopped.', rows: JOB_ROWS,
  filters: [{ key: 'status', label: 'Status', options: [['queued', 'queued'], ['running', 'running'], ['succeeded', 'succeeded'], ['dead', 'dead']] }, { key: 'jt', label: 'Job type', options: JT.map((j) => [j[1], j[0]]), test: (r, v) => r.jt[1] === v }, { key: 'outcome', label: 'Outcome', options: [['ok', 'ok'], ['business_failure', 'business failure']] }, { key: 'conn', label: 'Connection', options: ['e2e-shopify-main', 'Allegro Sandbox 2', 'InPost sandbox', 'System'].map((c) => [c, c]) }],
  cmp: { created: (r) => r.n, status: (r) => r.status, attempts: (r) => r.att, duration: (r) => r.durN },
  sorts: [{ key: 'created', dir: 'desc', label: 'Created, newest' }, { key: 'created', dir: 'asc', label: 'Created, oldest' }, { key: 'status', dir: 'asc', label: 'Status' }, { key: 'attempts', dir: 'desc', label: 'Attempts' }, { key: 'duration', dir: 'desc', label: 'Duration' }],
  locked: { label: 'Status', fields: 'State, outcome', sorts: ['status'], head: (s, set) => <Stack s={s} set={set} items={[['status', 'Status']]} />, cell: (r) => <><span>{r.status === 'dead' ? badge('error', 'Dead', true) : r.status === 'running' ? badge('info', 'Running', true) : r.status === 'queued' ? badge('warning', 'Queued', true) : <span className="l1" style={{ color: 'var(--text-secondary)' }}>Succeeded</span>}</span>{r.outcome === 'business_failure' && <span className="l2 warn">Business failure</span>}</> },
  columns: [
    { id: 'type', label: 'Job type', fields: 'Label, key', def: true, head: 'Job type', cell: (r) => <><span className="l1" style={{ fontWeight: 600 }}>{r.jt[0]}</span><span className="l2 mono">{r.jt[1]}</span></> },
    { id: 'conn', label: 'Connection', def: true, head: 'Connection', cell: (r) => <span className="l1"><Dot c={chanColor(r.conn)} />{r.conn}</span> },
    { id: 'attempts', label: 'Attempts', def: true, sort: 'attempts', head: 'Attempts', cell: (r) => <span className="mono l1">{r.attempts}</span> },
    { id: 'dur', label: 'Duration', def: true, sort: 'duration', head: 'Duration', cell: (r) => <span className="mono l2">{r.dur}</span> },
    { id: 'err', label: 'Last error', def: true, head: 'Last error', cell: (r) => r.err ? <span className="mono l2 err">{r.err}</span> : <span className="l2">—</span> },
    { id: 'created', label: 'Created', def: true, sort: 'created', head: 'Created', cell: (r) => <span className="mono l2" style={{ color: 'var(--text-secondary)' }}>{r.created}</span> },
  ],
  sys: [['all', 'All jobs', {}], ['dead', 'Gave up', { status: 'dead' }, { tone: 'error' }], ['running', 'Running', { status: 'running' }], ['queued', 'Queued', { status: 'queued' }], ['bf', 'Business failures', { outcome: 'business_failure' }, { tone: 'warning' }]],
  liveCounts: true, card: (r) => [r.jt[0] + ' · ' + r.conn, r.attempts + ' · ' + r.created],
});
const WH = [['job_enqueued', 'prestashop', 'inventory_levels/update'], ['failed', 'shopify', 'orders/create'], ['job_enqueued', 'shopify', 'orders/updated'], ['rejected', 'prestashop', 'product.updated'], ['deadlettered', 'shopify', 'orders/create'], ['job_enqueued', 'prestashop', 'order.created'], ['received', 'shopify', 'inventory_levels/update'], ['job_enqueued', 'shopify', 'orders/paid'], ['failed', 'prestashop', 'order.updated']];
const WEBHOOK_ROWS = WH.map(([status, provider, event], i) => ({ id: i, status, provider, event, conn: i % 2 ? 'e2e-shopify-main' : 'e2e-prestashop-master', connId: i % 2 ? '157eed8d…1917' : '2a9c04b1…77e0', reason: status === 'rejected' ? 'signature_mismatch' : status === 'failed' ? 'translator_error' : status === 'deadlettered' ? 'no_route' : '', received: '18 Nov 2026, 14:' + (56 - i), n: 100 - i }));
const WEBHOOKS = build({
  id: 'webhooks', crumb: 'Diagnostics', title: 'Webhook Deliveries', noun: 'deliveries', userViews: false, actions: [],
  searchPh: 'Search by event or provider…', search: (r, q) => r.event.includes(q) || r.provider.includes(q),
  desc: 'Inbound webhook visibility - signature, dedup, publish, and downstream job linkage.', rows: WEBHOOK_ROWS,
  filters: [{ key: 'status', label: 'Status', options: ['received', 'rejected', 'published', 'failed', 'job_enqueued', 'deadlettered'].map((s) => [s, s.replace('_', ' ')]) }, { key: 'provider', label: 'Provider', options: [['prestashop', 'prestashop'], ['shopify', 'shopify']] }, { key: 'conn', label: 'Connection', options: [['e2e-shopify-main', 'e2e-shopify-main'], ['e2e-prestashop-master', 'e2e-prestashop-master']] }],
  cmp: { received: (r) => r.n, status: (r) => r.status, provider: (r) => r.provider },
  sorts: [{ key: 'received', dir: 'desc', label: 'Received, newest' }, { key: 'received', dir: 'asc', label: 'Received, oldest' }, { key: 'status', dir: 'asc', label: 'Status' }, { key: 'provider', dir: 'asc', label: 'Provider' }],
  locked: { label: 'Status', fields: 'Delivery state', sorts: ['status'], head: (s, set) => <Stack s={s} set={set} items={[['status', 'Status']]} />, cell: (r) => ['failed', 'rejected', 'deadlettered'].includes(r.status) ? badge('error', r.status.replace('_', ' '), true) : <span className="l1" style={{ color: 'var(--text-secondary)' }}>{r.status.replace('_', ' ')}</span> },
  columns: [
    { id: 'provider', label: 'Provider', def: true, sort: 'provider', head: 'Provider', cell: (r) => <span className="mono l1">{r.provider}</span> },
    { id: 'event', label: 'Event type', def: true, head: 'Event type', cell: (r) => <span className="mono l2" style={{ color: 'var(--text-secondary)' }}>{r.event}</span> },
    { id: 'conn', label: 'Connection', fields: 'Name, id', def: true, head: 'Connection', cell: (r) => <><span className="l1" style={{ fontWeight: 600 }}>{r.conn}</span><IdChip id={r.connId} /></> },
    { id: 'reason', label: 'Reason', def: true, head: 'Reason', cell: (r) => r.reason ? <span className="mono l2 err">{r.reason}</span> : <span className="l2">—</span> },
    { id: 'received', label: 'Received', def: true, sort: 'received', head: 'Received', cell: (r) => <span className="mono l2" style={{ color: 'var(--text-secondary)' }}>{r.received}</span> },
  ],
  sys: [['all', 'All deliveries', {}], ['failed', 'Failed', { status: 'failed' }, { tone: 'error' }], ['rejected', 'Rejected', { status: 'rejected' }, { tone: 'error' }], ['dead', 'Gave up', { status: 'deadlettered' }, { tone: 'error' }]],
  liveCounts: true, card: (r) => [r.provider + ' · ' + r.event, r.conn + ' · ' + r.received],
});
const SD = [['invoice', 'registered'], ['fiscal', 'registered'], ['invoice', 'failed'], ['fiscal', 'unconfirmed'], ['invoice', 'issued'], ['fiscal', 'failed'], ['invoice', 'rejected'], ['fiscal', 'registered']];
const SD_ROWS = SD.map(([kind, status], i) => ({ id: i, order: 'ol_order_cfa9…' + (80 + i), kind, status, amount: 82.99 + i * 31, conn: i % 2 ? 'inFakt sandbox' : 'eparagony sandbox', connId: i % 2 ? '0d8fe7d0…50b6' : '4be1a920…c7d3', taxId: i % 3 === 0 ? 'PL5252556107' : null, created: (18 - (i % 4)) + ' Nov 2026', n: 100 - i }));
const SALESDOCS = build({
  id: 'salesdocs', crumb: 'Operations', title: 'Sales documents', noun: 'documents', userViews: false,
  desc: 'Every invoice and fiscal receipt OpenLinker issued, across connections.', actions: [{ label: 'Manage routing' }, { label: 'Manage invoices' }],
  rows: SD_ROWS, searchPh: 'Order id, document number…', search: (r, q) => r.order.includes(q),
  filters: [{ key: 'kind', label: 'Kind', options: [['invoice', 'Invoice'], ['fiscal', 'Fiscal receipt']] }, { key: 'status', label: 'Status', options: ['issued', 'failed', 'registered', 'unconfirmed', 'rejected'].map((s) => [s, s[0].toUpperCase() + s.slice(1)]) }, { key: 'conn', label: 'Connection', options: [['inFakt sandbox', 'inFakt sandbox'], ['eparagony sandbox', 'eparagony sandbox']] }, { key: 'taxid', label: 'Buyer tax ID', options: [['with', 'With tax ID'], ['without', 'Without tax ID']], test: (r, v) => v === 'with' ? !!r.taxId : !r.taxId }],
  cmp: { created: (r) => r.n, amount: (r) => r.amount }, sorts: [{ key: 'created', dir: 'desc', label: 'Created, newest' }, { key: 'created', dir: 'asc', label: 'Created, oldest' }, { key: 'amount', dir: 'desc', label: 'Amount, high to low' }],
  locked: { label: 'Order', fields: 'Order id', head: 'Order', cell: (r) => <span className="idrow"><span className="mono l1">{r.order}</span><button type="button" className="copy hov">Copy</button></span> },
  columns: [
    { id: 'kind', label: 'Kind', def: true, head: 'Kind', cell: (r) => <span className="l1">{r.kind === 'invoice' ? 'Invoice' : 'Fiscal receipt'}</span> },
    { id: 'status', label: 'Status', def: true, head: 'Status', cell: (r) => ['failed', 'rejected'].includes(r.status) ? badge('error', r.status[0].toUpperCase() + r.status.slice(1), true) : r.status === 'unconfirmed' ? badge('warning', 'Unconfirmed', true) : <span className="l1" style={{ color: 'var(--text-secondary)' }}>{r.status[0].toUpperCase() + r.status.slice(1)}</span> },
    { id: 'amount', label: 'Amount', def: true, right: true, sort: 'amount', head: 'Amount', cell: (r) => <b className="mono l1">PLN {r.amount.toFixed(2)}</b> },
    { id: 'conn', label: 'Connection', fields: 'Name, id', def: true, head: 'Connection', cell: (r) => <><span className="l1" style={{ fontWeight: 600 }}>{r.conn}</span><IdChip id={r.connId} /></> },
    { id: 'created', label: 'Created', def: true, sort: 'created', head: 'Created', cell: (r) => <span className="mono l2" style={{ color: 'var(--text-secondary)' }}>{r.created}</span> },
  ],
  sys: [['all', 'All documents', {}], ['invoice', 'Invoices', { kind: 'invoice' }], ['fiscal', 'Fiscal receipts', { kind: 'fiscal' }], ['failed', 'Failed', { status: 'failed' }, { tone: 'error' }]],
  liveCounts: true, card: (r) => [(r.kind === 'invoice' ? 'Invoice' : 'Fiscal receipt') + ' · PLN ' + r.amount.toFixed(2), r.conn + ' · ' + r.created],
});

/* ================= CUSTOMERS (reference list: columns & sort only) ================= */
const CUSTOMER_ROWS = Array.from({ length: 10 }, (_, i) => ({ id: i, name: ['Anna Testowa', 'Piotr Nowak', 'Marta Zielińska', 'Jan Wiśniewski', null, 'Ewa Dąbrowska', 'Tomasz Lewandowski', null, 'Karolina Wójcik', 'Michał Kamiński'][i], hash: 'e3b0c44298fc1c14…' + (100 + i), cid: 'ol_customer_' + (205 + i * 31) + '…', conn: ['e2e-shopify-main', 'Allegro Sandbox 2', 'e2e-prestashop-master'][i % 3], connId: ['157eed8d…1917', '3eee7f3e…2d93', '2a9c04b1…77e0'][i % 3], lastSeen: (18 - (i % 5)) + ' Nov 2026', n: 100 - i }));
const CUSTOMERS = build({
  id: 'customers', crumb: 'Operations', title: 'Customers', noun: 'customers', userViews: false, actions: [],
  desc: 'Customer identity projections - browse resolved identities and address history.', rows: CUSTOMER_ROWS,
  searchPh: 'Search by email or name…', search: (r, q) => (r.name || '').toLowerCase().includes(q) || r.cid.includes(q),
  filters: [{ key: 'conn', label: 'Source connection', options: [['e2e-shopify-main', 'e2e-shopify-main'], ['Allegro Sandbox 2', 'Allegro Sandbox 2'], ['e2e-prestashop-master', 'e2e-prestashop-master']] }],
  cmp: { seen: (r) => r.n, customer: (r) => r.name || r.hash }, sorts: [{ key: 'seen', dir: 'desc', label: 'Last seen, newest' }, { key: 'customer', dir: 'asc', label: 'Customer, A to Z' }],
  locked: { label: 'Customer', fields: 'Name or hash', sorts: ['customer'], head: (s, set) => <Stack s={s} set={set} items={[['customer', 'Customer']]} />, cell: (r) => r.name ? <span className="l1">{r.name}</span> : <><span className="mono l2">{r.hash}</span><span className="l2">No name recorded</span></> },
  columns: [
    { id: 'cid', label: 'Customer ID', def: true, head: 'Customer ID', cell: (r) => <IdChip id={r.cid} /> },
    { id: 'conn', label: 'Last connection source', fields: 'Name, id', def: true, head: 'Last connection source', cell: (r) => <><span className="l1">{r.conn}</span><IdChip id={r.connId} /></> },
    { id: 'seen', label: 'Last seen', def: true, sort: 'seen', head: 'Last seen', cell: (r) => <span className="mono l2" style={{ color: 'var(--text-secondary)' }}>{r.lastSeen}</span> },
  ],
  sys: [['all', 'All customers', {}]], card: (r) => [r.cid, r.conn + ' · ' + r.lastSeen],
});

const PAGES = { orders: ORDERS, products: PRODUCTS, listings: LISTINGS, shipments: SHIPMENTS, returns: RETURNS, invoices: INVOICES, salesdocs: SALESDOCS, jobs: JOBS, webhooks: WEBHOOKS, customers: CUSTOMERS };
