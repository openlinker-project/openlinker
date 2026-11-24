import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@web/shared/ui/tabs';
import { StatusBadge, type StatusBadgeTone } from '@web/shared/ui/status-badge';
import { Alert } from '@web/shared/ui/alert';
import { DetailSection } from '@web/shared/ui/detail-section';
import { MetricCard } from '@web/shared/ui/metric-card';
import { KeyValueList } from '@web/shared/ui/key-value-list';
import { EmptyState } from '@web/shared/ui/feedback-state';
import { PageLayout } from '@web/shared/ui/page-layout';
import { SegmentedControl } from '@web/shared/ui/segmented-control';
import { Input } from '@web/shared/ui/input';
import { Select } from '@web/shared/ui/select';
import { BUNDLE_MATRIX, COMPETITORS, GIFT_MATRIX, type Cov } from './data';
import { CLAIMS, type Claim, type Verdict } from './claims';
import { DECISIONS, type Confidence } from './decisions';
import {
  ADVISER_QUESTIONS,
  CHANNELS,
  CLIENT_QUESTIONS,
  CODE_SITES,
  COUNTERS,
  DOC_NOTES,
  DROPPED,
  ISSUES,
  SCENARIO,
  STAGE0,
  STANDARD,
} from './standard';
import consensus from './consensus.json';
import ucBundles from './uc-bundles.json';
import ucGifts from './uc-gifts.json';
import ucCross from './uc-cross.json';

/* ── Types for the JSON inputs ─────────────────────────────────────────── */
interface Gwt { given: string; when: string; then: string }
interface UseCase {
  id: string;
  name: string;
  area: string;
  actor: string;
  trigger: string;
  preconditions: string[];
  mainFlow: string[];
  altFlows: string[];
  channelData: Record<string, string>;
  olBehaviour: string;
  mechanism: string;
  acceptance: Gwt[];
  priority: string;
  priorityReason: string;
  evidence: string[];
  confidence: string;
  risks: string[];
}
interface Cell {
  id: string;
  competitor: string;
  r1: Cov | null;
  r2: Cov | null;
  r3: Cov | null;
  r4: Cov | null;
  r5: Cov | null;
  final: Cov;
  roundsSeen: number;
  unanimous: boolean;
}

const CELLS = (consensus as { cells: Cell[] }).cells;

/* Documents and returns cases are owned by the cross-cutting writer, so its copy wins on a duplicate id. */
/* Writers used markdown backticks and a "NEW" marker in names; the page shows plain text. */
function clean<T>(v: T): T {
  if (typeof v === 'string') return v.replace(/`/g, '') as T;
  if (Array.isArray(v)) return v.map(clean) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) as T;
  return v;
}
const USE_CASES: UseCase[] = (() => {
  const byId = new Map<string, UseCase>();
  const put = (uc: UseCase): void => {
    const c = clean(uc);
    byId.set(c.id, { ...c, name: c.name.replace(/^NEW\s+/, '') });
  };
  for (const uc of [...(ucBundles as UseCase[]), ...(ucGifts as UseCase[])]) put(uc);
  for (const uc of ucCross as UseCase[]) put(uc);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
})();

/* ── Vocabulary ────────────────────────────────────────────────────────── */
const COV: Record<Cov, { label: string; tone: StatusBadgeTone }> = {
  F: { label: 'Tak', tone: 'success' },
  P: { label: 'Częściowo', tone: 'warning' },
  N: { label: 'Nie', tone: 'error' },
  U: { label: 'Brak danych', tone: 'neutral' },
};
const VERDICT_TONE: Record<Verdict, StatusBadgeTone> = {
  potwierdzone: 'success',
  prawdopodobne: 'info',
  sporne: 'warning',
  obalone: 'error',
  niepotwierdzone: 'neutral',
};
const PRIORITY: Record<string, { label: string; tone: StatusBadgeTone; order: number }> = {
  stage0: { label: 'Etap 0', tone: 'error', order: 0 },
  pilot: { label: 'Pilot', tone: 'warning', order: 1 },
  later: { label: 'Później', tone: 'neutral', order: 2 },
  out: { label: 'Poza zakresem', tone: 'neutral', order: 3 },
};
const CONF_TONE: Record<string, StatusBadgeTone> = {
  confirmed: 'success',
  probable: 'info',
  disputed: 'warning',
  unverified: 'neutral',
  wysoka: 'success',
  średnia: 'info',
  niska: 'warning',
};
const CONF_LABEL: Record<string, string> = {
  confirmed: 'potwierdzone',
  probable: 'prawdopodobne',
  disputed: 'sporne',
  unverified: 'niepotwierdzone',
};
const AREA_LABEL: Record<string, string> = {
  bundle: 'Zestawy',
  gift: 'Gratisy',
  cross: 'Przekrojowe',
  documents: 'Dokumenty',
  returns: 'Zwroty',
};
const ROLE_TONE: Record<string, StatusBadgeTone> = { zestaw: 'info', składnik: 'neutral', gratis: 'review', zwykła: 'neutral' };

const CASE_LABEL: Record<string, string> = Object.fromEntries(
  [...BUNDLE_MATRIX, ...GIFT_MATRIX].map((r) => [r.id, r.label]),
);
function caseLabel(id: string): string {
  return CASE_LABEL[id] ?? USE_CASES.find((u) => u.id === id)?.name ?? id;
}

const TABS = [
  { id: 'podsumowanie', label: 'Podsumowanie' },
  { id: 'przypadki', label: 'Przypadki użycia' },
  { id: 'standard', label: 'Standard i capability' },
  { id: 'decyzje', label: 'Pytania i odpowiedzi' },
  { id: 'dowody', label: 'Dowody' },
  { id: 'rundy', label: 'Spójność 5 rund' },
  { id: 'kontrargumenty', label: 'Kontrargumenty' },
  { id: 'konkurencja', label: 'Konkurencja' },
  { id: 'kod', label: 'Wpływ na kod' },
  { id: 'zakres', label: 'Zakres i issue' },
  { id: 'ux-bundle-editor', label: 'Bundle editor' },
  { id: 'ux-order', label: 'Order with a bundle' },
  { id: 'ux-bench', label: 'Pack bench' },
  { id: 'ux-gift', label: 'Gift on an order' },
  { id: 'ux-documents', label: 'Receipt and invoice' },
] as const;

function readHash(): string {
  const h = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
  return TABS.some((t) => t.id === h) ? h : 'podsumowanie';
}

/* ── Computed facts: every number on the page comes from here ─────────── */
const ROUNDS = ['r1', 'r2', 'r3', 'r4'] as const;
function roundStats() {
  let pairs = 0;
  let agree = 0;
  const pairTable: { a: string; b: string; n: number; same: number }[] = [];
  for (let i = 0; i < ROUNDS.length; i += 1) {
    for (let j = i + 1; j < ROUNDS.length; j += 1) {
      let n = 0;
      let same = 0;
      for (const c of CELLS) {
        const x = c[ROUNDS[i]];
        const y = c[ROUNDS[j]];
        if (x && y) {
          n += 1;
          if (x === y) same += 1;
        }
      }
      pairs += n;
      agree += same;
      pairTable.push({ a: ROUNDS[i], b: ROUNDS[j], n, same });
    }
  }
  const unanimous = CELLS.filter((c) => c.unanimous).length;
  const known = CELLS.filter((c) => ROUNDS.filter((r) => c[r] && c[r] !== 'U').length >= 2);
  const knownSame = known.filter((c) => new Set(ROUNDS.map((r) => c[r]).filter((v) => v && v !== 'U')).size === 1).length;
  const oppositeEnds = CELLS.filter((c) => {
    const v = new Set(ROUNDS.map((r) => c[r]).filter(Boolean));
    return v.has('F') && v.has('N');
  });
  const fullVsPartial = CELLS.filter((c) => {
    const v = new Set(ROUNDS.map((r) => c[r]).filter(Boolean));
    return v.has('F') && v.has('P');
  }).length;
  return { cells: CELLS.length, unanimous, pairs, agree, pairTable, known: known.length, knownSame, oppositeEnds, fullVsPartial, r5: CELLS.filter((c) => c.r5).length };
}

const VERDICT_RANK: Record<Verdict, number> = { potwierdzone: 0, prawdopodobne: 1, sporne: 2, obalone: 3, niepotwierdzone: 4 };
const CLAIM_BY_ID = new Map(CLAIMS.map((c) => [c.id, c]));

/** A decision may rest on a claim only if at least one of its claims is confirmed or probable. */
function decisionCheck() {
  return DECISIONS.map((d) => {
    const cs = d.claims.map((id) => CLAIM_BY_ID.get(id)).filter((c): c is Claim => Boolean(c));
    const missing = d.claims.filter((id) => !CLAIM_BY_ID.has(id));
    const solid = cs.filter((c) => c.verdict === 'potwierdzone' || c.verdict === 'prawdopodobne').length;
    return { id: d.id, ok: solid > 0 && missing.length === 0, solid, total: cs.length, missing };
  });
}

/* ── Small pieces ──────────────────────────────────────────────────────── */
function List({ items }: { items: { id: string; text: ReactNode }[] }): ReactElement {
  return (
    <ul className="spike-list">
      {items.map((i) => (
        <li key={i.id}>
          <span className="mono-text spike-id">{i.id}</span>
          <span>{i.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Bullets({ items }: { items: string[] }): ReactElement {
  return (
    <ul className="mapper__bullets">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

function Pill({ tone, children }: { tone: StatusBadgeTone; children: ReactNode }): ReactElement {
  return <StatusBadge tone={tone} compact>{children}</StatusBadge>;
}

/* ── Summary ───────────────────────────────────────────────────────────── */
function Summary(): ReactElement {
  const s = useMemo(roundStats, []);
  const checks = useMemo(decisionCheck, []);
  const byVerdict = (v: Verdict): number => CLAIMS.filter((c) => c.verdict === v).length;
  const stage0 = USE_CASES.filter((u) => u.priority === 'stage0').length;
  const pilot = USE_CASES.filter((u) => u.priority === 'pilot').length;
  return (
    <PageLayout
      eyebrow="Spike, wersja końcowa · 4 listopada 2026"
      title="Zestawy i gratisy: co robimy, a czego nie"
      description="Pięć rund badań (dwie powtórki na ślepo, jedna tylko ze źródeł pierwotnych, jedna jako adwokat diabła), trzy testy na żywo i siedem weryfikacji spornych faktów. Każdy wniosek ma dowód w zakładce Dowody."
    >
      <div className="spike-metrics">
        <MetricCard label="Przypadki użycia" value={String(USE_CASES.length)} description={`${stage0} na etap 0, ${pilot} na pilota`} />
        <MetricCard label="Twierdzenia sprawdzone" value={String(CLAIMS.length)} tone="info" description={`${byVerdict('potwierdzone')} potwierdzonych, ${byVerdict('obalone')} obalonych, ${byVerdict('sporne')} spornych`} />
        <MetricCard label="Zgodność rund o konkurencji" value={`${Math.round((s.agree / s.pairs) * 100)}%`} tone="warning" description={`Dwie rundy, ta sama komórka. Wszystkie rundy zgodne w ${Math.round((s.unanimous / s.cells) * 100)}%`} />
        <MetricCard label="Decyzje z dowodem" value={`${checks.filter((c) => c.ok).length} z ${checks.length}`} tone="success" description="Każda opiera się na twierdzeniu potwierdzonym albo prawdopodobnym" />
      </div>

      <DetailSection title="Co wynika z badań" tone="hero">
        <ol className="spike-findings">
          {[
            { t: 'Pilot nie potrzebuje całego modelu', b: 'Zakres ze spike to 55-95 dni pracy, zgłoszony G15 to 15-25. Proponujemy etap 0 zawsze (3-9 dni) i etap 1 tylko wtedy, gdy klient sprzedaje zestawy pakowane przez OpenLinkera na kanałach z routingiem (20-30 dni). Gratisy (G20) po pilocie.' },
            { t: 'Najgroźniejsza wada jest już w kodzie', b: 'Pod routingiem OMS sprzedaż paku PrestaShop zdejmuje tylko wiersz paku. Składniki nie spadają, a sklep sprzedaje je dalej. Potwierdzone testem na żywo na PrestaShop 9.0.2.' },
            { t: 'Składnik dostaje identyfikator pochodny, nie nową warstwę', b: 'Identyfikator {linia}~c:{wariant} liczony z rozwinięcia zamrożonego per zamówienie mieści się w obecnych kolumnach. Wymaga zmian w 9 miejscach, 4 z nich blokujemy w pilocie zamiast budować. Dokumenty i zwroty zostają na linii zestawu.' },
            { t: 'Gratis z rabatem 100% to nie rabat', b: 'Interpretacja KIS ze stycznia 2026 uznaje towar z rabatem 100% za nieodpłatną dostawę. Rekomendację z pierwszych rund wycofujemy. Forma gratisu na dokumencie to ustawienie operatora po decyzji doradcy, a w tej samej stawce najbezpieczniej go pominąć.' },
            { t: 'Standard: fakty w polach, platforma w manifeście, wybory u operatora', b: 'Fakty o zamówieniu to pola trzystanowe. Fakt o platformie (np. kanał wysyła dzieci zestawu) to wartość w manifeście. Forma na dokumencie to ustawienie operatora. Capability tylko tam, gdzie jest metoda do wywołania i jej implementacja.' },
          ].map((f, i) => (
            <li key={f.t} className="spike-finding">
              <span className="spike-finding__n tabular" aria-hidden="true">{i + 1}</span>
              <div className="spike-finding__body">
                <h4 className="spike-finding__title">{f.t}</h4>
                <p>{f.b}</p>
              </div>
            </li>
          ))}
        </ol>
      </DetailSection>

      <Alert tone="warning" title="Zanim ruszy etap 1">
        Potrzebne odpowiedzi klienta pilota (6 pytań w zakładce Pytania i odpowiedzi). Bez nich nie wiadomo, czy etap 1 w ogóle jest potrzebny.
      </Alert>

      <DetailSection title="Co się zmieniło względem rund 1-2">
        <List
          items={[
            { id: 'C-027', text: '"Żaden marketplace nie wysyła składu" jest nieprawdą: Allegro wysyła productSet. Nadaje się tylko do kontroli.' },
            { id: 'C-068', text: 'Forma "cena katalogowa + rabat 100%" wycofana po interpretacji KIS 2026.' },
            { id: 'C-072', text: 'Kolizji w kodzie nie jest 6: zmienić trzeba 9 miejsc, a linie przesyłki nie kolidują.' },
            { id: 'C-073', text: '"Wszyscy zabraniają zestawów w zestawie" nieprawda: Cin7 pozwala. Cytat BaseLinkera dotyczył innego pola.' },
            { id: 'C-047', text: 'Kilku konkurentów ma politykę na brak gratisu. Żaden nie podmienia go ani nie informuje kupującego.' },
            { id: 'C-017', text: 'Shopify publikuje sposób podziału ceny zestawu: waga cena x ilość. Ten wzór przyjmujemy jako domyślny.' },
          ]}
        />
      </DetailSection>
    </PageLayout>
  );
}

/* ── Use-case browser ──────────────────────────────────────────────────── */
function UseCaseDetail({ uc }: { uc: UseCase }): ReactElement {
  const cov = CELLS.filter((c) => c.id === uc.id);
  const p = PRIORITY[uc.priority] ?? PRIORITY.later;
  return (
    <article className="uc-detail" aria-labelledby={`uc-${uc.id}`}>
      <header className="uc-detail__head">
        <span className="mono-text spike-id">{uc.id}</span>
        <h3 id={`uc-${uc.id}`} className="uc-detail__title">{uc.name}</h3>
        <div className="uc-detail__badges">
          <Pill tone={p.tone}>{p.label}</Pill>
          <Pill tone={CONF_TONE[uc.confidence] ?? 'neutral'}>{CONF_LABEL[uc.confidence] ?? uc.confidence}</Pill>
          <Pill tone="neutral">{uc.mechanism}</Pill>
        </div>
        <p className="spike-note">{uc.priorityReason}</p>
      </header>
      <KeyValueList
        items={[
          { id: 'actor', label: 'Actor', value: uc.actor },
          { id: 'trigger', label: 'Trigger', value: uc.trigger },
          { id: 'ol', label: 'OpenLinker', value: uc.olBehaviour },
        ]}
      />
      {uc.preconditions.length ? (
        <section>
          <h4 className="spike-h4">Preconditions</h4>
          <Bullets items={uc.preconditions} />
        </section>
      ) : null}
      <section>
        <h4 className="spike-h4">Main flow</h4>
        <ol className="uc-steps">
          {uc.mainFlow.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </section>
      {uc.altFlows.length ? (
        <section>
          <h4 className="spike-h4">Alternatives and exceptions</h4>
          <Bullets items={uc.altFlows} />
        </section>
      ) : null}
      {Object.keys(uc.channelData).length ? (
        <section>
          <h4 className="spike-h4">What each channel sends</h4>
          <KeyValueList items={Object.entries(uc.channelData).map(([k, v]) => ({ id: k, label: k, value: v }))} />
        </section>
      ) : null}
      <section>
        <h4 className="spike-h4">Acceptance criteria</h4>
        <ol className="uc-gwt">
          {uc.acceptance.map((a, i) => (
            <li key={i}>
              <span><b>Given</b> {a.given}</span>
              <span><b>When</b> {a.when}</span>
              <span><b>Then</b> {a.then}</span>
            </li>
          ))}
        </ol>
      </section>
      {cov.length ? (
        <section>
          <h4 className="spike-h4">Konkurencja (wynik po 5 rundach)</h4>
          <div className="uc-cov">
            {cov.map((c) => (
              <span key={c.competitor} className="uc-cov__item">
                <span>{c.competitor}</span>
                <Pill tone={COV[c.final].tone}>{COV[c.final].label}</Pill>
              </span>
            ))}
          </div>
        </section>
      ) : null}
      {uc.risks.length ? (
        <section>
          <h4 className="spike-h4">Risks</h4>
          <Bullets items={uc.risks} />
        </section>
      ) : null}
      <section>
        <h4 className="spike-h4">Evidence</h4>
        <p className="uc-evidence">{uc.evidence.join(' · ')}</p>
      </section>
    </article>
  );
}

function UseCasesTab(): ReactElement {
  const [area, setArea] = useState('all');
  const [prio, setPrio] = useState('all');
  const [conf, setConf] = useState('all');
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return USE_CASES.filter(
      (u) =>
        (area === 'all' || u.area === area) &&
        (prio === 'all' || u.priority === prio) &&
        (conf === 'all' || u.confidence === conf) &&
        (!needle || `${u.id} ${u.name} ${u.olBehaviour} ${Object.values(u.channelData).join(' ')}`.toLowerCase().includes(needle)),
    ).sort((a, b) => (PRIORITY[a.priority]?.order ?? 9) - (PRIORITY[b.priority]?.order ?? 9) || a.id.localeCompare(b.id, 'en', { numeric: true }));
  }, [area, prio, conf, q]);
  const [sel, setSel] = useState<string>('');
  const current = list.find((u) => u.id === sel) ?? list[0];
  const areas = [...new Set(USE_CASES.map((u) => u.area))];
  return (
    <PageLayout
      eyebrow="Etap 3"
      title="Przypadki użycia"
      description={`${USE_CASES.length} przypadków rozpisanych przez trzech autorów na podstawie wszystkich rund. Treść przypadków jest po angielsku, tak jak specyfikacje w repo. Wybierz przypadek, żeby zobaczyć scenariusz, dane z kanałów i kryteria akceptacji.`}
    >
      <div className="uc-filters">
        <label className="uc-filter">
          <span>Obszar</span>
          <Select value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="all">Wszystkie</option>
            {areas.map((a) => (
              <option key={a} value={a}>{AREA_LABEL[a] ?? a}</option>
            ))}
          </Select>
        </label>
        <label className="uc-filter">
          <span>Priorytet</span>
          <Select value={prio} onChange={(e) => setPrio(e.target.value)}>
            <option value="all">Wszystkie</option>
            {Object.entries(PRIORITY).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </Select>
        </label>
        <label className="uc-filter">
          <span>Pewność dowodów</span>
          <Select value={conf} onChange={(e) => setConf(e.target.value)}>
            <option value="all">Wszystkie</option>
            {Object.entries(CONF_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </label>
        <label className="uc-filter uc-filter--grow">
          <span>Szukaj</span>
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="np. Allegro, eparagony, return" />
        </label>
      </div>
      <p className="spike-footnote" aria-live="polite">Pokazano {list.length} z {USE_CASES.length}.</p>
      {list.length === 0 ? (
        <EmptyState eyebrow="Filtry" title="Brak przypadków" message="Zmień filtry, żeby zobaczyć przypadki." />
      ) : (
        <div className="uc-browser">
          <ul className="uc-list" aria-label="Lista przypadków">
            {list.map((u) => {
              const p = PRIORITY[u.priority] ?? PRIORITY.later;
              const active = current?.id === u.id;
              return (
                <li key={u.id}>
                  <button type="button" className={`uc-item${active ? ' uc-item--active' : ''}`} aria-current={active ? 'true' : undefined} onClick={() => setSel(u.id)}>
                    <span className="uc-item__top">
                      <span className="mono-text spike-id">{u.id}</span>
                      <Pill tone={p.tone}>{p.label}</Pill>
                    </span>
                    <span className="uc-item__name">{u.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {current ? <UseCaseDetail uc={current} /> : null}
        </div>
      )}
    </PageLayout>
  );
}

/* ── Standard ──────────────────────────────────────────────────────────── */
function ChannelMapper(): ReactElement {
  const [id, setId] = useState<string>(CHANNELS[0].id);
  const ch = CHANNELS.find((c) => c.id === id) ?? CHANNELS[0];
  return (
    <div className="mapper">
      <p className="mapper__scenario">{SCENARIO}</p>
      <SegmentedControl aria-label="Kanał sprzedaży" options={CHANNELS.map((c) => ({ value: c.id, label: c.label }))} value={id} onChange={setId} className="mapper__switch" />
      <div className="mapper__grid" aria-live="polite">
        <section className="mapper__col">
          <h4 className="mapper__h">
            <span className="mapper__step tabular" aria-hidden="true">1</span>
            Co przysyła kanał
            <StatusBadge tone="neutral" compact>{ch.shape}</StatusBadge>
          </h4>
          <pre className="mapper__wire">
            {ch.wire.map((w, i) => (
              <span key={i} className={w.tone ? `mapper__wire--${w.tone}` : undefined}>
                {w.text}
                {'\n'}
              </span>
            ))}
          </pre>
          <h5 className="mapper__sub">Jak to rozpoznajemy</h5>
          <Bullets items={ch.declares} />
        </section>
        <section className="mapper__col mapper__col--model">
          <h4 className="mapper__h">
            <span className="mapper__step tabular" aria-hidden="true">2</span>
            Linie w OpenLinkerze
          </h4>
          <div className="data-table__container spike-scroll">
            <table className="data-table mapper__table">
              <caption className="spike-sr">Linie w OpenLinkerze</caption>
              <thead>
                <tr>
                  <th scope="col">Linia</th>
                  <th scope="col">Rola</th>
                  <th scope="col" className="data-table__cell--right">Zapłacono</th>
                  <th scope="col">Skąd</th>
                </tr>
              </thead>
              <tbody>
                {ch.neutral.map((n) => (
                  <tr key={n.key} className={n.role === 'składnik' ? 'mapper__row--child' : undefined}>
                    <th scope="row">
                      <span className="mono-text spike-id">{n.key}</span> {n.name}
                      {n.reduction ? <span className="spike-note">{n.reduction}</span> : null}
                    </th>
                    <td><Pill tone={ROLE_TONE[n.role]}>{n.role}</Pill></td>
                    <td className="data-table__cell--right tabular">{n.paid}</td>
                    <td className="spike-note-cell">{n.origin}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="mapper__col">
          <h4 className="mapper__h">
            <span className="mapper__step tabular" aria-hidden="true">3</span>
            Co robi core
          </h4>
          <Bullets items={ch.core} />
          {ch.gap ? (
            <Alert tone="warning" density="compact" title="Uwaga">
              {ch.gap}
            </Alert>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function StandardTab(): ReactElement {
  return (
    <PageLayout
      eyebrow="Propozycja po 5 rundach"
      title="Standard: integration-agnostic i country-agnostic"
      description="Każda integracja mówi o zestawach i gratisach inaczej. Standard rozdziela to, co adapter tłumaczy, od tego, co core robi tak samo dla każdego kanału i kraju."
    >
      <DetailSection title="Ten sam zestaw z każdego kanału">
        <ChannelMapper />
      </DetailSection>

      <DetailSection title="Elementy standardu">
        <div className="data-table__container spike-scroll">
          <table className="data-table spike-def">
            <thead>
              <tr>
                <th scope="col">Element</th>
                <th scope="col">Rodzaj</th>
                <th scope="col">Gdzie</th>
                <th scope="col">Co niesie</th>
                <th scope="col">Gdy brak</th>
                <th scope="col">Kiedy</th>
              </tr>
            </thead>
            <tbody>
              {STANDARD.map((s) => (
                <tr key={s.name}>
                  <th scope="row"><code className="mono-text">{s.name}</code></th>
                  <td>{s.kind}</td>
                  <td>{s.where}</td>
                  <td>{s.what}</td>
                  <td>{s.absent}</td>
                  <td><Pill tone={s.when === 'Później' ? 'neutral' : s.when === 'Etap 1' ? 'warning' : 'error'}>{s.when}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DetailSection>

      <DetailSection title="Zasada wyboru formy">
        <KeyValueList
          items={[
            { id: 'f1', label: 'Fakt o zamówieniu', value: 'Pole trzystanowe na linii lub zamówieniu: brak = adapter nie umie powiedzieć, null = sprawdzone i nie ma, wartość = fakt. Wzór: buyerTaxId, gpsr.' },
            { id: 'f2', label: 'Fakt o platformie', value: 'Wartość w manifeście adaptera z najbardziej restrykcyjnym domyślnym (wzór variantGrouping). Nigdy nazwa capability, bo ta trafia do enabledCapabilities przy tworzeniu połączenia (#2085).' },
            { id: 'f3', label: 'Wybór biznesowy lub podatkowy', value: 'Ustawienie operatora per połączenie (wzór ADR-082 freeDelivery). Core nigdy nie wybiera traktowania podatkowego (ADR-063, ADR-026).' },
            { id: 'f4', label: 'Limit urządzenia', value: 'Metoda wymagana na porcie dokumentów (ADR-046), odczyt z declared i resolvedVia. Brak deklaracji to odmowa z powodem, nigdy cicha zmiana dokumentu (ADR-014).' },
            { id: 'f5', label: 'Akcja w kanale', value: 'Capability guard-only, gdy jest metoda do wywołania i implementacja (ADR-048 decyzja 1).' },
          ]}
        />
      </DetailSection>

      <DetailSection title="Dokumenty">
        <Bullets items={DOC_NOTES} />
      </DetailSection>

      <DetailSection title="Odrzucone z propozycji rund 1-2">
        <div className="data-table__container spike-scroll">
          <table className="data-table spike-def">
            <thead>
              <tr>
                <th scope="col">Element</th>
                <th scope="col">Dlaczego odpada</th>
              </tr>
            </thead>
            <tbody>
              {DROPPED.map((d) => (
                <tr key={d.name}>
                  <th scope="row"><code className="mono-text">{d.name}</code></th>
                  <td>{d.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DetailSection>

      <DetailSection title="Zasady country-agnostic">
        <KeyValueList
          items={[
            { id: 'c1', label: 'Progi i kwoty', value: 'Żadnych kwot w core. 20 zł i 100 zł z polskiego art. 7 ust. 4 to pakiet krajowy albo ustawienie, nie reguła core.' },
            { id: 'c2', label: 'Typ darmowej linii', value: 'Polska (KIS 2026) traktuje gratis z rabatem 100% jako nieodpłatną dostawę, Włochy towar w ramach rabatu wyłączają z podstawy, chyba że ma wyższą stawkę. Core zapisuje fakty, adapter i ustawienie decydują.' },
            { id: 'c3', label: 'Podział ceny zestawu', value: 'Domyślnie proporcjonalnie do cen składników osobno (MF 2017, TSUE CPP, BFH). Wynik zapisany na zamówieniu.' },
            { id: 'c4', label: 'Pola kanałów', value: 'productSet, reconciliation, unitPriceBeforeRebate, offered_quantity, orderSalesMode, P_10 i rebatesMarkups zostają w adapterach.' },
          ]}
        />
      </DetailSection>
    </PageLayout>
  );
}

/* ── Decisions ─────────────────────────────────────────────────────────── */
function DecisionsTab(): ReactElement {
  const checks = useMemo(() => new Map(decisionCheck().map((c) => [c.id, c])), []);
  return (
    <PageLayout
      eyebrow="Etap 4"
      title="Pytania i odpowiedzi"
      description="Każde pytanie ze spike dostało odpowiedź z dowodami, kontrargumentem z rundy 5 i warunkiem, który zmieniłby decyzję."
    >
      {DECISIONS.map((d) => {
        const c = checks.get(d.id);
        return (
          <DetailSection
            key={d.id}
            title={<span><span className="mono-text">{d.id}</span> {d.question}</span>}
            titleAside={<Pill tone={CONF_TONE[d.confidence as Confidence]}>pewność {d.confidence}</Pill>}
          >
            <p className="dec-verdict">{d.verdict}</p>
            <KeyValueList
              items={[
                { id: 'o', label: 'Opcje', value: d.options.join(' · ') },
                { id: 'w', label: 'Dlaczego', value: d.why },
                { id: 'k', label: 'Kontrargument', value: d.counter },
                { id: 'r', label: 'Nasza odpowiedź', value: d.response },
                { id: 'z', label: 'Co zmieniłoby decyzję', value: d.wouldChange },
                {
                  id: 'd',
                  label: 'Dowody',
                  value: (
                    <span className="dec-claims">
                      {d.claims.map((id) => {
                        const cl = CLAIM_BY_ID.get(id);
                        return (
                          <span key={id} className="dec-claim">
                            <span className="mono-text">{id}</span>
                            {cl ? <Pill tone={VERDICT_TONE[cl.verdict]}>{cl.verdict}</Pill> : <Pill tone="error">brak w rejestrze</Pill>}
                          </span>
                        );
                      })}
                      {c && !c.ok ? <Pill tone="error">brak potwierdzonego dowodu</Pill> : null}
                    </span>
                  ),
                },
              ]}
            />
          </DetailSection>
        );
      })}
      <div className="spike-two">
        <DetailSection title="Pytania do klienta pilota">
          <List items={CLIENT_QUESTIONS.map((t, i) => ({ id: `K${i + 1}`, text: t }))} />
        </DetailSection>
        <DetailSection title="Pytania do doradcy podatkowego">
          <List items={ADVISER_QUESTIONS.map((t, i) => ({ id: `D${i + 1}`, text: t }))} />
          <p className="spike-footnote">Badanie, nie porada prawna. Interpretacje KIS wiążą tylko wnioskodawcę.</p>
        </DetailSection>
      </div>
    </PageLayout>
  );
}

/* ── Evidence ──────────────────────────────────────────────────────────── */
function EvidenceTab(): ReactElement {
  const [v, setV] = useState('all');
  const [a, setA] = useState('all');
  const areas = [...new Set(CLAIMS.map((c) => c.area))];
  const list = CLAIMS.filter((c) => (v === 'all' || c.verdict === v) && (a === 'all' || c.area === a)).sort(
    (x, y) => VERDICT_RANK[x.verdict] - VERDICT_RANK[y.verdict] || x.id.localeCompare(y.id, 'en', { numeric: true }),
  );
  const count = (verdict: Verdict): number => CLAIMS.filter((c) => c.verdict === verdict).length;
  return (
    <PageLayout
      eyebrow="Rejestr twierdzeń"
      title="Dowody"
      description="Każde twierdzenie, na którym stoi decyzja. Potwierdzone to dwa niezależne źródła albo test na żywo. Prawdopodobne to jedno źródło pierwotne."
    >
      <div className="spike-metrics">
        <MetricCard label="Potwierdzone" value={String(count('potwierdzone'))} tone="success" description={`${CLAIMS.filter((c) => c.live).length} z testu na żywo`} />
        <MetricCard label="Prawdopodobne" value={String(count('prawdopodobne'))} tone="info" />
        <MetricCard label="Sporne" value={String(count('sporne'))} tone="warning" />
        <MetricCard label="Obalone" value={String(count('obalone'))} tone="error" />
      </div>
      <div className="uc-filters">
        <label className="uc-filter">
          <span>Werdykt</span>
          <Select value={v} onChange={(e) => setV(e.target.value)}>
            <option value="all">Wszystkie</option>
            {(['potwierdzone', 'prawdopodobne', 'sporne', 'obalone'] as Verdict[]).map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </Select>
        </label>
        <label className="uc-filter">
          <span>Obszar</span>
          <Select value={a} onChange={(e) => setA(e.target.value)}>
            <option value="all">Wszystkie</option>
            {areas.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </Select>
        </label>
      </div>
      <div className="data-table__container spike-scroll">
        <table className="data-table spike-def">
          <caption className="spike-sr">Rejestr twierdzeń</caption>
          <thead>
            <tr>
              <th scope="col">Twierdzenie</th>
              <th scope="col">Werdykt</th>
              <th scope="col">Co się zmieniło</th>
              <th scope="col">Dowód</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <th scope="row">
                  <span className="mono-text spike-id">{c.id} · {c.area}</span>
                  <span className="ev-text">{c.text}</span>
                </th>
                <td>
                  <Pill tone={VERDICT_TONE[c.verdict]}>{c.verdict}</Pill>
                  {c.live ? <span className="spike-note">test na żywo</span> : null}
                </td>
                <td>{c.change ?? <span className="spike-note">bez zmian</span>}</td>
                <td className="spike-note-cell">{c.evidence.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageLayout>
  );
}

/* ── Round consistency ─────────────────────────────────────────────────── */
function RoundsTab(): ReactElement {
  const s = useMemo(roundStats, []);
  const [comp, setComp] = useState('all');
  const rows = s.oppositeEnds.filter((c) => comp === 'all' || c.competitor === comp);
  return (
    <PageLayout
      eyebrow="Weryfikacja"
      title="Spójność 5 rund"
      description="Rundy 1-4 oceniały 7 konkurentów niezależnie (runda 3 na ślepo, runda 4 tylko ze źródeł pierwotnych). Runda 5 rozstrzygała spory. Liczby poniżej liczy strona z surowych ocen."
    >
      <div className="spike-metrics">
        <MetricCard label="Komórki macierzy" value={String(s.cells)} description="przypadek x konkurent, w co najmniej jednej rundzie" />
        <MetricCard label="Zgodne we wszystkich rundach" value={`${Math.round((s.unanimous / s.cells) * 100)}%`} tone="warning" description={`${s.unanimous} z ${s.cells}`} />
        <MetricCard label="Zgodne, gdy obie rundy coś znalazły" value={`${Math.round((s.knownSame / s.known) * 100)}%`} tone="info" description={`Bez "brak danych": ${s.knownSame} z ${s.known}`} />
        <MetricCard label="Tak i Nie dla tej samej komórki" value={String(s.oppositeEnds.length)} tone="error" description={`Rozstrzygnięte przez R5: ${s.oppositeEnds.filter((c) => c.r5).length}`} />
      </div>

      <DetailSection title="Zgodność par rund">
        <div className="data-table__container spike-scroll">
          <table className="data-table spike-def">
            <thead>
              <tr>
                <th scope="col">Para</th>
                <th scope="col" className="data-table__cell--right">Wspólne komórki</th>
                <th scope="col" className="data-table__cell--right">Ta sama ocena</th>
                <th scope="col" className="data-table__cell--right">Zgodność</th>
              </tr>
            </thead>
            <tbody>
              {s.pairTable.map((p) => (
                <tr key={`${p.a}${p.b}`}>
                  <th scope="row">{p.a.toUpperCase()} i {p.b.toUpperCase()}</th>
                  <td className="data-table__cell--right tabular">{p.n}</td>
                  <td className="data-table__cell--right tabular">{p.same}</td>
                  <td className="data-table__cell--right tabular">{Math.round((p.same / p.n) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="spike-footnote">
          Pominięcie "brak danych" podnosi zgodność tylko do {Math.round((s.knownSame / s.known) * 100)}%. Większość sporów to "Tak" kontra "Częściowo" ({s.fullVsPartial} komórek), czyli różnica w tym, co agent uznał za pełne wsparcie, a nie w faktach. Ostrych sporów "Tak" kontra "Nie" jest {s.oppositeEnds.length}. Dlatego oceny konkurencji traktujemy jako kierunek, a nie liczbę do porównań. Wynik końcowy bierze rozstrzygnięcie R5, a bez niego najczęstszą ocenę, przy remisie rundę 4 (tylko źródła pierwotne).
        </p>
      </DetailSection>

      <DetailSection title="Najostrzejsze spory: Tak i Nie dla tej samej komórki">
        <label className="uc-filter">
          <span>Konkurent</span>
          <Select value={comp} onChange={(e) => setComp(e.target.value)}>
            <option value="all">Wszyscy</option>
            {COMPETITORS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </label>
        <div className="data-table__container spike-scroll">
          <table className="data-table spike-def">
            <thead>
              <tr>
                <th scope="col">Przypadek</th>
                <th scope="col">System</th>
                {ROUNDS.map((r) => (
                  <th key={r} scope="col">{r.toUpperCase()}</th>
                ))}
                <th scope="col">R5</th>
                <th scope="col">Wynik</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={`${c.id}${c.competitor}`}>
                  <th scope="row"><span className="mono-text spike-id">{c.id}</span> {caseLabel(c.id)}</th>
                  <td>{c.competitor}</td>
                  {ROUNDS.map((r) => (
                    <td key={r}>{c[r] ? <Pill tone={COV[c[r] as Cov].tone}>{COV[c[r] as Cov].label}</Pill> : <span className="spike-note">-</span>}</td>
                  ))}
                  <td>{c.r5 ? <Pill tone={COV[c.r5].tone}>{COV[c.r5].label}</Pill> : <span className="spike-note">-</span>}</td>
                  <td><Pill tone={COV[c.final].tone}>{COV[c.final].label}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DetailSection>
    </PageLayout>
  );
}

/* ── Counterarguments ──────────────────────────────────────────────────── */
function CountersTab(): ReactElement {
  const tone = { przyjęte: 'success', częściowo: 'warning', odrzucone: 'error' } as const;
  return (
    <PageLayout
      eyebrow="Runda 5 i stress-test"
      title="Kontrargumenty"
      description="Czwórka adwokatów diabła, stress-test standardu i weryfikatorzy dostali nasze wnioski z zadaniem ich obalenia. Większość uwag przyjęliśmy."
    >
      <div className="spike-metrics">
        {(['przyjęte', 'częściowo', 'odrzucone'] as const).map((k) => (
          <MetricCard key={k} label={k[0].toUpperCase() + k.slice(1)} value={String(COUNTERS.filter((c) => c.accepted === k).length)} tone={tone[k]} />
        ))}
      </div>
      <div className="data-table__container spike-scroll">
        <table className="data-table spike-def">
          <thead>
            <tr>
              <th scope="col">Skąd</th>
              <th scope="col">Zarzut</th>
              <th scope="col">Odpowiedź</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {COUNTERS.map((c, i) => (
              <tr key={i}>
                <th scope="row">{c.from}</th>
                <td>{c.claim}</td>
                <td>{c.response}</td>
                <td><Pill tone={tone[c.accepted]}>{c.accepted}</Pill></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageLayout>
  );
}

/* ── Competition ───────────────────────────────────────────────────────── */
function CompetitionTab(): ReactElement {
  const ids = useMemo(() => {
    const all = [...new Set(CELLS.map((c) => c.id))];
    return all.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }, []);
  const [area, setArea] = useState<'B' | 'G' | 'X'>('B');
  const shown = ids.filter((i) => i.startsWith(area));
  const totals = COMPETITORS.map((c) => {
    const mine = CELLS.filter((x) => x.competitor === c);
    return { c, F: mine.filter((x) => x.final === 'F').length, P: mine.filter((x) => x.final === 'P').length, n: mine.length };
  });
  return (
    <PageLayout
      eyebrow="Wynik po 5 rundach"
      title="Konkurencja"
      description="Ocena końcowa każdej komórki. Najedź na komórkę, żeby zobaczyć oceny z poszczególnych rund."
    >
      <div className="spike-metrics">
        {totals.map((t) => (
          <MetricCard key={t.c} label={t.c} value={`${t.F} / ${t.P}`} description={`Tak / Częściowo z ${t.n} przypadków`} />
        ))}
      </div>
      <SegmentedControl
        aria-label="Obszar"
        options={[
          { value: 'B', label: 'Zestawy' },
          { value: 'G', label: 'Gratisy' },
          { value: 'X', label: 'Przekrojowe' },
        ]}
        value={area}
        onChange={(v) => setArea(v as 'B' | 'G' | 'X')}
      />
      <div className="data-table__container spike-scroll" tabIndex={0} aria-label="Macierz konkurencji">
        <table className="data-table spike-matrix">
          <thead>
            <tr>
              <th scope="col">Przypadek</th>
              {COMPETITORS.map((c) => (
                <th key={c} scope="col">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((id) => (
              <tr key={id}>
                <th scope="row" className="spike-matrix__case">
                  <span className="mono-text spike-id">{id}</span>
                  <span>{caseLabel(id)}</span>
                </th>
                {COMPETITORS.map((c) => {
                  const cell = CELLS.find((x) => x.id === id && x.competitor === c);
                  if (!cell) return <td key={c}><span className="spike-note">-</span></td>;
                  const hist = ROUNDS.map((r) => `${r.toUpperCase()}: ${cell[r] ? COV[cell[r] as Cov].label : '-'}`).join(', ') + (cell.r5 ? `, R5: ${COV[cell.r5].label}` : '');
                  return (
                    <td key={c} title={hist} className={cell.unanimous ? undefined : 'spike-cell--moved'}>
                      <Pill tone={COV[cell.final].tone}>{COV[cell.final].label}</Pill>
                      {!cell.unanimous ? <span className="spike-was">rundy się różniły</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DetailSection title="Jak konkurenci radzą sobie z różnymi kanałami">
        <KeyValueList
          items={[
            { id: 'n1', label: 'Wszyscy', value: 'Zestaw rozpoznają przez powiązanie oferty z produktem w katalogu. Żaden nie czyta kształtu zestawu z kanału ani nie wymaga od integracji deklaracji.' },
            { id: 'n2', label: 'Linnworks', value: 'Integracja deklaruje flagi po sprzedaży i UI się dopasowuje, ale bez zestawów i gratisów. Dla rodzica i dzieci tylko przełącznik Magento.' },
            { id: 'n3', label: 'Shopify', value: 'Jeden kształt dla aplikacji (składniki w grupie, publiczny wzór podziału ceny), ale tylko dla zamówień z koszyka.' },
            { id: 'n4', label: 'Cin7', value: 'Ustawienie rozbijania per integracja z wyjątkiem dla zamówień realizowanych przez marketplace (FBA).' },
            { id: 'n5', label: 'BaseLinker, Apilo, Sellasist', value: 'Jeden globalny przełącznik rozbijania albo akcja automatyzacji. Rabaty kodowane osobno w każdej integracji.' },
            { id: 'n6', label: 'Brightpearl', value: 'Tabela zachowań zestawów per konektor w dokumentacji, najbliżej naszych deklaracji, ale tylko jako tekst.' },
          ]}
        />
      </DetailSection>
    </PageLayout>
  );
}

/* ── Code impact ───────────────────────────────────────────────────────── */
function CodeTab(): ReactElement {
  const tone = { zmienić: 'warning', zablokować: 'error', 'bez zmian': 'success', spec: 'info' } as const;
  return (
    <PageLayout eyebrow="OpenLinker" title="Wpływ na kod" description="Miejsca potwierdzone weryfikacją identyfikatora składnika i stress-testem standardu (HEAD 9e35aec9d).">
      <DetailSection title="Etap 0: naprawy niezależne od zestawów">
        <div className="data-table__container spike-scroll">
          <table className="data-table spike-def">
            <thead>
              <tr>
                <th scope="col">Naprawa</th>
                <th scope="col">Rozmiar</th>
                <th scope="col">Dlaczego</th>
              </tr>
            </thead>
            <tbody>
              {STAGE0.map((s) => (
                <tr key={s.title}>
                  <th scope="row">{s.title}</th>
                  <td className="tabular">{s.size}</td>
                  <td>{s.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DetailSection>
      <DetailSection title="Etap 1: miejsca dotknięte identyfikatorem składnika">
        <div className="data-table__container spike-scroll">
          <table className="data-table spike-def">
            <thead>
              <tr>
                <th scope="col">Miejsce</th>
                <th scope="col">Co się dzieje</th>
                <th scope="col">Działanie</th>
              </tr>
            </thead>
            <tbody>
              {CODE_SITES.map((c) => (
                <tr key={c.site}>
                  <th scope="row"><code className="mono-text">{c.site}</code></th>
                  <td>{c.what}</td>
                  <td><Pill tone={tone[c.action]}>{c.action}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DetailSection>
      <DetailSection title="Warunki, bez których etap 1 jest niebezpieczny">
        <List
          items={[
            { id: 'W1', text: 'ATP zestawu przeliczane po każdej zmianie składnika (odwrotne rozgłoszenie), inaczej oferta zestawu sprzedaje ze starego stanu.' },
            { id: 'W2', text: 'Negatywny fakt per zamówienie w transakcji pierwszego "ready": zamówienie sprzed definicji nigdy nie dostaje rozwinięcia później.' },
            { id: 'W3', text: 'Rozwinięcie sprawdza, że wariant linii nadal jest wariantem zestawu, inaczej uwaga operatora i brak routingu.' },
            { id: 'W4', text: 'Receptura scalona per wariant składnika, rozwinięcie niesie productId składnika, identyfikator nigdy nie jest parsowany.' },
            { id: 'W5', text: 'Spec przypinający dzisiejsze bezpieczne zachowanie rezerwacji wchłanianych przez mastera (order-sync.service.ts:515).' },
          ]}
        />
      </DetailSection>
      <DetailSection title="Co adaptery dziś pomijają">
        <KeyValueList
          items={[
            { id: 'a1', label: 'Allegro', value: 'productSet, originalPrice, discounts, reconciliation (Allegro Ceny), płatne pakowanie na prezent (blokuje dokument)' },
            { id: 'a2', label: 'PrestaShop', value: 'reguły koszyka z gratisem, skład paku; komentarz o osobnej linii gratisu częściowo błędny' },
            { id: 'a3', label: 'Shoper', value: 'type i children w zamówieniach' },
            { id: 'a4', label: 'Erli', value: 'waluta EUR (zapisywane jako PLN), stawki spoza PL, unitPriceBeforeRebate' },
            { id: 'a5', label: 'Subiekt GT', value: 'PominAsortymentPowiazany nieustawione (prawdopodobny błąd ceny na pozycji powiązanej)' },
            { id: 'a6', label: 'Dokumenty', value: 'KSeF bez P_10, eparagony bez kontroli stawki z wartością 0' },
          ]}
        />
      </DetailSection>
    </PageLayout>
  );
}

/* ── Scope ─────────────────────────────────────────────────────────────── */
function ScopeTab(): ReactElement {
  const stages = ['Etap 0', 'Etap 1', 'Etap 2', 'Etap 3'] as const;
  return (
    <PageLayout eyebrow="Plan" title="Zakres i issue" description="Szkice zmian. Na GitHubie nic nie zmieniono.">
      <div className="spike-metrics">
        <MetricCard label="Etap 0" value="3-9 dni" tone="error" description="Zawsze, naprawia wady działające dziś" />
        <MetricCard label="Etap 1" value="20-30 dni" tone="warning" description="Tylko jeśli klient sprzedaje zestawy pakowane przez OL" />
        <MetricCard label="Etap 2" value="20-35 dni" description="Po pilocie i po doradcy: dokumenty i zwroty składników" />
        <MetricCard label="Etap 3" value="25-45 dni" description="Gratisy (G20), wyróżnik na rynku" />
      </div>
      {stages.map((st) => (
        <DetailSection key={st} title={st}>
          <div className="data-table__container spike-scroll">
            <table className="data-table spike-def">
              <thead>
                <tr>
                  <th scope="col">Issue</th>
                  <th scope="col">Tytuł</th>
                  <th scope="col">Zmiana</th>
                </tr>
              </thead>
              <tbody>
                {ISSUES.filter((i) => i.stage === st).map((i) => (
                  <tr key={i.title}>
                    <th scope="row" className="mono-text">{i.ref}</th>
                    <td>{i.title}</td>
                    <td>{i.change}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DetailSection>
      ))}
      <p className="spike-footnote">Etap 0.5: odpowiedzi klienta pilota i start rozmowy z doradcą podatkowym, bez pracy deweloperskiej.</p>
    </PageLayout>
  );
}

function Placeholder({ title }: { title: string }): ReactElement {
  return (
    <PageLayout eyebrow="UX" title={title} description="This screen is designed once the scope and the standard are agreed.">
      <EmptyState eyebrow="Next step" title="Not designed yet" message="We design this screen first, then shape the backend to it." />
    </PageLayout>
  );
}

export function App(): ReactElement {
  const [tab, setTab] = useState<string>(readHash);
  useEffect(() => {
    const onHash = (): void => setTab(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const change = (value: string): void => {
    setTab(value);
    try {
      history.replaceState(null, '', `#${value}`);
    } catch {
      /* hash routing is a convenience only */
    }
  };
  return (
    <main className="spike-shell">
      <Tabs value={tab} onValueChange={change}>
        <TabsList aria-label="Sekcje spike'a">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className={t.id.startsWith('ux-') ? 'spike-tab--ux' : undefined}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="podsumowanie"><Summary /></TabsContent>
        <TabsContent value="przypadki"><UseCasesTab /></TabsContent>
        <TabsContent value="standard"><StandardTab /></TabsContent>
        <TabsContent value="decyzje"><DecisionsTab /></TabsContent>
        <TabsContent value="dowody"><EvidenceTab /></TabsContent>
        <TabsContent value="rundy"><RoundsTab /></TabsContent>
        <TabsContent value="kontrargumenty"><CountersTab /></TabsContent>
        <TabsContent value="konkurencja"><CompetitionTab /></TabsContent>
        <TabsContent value="kod"><CodeTab /></TabsContent>
        <TabsContent value="zakres"><ScopeTab /></TabsContent>
        {TABS.filter((t) => t.id.startsWith('ux-')).map((t) => (
          <TabsContent key={t.id} value={t.id}><Placeholder title={t.label} /></TabsContent>
        ))}
      </Tabs>
    </main>
  );
}
