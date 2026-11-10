/**
 * Pack bench: a parcel with a bundle (scanned per component) and a gift as its
 * own scannable line. Built from the bench's own classes and BenchThumb, with
 * Polish copy. Packers never see costs here.
 */
import { useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { Button } from '@web/shared/ui/button';
import { Alert } from '@web/shared/ui/alert';
import { StatusBadge, type StatusBadgeTone } from '@web/shared/ui/status-badge';
import { useToast } from '@web/shared/ui/toast-provider';
import { BenchThumb } from '@web/features/bench/components/bench-thumb';
import { BUNDLES } from '../model/catalog';
import { commonStates, useProto, useWriteGuard, type ScreenDef, type StateDef } from '../proto';
import { BundleMark, GiftMark, PartOf } from '../ui/marks';
import { v, type BenchLine } from './ord-data';
import './ord.css';

const BUNDLE_EAN = '5909990001112';

interface Parcel {
  order: string;
  buyer: string;
  index: number;
  total: number;
  carrier: string;
  shipBy: string;
  lines: BenchLine[];
  notes?: { body: string; who: string }[];
  wrap?: { instruction: string; message: string };
  siblings?: { index: number; items: string; state: string; gift: boolean }[];
}

const morningLines = (mug = 0, coffee = 0, spoon = 0, withGift = true): BenchLine[] => [
  { id: 'L1~c:mug', variant: 'mug', required: 1, verified: mug, partOf: 'Zestaw poranny', bin: 'A-03' },
  { id: 'L1~c:coffee', variant: 'coffee', required: 1, verified: coffee, partOf: 'Zestaw poranny', bin: 'B-11' },
  ...(withGift ? [{ id: 'ol-gift:promo-spoon:L1', variant: 'spoon', required: 1, verified: spoon, gift: true, bin: 'C-02' }] : []),
];

const BASE: Parcel = { order: 'b71d4a95', buyer: 'Piotr Nowak', index: 1, total: 1, carrier: 'Allegro Paczkomaty InPost', shipBy: 'dziś 15:00', lines: morningLines(1, 0, 0) };

const PARCELS: Record<string, Parcel> = {
  'in-progress': BASE,
  'bundle-barcode-scanned': BASE,
  'component-missing': { ...BASE, lines: morningLines(1, 0, 1) },
  'gift-ran-out': { ...BASE, order: 'c2e81b07', buyer: 'Agnieszka Dąbrowska', lines: morningLines(1, 1, 0) },
  'pilot-note': { ...BASE, order: '41aa7d3e', buyer: 'Anna Kowalska', lines: morningLines(0, 0, 0, false), notes: [{ body: 'Dołóż łyżeczkę do kawy (gratis z promocji na Allegro). Nie skanuj jej: stan zdejmuje biuro ręczną korektą.', who: 'Marta · dziś 9:20' }] },
  'gift-wrap': { ...BASE, order: '7bb0e4f9', buyer: 'Beata Michalska', lines: [{ id: 'L1', variant: 'grinder', required: 1, verified: 0, bin: 'D-07' }], wrap: { instruction: 'Zapakuj w papier prezentowy. Nie wkładaj paragonu do środka, połóż go na wierzchu kartonu.', message: 'Wszystkiego najlepszego, Kasiu. Niech każda kawa smakuje jak w Etiopii. Basia' } },
  'split-parcel': {
    ...BASE,
    order: 'f2a6d901',
    buyer: 'Hanna Kubiak',
    index: 2,
    total: 2,
    lines: [
      { id: 'L2', variant: 'press', required: 1, verified: 0, bin: 'D-02' },
      { id: 'ol-gift:promo-spoon:L1', variant: 'spoon', required: 1, verified: 0, gift: true, bin: 'C-02' },
    ],
    siblings: [
      { index: 1, items: 'Zestaw poranny: Kubek, Kawa', state: 'Spakowana przez Olę', gift: false },
      { index: 2, items: 'French press, Łyżeczka (gratis)', state: 'Ta paczka', gift: true },
    ],
  },
  done: { ...BASE, lines: morningLines(1, 1, 1) },
};

type Notice = { kind: 'bundle-code' | 'wrong'; value: string } | null;

function lineState(l: BenchLine): { key: 'verified' | 'in-progress' | 'not-started'; label: string; tone: StatusBadgeTone } {
  if (l.verified >= l.required) return { key: 'verified', label: 'Zeskanowano', tone: 'success' };
  if (l.verified > 0) return { key: 'in-progress', label: 'Skanowanie', tone: 'info' };
  return { key: 'not-started', label: 'Nie zeskanowano', tone: 'neutral' };
}

function BenchRow({ l, onScan, disabled, reason, extra }: { l: BenchLine; onScan: () => void; disabled: boolean; reason?: string; extra?: ReactNode }): ReactElement {
  const x = v(l.variant);
  const st = lineState(l);
  return (
    <li className={`bench-parcel-line bench-parcel-line--${st.key}${l.gift ? ' ord-bench-gift' : ''}${l.partOf ? ' ord-bench-child' : ''}`}>
      <BenchThumb className="bench-parcel-line__thumb" imageUrl={null} name={x.name} />
      <div className="bench-parcel-line__identity">
        <span className="bench-parcel-line__name">{l.gift ? `Włóż gratis: ${x.name}` : x.name}</span>
        <span className="ord-line-marks">
          {l.gift ? <GiftMark compact /> : null}
          {l.partOf ? <PartOf bundle={l.partOf} /> : null}
        </span>
        {extra}
      </div>
      <div className="bench-parcel-line__codes">
        EAN {x.ean} · {x.sku}
      </div>
      <div className="bench-parcel-line__location">{l.bin ? <span className="bench-parcel-line__bin-code">Półka {l.bin}</span> : null}</div>
      <div className="bench-parcel-line__count">
        <span className="bench-parcel-line__count-value">
          {l.verified} z {l.required}
        </span>
      </div>
      <div className="bench-parcel-line__state">
        <StatusBadge tone={st.tone} withDot={st.key !== 'not-started'}>
          {st.label}
        </StatusBadge>
      </div>
      <div className="bench-parcel-line__actions">
        {st.key !== 'verified' ? (
          <Button tone="secondary" disabled={disabled} title={reason} onClick={onScan}>
            Zeskanuj
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function BenchView({ stateId }: { stateId: string }): ReactElement {
  const { role } = useProto();
  const guard = useWriteGuard();
  const canScan = role !== 'viewer';
  const reason = canScan ? undefined : guard.reason;
  const { showToast } = useToast();
  const p = PARCELS[stateId] ?? BASE;
  const [lines, setLines] = useState<BenchLine[]>(p.lines);
  const [notice, setNotice] = useState<Notice>(stateId === 'bundle-barcode-scanned' ? { kind: 'bundle-code', value: BUNDLE_EAN } : null);
  const [typed, setTyped] = useState('');
  const [giftDecision, setGiftDecision] = useState<'substitute' | 'skip' | null>(null);
  const [reported, setReported] = useState(false);

  const ranOut = stateId === 'gift-ran-out' && giftDecision === null;
  const scannable = lines.filter((l) => !(ranOut && l.gift));
  const required = lines.reduce((a, l) => a + l.required, 0);
  const verified = lines.reduce((a, l) => a + Math.min(l.verified, l.required), 0);
  const closed = verified === required && !(stateId === 'gift-ran-out' && giftDecision === null) && required > 0;
  const pct = required ? Math.round((verified / required) * 100) : 0;
  const hero = scannable.find((l) => l.verified < l.required);
  const comps = lines.filter((l) => l.partOf);
  const compsDone = comps.filter((l) => l.verified >= l.required).length;
  const missingBlocked = stateId === 'component-missing';

  const scan = (id: string): void => {
    if (missingBlocked && id === 'L1~c:coffee') {
      setReported(false);
      showToast({ tone: 'warning', title: 'Nie znaleziono na półce', description: 'Kawa ziarnista Etiopia 250 g: półka B-11 jest pusta. Zgłoś brak do biura.' });
      return;
    }
    setNotice(null);
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, verified: Math.min(l.required, l.verified + 1) } : l)));
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const value = typed.trim();
    setTyped('');
    if (!value) return;
    if (value === BUNDLE_EAN) {
      setNotice({ kind: 'bundle-code', value });
      return;
    }
    const match = scannable.find((l) => (v(l.variant).ean === value || v(l.variant).sku === value) && l.verified < l.required);
    if (match) scan(match.id);
    else setNotice({ kind: 'wrong', value });
  };

  const decide = (d: 'substitute' | 'skip'): void => {
    setGiftDecision(d);
    if (d === 'substitute') {
      setLines((ls) => ls.map((l) => (l.gift ? { ...l, variant: 'bag', bin: 'E-01', verified: 0 } : l)));
      showToast({ tone: 'success', title: 'Włożono zamiennik', description: 'Zamiast łyżeczki: Torba prezentowa kraft. Zeskanuj ją.' });
    } else {
      setLines((ls) => ls.filter((l) => !l.gift));
      showToast({ tone: 'success', title: 'Pominięto gratis i zgłoszono', description: 'Biuro dostało zgłoszenie. Paczka może iść dalej.' });
    }
  };

  const heroX = hero ? v(hero.variant) : null;

  return (
    <PageLayout eyebrow="Magazyn" title="Stanowisko pakowania" description="Skanujesz pozycje do tej paczki. Paczka zamyka się sama, gdy wszystko jest w środku.">
      <section className="bench-parcel bench-parcel--desktop ord-bench">
        {!canScan ? (
          <Alert tone="info" title="Podgląd">
            {guard.reason}
          </Alert>
        ) : null}
        <header className="bench-parcel__header">
          <div className="bench-parcel__identity">
            <span className="bench-parcel__field-label">Zamówienie</span>
            <span className="bench-parcel__reference">{p.order}</span>
          </div>
          <div className="bench-parcel__identity">
            <span className="bench-parcel__field-label">Kupujący</span>
            <span className="bench-parcel__buyer">{p.buyer}</span>
          </div>
          <div className="bench-parcel__identity">
            <span className="bench-parcel__field-label">Paczka</span>
            <span>
              {p.index} z {p.total}
            </span>
          </div>
          <div className="bench-parcel__identity">
            <span className="bench-parcel__field-label">Przewoźnik</span>
            <span>{p.carrier}</span>
          </div>
          <div className="bench-parcel__identity">
            <span className="bench-parcel__field-label">Wyślij do</span>
            <span className="mono">{p.shipBy}</span>
          </div>
          <div className="bench-parcel__header-spacer" />
          <div className="bench-parcel__header-trailing">
            {closed ? (
              <StatusBadge tone="success" withDot>
                Spakowana
              </StatusBadge>
            ) : (
              <StatusBadge tone="warning" pulse>
                W toku
              </StatusBadge>
            )}
          </div>
        </header>

        <p className="bench-parcel__scope">
          {p.total > 1 ? `Wszystko poniżej należy tylko do paczki ${String(p.index)} z ${String(p.total)}. Pozostałe paczki tego zamówienia pakuje się osobno.` : 'Wszystko poniżej należy do tej paczki.'}
        </p>

        {p.notes ? (
          <Alert tone="info" title={`Notatka z biura (${String(p.notes.length)})`} className="bench-office-note">
            <ul className="bench-office-note__list">
              {p.notes.map((n) => (
                <li key={n.body} className="bench-office-note__item">
                  <span className="bench-office-note__body">{n.body}</span>
                  <span className="bench-office-note__meta">{n.who}</span>
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {p.wrap ? (
          <Alert tone="info" title="Pakowanie na prezent">
            <span className="ord-alert-body">{p.wrap.instruction}</span>
            <span className="ord-bench-card">
              <span className="ord-muted">Kartka do środka:</span>
              <q>{p.wrap.message}</q>
            </span>
          </Alert>
        ) : null}

        {p.siblings ? (
          <div className="ord-bench-split" role="group" aria-label="Paczki tego zamówienia">
            {p.siblings.map((s) => (
              <div key={s.index} className={`ord-bench-split__box${s.index === p.index ? ' ord-bench-split__box--here' : ''}`}>
                <span className="ord-bench-split__head">
                  Paczka {s.index} z {p.total} {s.gift ? <GiftMark compact /> : null}
                </span>
                <span className="ord-bench-split__items">{s.items}</span>
                <span className="ord-muted">{s.state}</span>
              </div>
            ))}
          </div>
        ) : null}

        {ranOut ? (
          <Alert tone="warning" title="Zabrakło gratisu: Łyżeczka do kawy">
            <span className="ord-alert-body">Półka C-02 jest pusta. Wybierz, co zrobić z gratisem. Ta sama decyzja pojawia się w szczegółach zamówienia.</span>
            <span className="ord-resolve">
              <Button tone="primary" disabled={!canScan} title={reason} onClick={() => decide('substitute')}>
                Włóż zamiennik: Torba prezentowa
              </Button>
              <Button tone="secondary" disabled={!canScan} title={reason} onClick={() => decide('skip')}>
                Pomiń gratis i zgłoś
              </Button>
            </span>
          </Alert>
        ) : null}

        {notice ? (
          <Alert
            tone="error"
            title={notice.kind === 'bundle-code' ? 'Ten kod to zestaw, a nie pozycja paczki' : 'Ten kod nie pasuje do żadnej pozycji'}
            action={
              <Button tone="secondary" onClick={() => setNotice(null)}>
                Rozumiem
              </Button>
            }
          >
            {notice.kind === 'bundle-code'
              ? `Zeskanowano kod zestawu "Zestaw poranny" (${notice.value}). W paczce nie ma pozycji z tym kodem: zestaw pakujesz po składnikach. Zeskanuj kubek i kawę osobno.`
              : `Zeskanowano ${notice.value}. Sprawdź, czy trzymasz właściwy produkt.`}
          </Alert>
        ) : null}

        {missingBlocked && !closed ? (
          <Alert
            tone="warning"
            title="Paczki nie można zamknąć: brakuje składnika zestawu"
            action={
              <Button
                tone="secondary"
                disabled={!canScan || reported}
                title={reason}
                onClick={() => {
                  setReported(true);
                  showToast({ tone: 'success', title: 'Zgłoszono brak', description: 'Biuro wie, że brakuje kawy do zestawu porannego.' });
                }}
              >
                {reported ? 'Zgłoszono brak' : 'Zgłoś brak'}
              </Button>
            }
          >
            Zestaw poranny ma 2 składniki, w paczce jest 1. Brakuje: Kawa ziarnista Etiopia 250 g. Paczka zamknie się sama dopiero po zeskanowaniu wszystkich pozycji. Nie wysyłaj zestawu w częściach.
          </Alert>
        ) : null}

        {hero && heroX && !closed ? (
          <section className="bench-hero">
            <BenchThumb className="bench-hero__swatch" imageUrl={null} name={heroX.name} />
            <div className="bench-hero__body">
              <p className="bench-hero__name">{hero.gift ? `Włóż gratis: ${heroX.name}` : heroX.name}</p>
              <p className="bench-hero__attrs">
                {hero.gift ? <GiftMark compact /> : null} {hero.partOf ? <PartOf bundle={hero.partOf} /> : null}
              </p>
              <p className="bench-hero__ids">
                EAN {heroX.ean} · {heroX.sku}
                {hero.bin ? <> · Półka {hero.bin}</> : null}
              </p>
              <form className="bench-hero__scan" onSubmit={onSubmit}>
                <label htmlFor="ord-bench-scan" className="sr-only">
                  Zeskanuj pozycję
                </label>
                <input id="ord-bench-scan" type="text" className="mono" autoComplete="off" placeholder="Zeskanuj albo wpisz EAN / SKU i naciśnij Enter" value={typed} disabled={!canScan} onChange={(e) => setTyped(e.target.value)} />
                <Button tone="primary" type="button" disabled={!canScan} title={reason} onClick={() => scan(hero.id)}>
                  Zeskanuj
                </Button>
              </form>
              <p className="bench-hero__hint">Skan liczy się sam. "Zeskanuj" symuluje czytnik w tym prototypie. Kod zestawu {BUNDLE_EAN} pokaże, co się dzieje przy skanie zestawu.</p>
            </div>
            <div className="bench-hero__count">
              <p className="bench-hero__count-value">
                {hero.verified}
                <span className="bench-hero__count-of"> z {hero.required}</span>
              </p>
              <p className="bench-hero__count-label">zostało {hero.required - hero.verified}</p>
            </div>
          </section>
        ) : null}

        <div className="bench-parcel__progress-block">
          <div className="bench-parcel__progress-top">
            <span>
              Zeskanowano {verified} z {required} szt.
            </span>
            <span className="mono">{pct}%</span>
          </div>
          <div className="bench-parcel__progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={required} aria-valuenow={verified} aria-label={`Zeskanowano ${String(verified)} z ${String(required)}`}>
            <div className="bench-parcel__progress-fill" style={{ width: `${String(pct)}%` }} />
          </div>
        </div>

        {closed ? (
          <div className="bench-parcel__closed">
            <h2 className="bench-parcel__closed-title">Paczka spakowana</h2>
            <p className="bench-parcel__closed-summary">
              Zamówienie {p.order}, paczka {p.index} z {p.total}.
            </p>
            <p>
              W paczce: {verified} szt.
              {lines.some((l) => l.gift) ? `, w tym gratis: ${v(lines.find((l) => l.gift)?.variant ?? 'spoon').name}` : ''}
              {comps.length ? `. Zestaw poranny: ${String(compsDone)} z ${String(comps.length)} składników.` : '.'}
            </p>
            <p className="bench-parcel__closed-next">Naklej etykietę i odłóż paczkę na wózek. Stan zejdzie z PrestaShop automatycznie{lines.some((l) => l.gift) ? ', gratis z powodem "gratis"' : ''}.</p>
          </div>
        ) : null}

        <div className="bench-parcel__lines-wrap">
          <div className="bench-parcel__lines-caption">
            <span>Wszystkie pozycje w paczce</span>
          </div>
          <div className="bench-parcel__lines-head" aria-hidden="true">
            <span />
            <span>Pozycja</span>
            <span>Kody</span>
            <span>Półka</span>
            <span className="bench-parcel__lines-head-right">Zeskanowano</span>
            <span className="bench-parcel__lines-head-right">Status</span>
            <span />
          </div>
          {comps.length ? (
            <div className="ord-bench-group">
              <BundleMark />
              <span className="ord-bench-group__title">
                {BUNDLES.morning.name}: {compsDone} z {comps.length} składników
              </span>
              <span className="ord-bench-group__track" aria-hidden="true">
                <span style={{ width: `${String(Math.round((compsDone / comps.length) * 100))}%` }} />
              </span>
              <span className="ord-muted">Skanuj składniki, nie kod zestawu.</span>
            </div>
          ) : null}
          <ul className="bench-parcel__lines">
            {lines.map((l) => (
              <BenchRow
                key={l.id}
                l={l}
                disabled={!canScan || closed || (ranOut && l.gift === true)}
                reason={reason}
                onScan={() => scan(l.id)}
                extra={
                  ranOut && l.gift ? (
                    <span className="ord-line-note">Brak na półce. Czeka na decyzję.</span>
                  ) : giftDecision === 'substitute' && l.gift ? (
                    <span className="ord-line-note">Zamiennik za łyżeczkę, której zabrakło</span>
                  ) : missingBlocked && l.id === 'L1~c:coffee' ? (
                    <span className="ord-line-note">Półka pusta</span>
                  ) : undefined
                }
              />
            ))}
          </ul>
        </div>

        {!closed ? (
          <footer className="bench-parcel__footer">
            <span>Nie ma przycisku "Zamknij". Paczka zamyka się sama, gdy zeskanujesz ostatnią pozycję.</span>
          </footer>
        ) : null}
      </section>
    </PageLayout>
  );
}

const STATES: StateDef[] = [
  { id: 'in-progress', label: 'W trakcie', note: 'Paczka z zestawem porannym i gratisem. Zestaw nie ma własnego kodu do skanu: pakowacz skanuje kubek i kawę osobno, a nagłówek pokazuje "1 z 2 składników". Gratis to osobna pozycja "Włóż gratis". Kliknij "Zeskanuj", żeby zasymulować czytnik.', useCases: ['B-11', 'G-09'], priority: 'pilot', channels: ['allegro'] },
  { id: 'bundle-barcode-scanned', label: 'Zeskanowano kod zestawu', note: 'Pakowacz zeskanował kod z opakowania zestawu. Żadna pozycja paczki nie ma tego kodu, bo zestaw pakuje się po składnikach. Komunikat mówi, co zeskanować zamiast tego.', useCases: ['B-11'], priority: 'pilot', channels: ['allegro'] },
  { id: 'component-missing', label: 'Brak składnika', note: 'Kawy nie ma na półce. Paczki nie da się zamknąć, bo zamyka się sama dopiero po zeskanowaniu wszystkiego. Pakowacz zgłasza brak do biura, a zestaw nie wychodzi w częściach.', useCases: ['B-11', 'B-12'], priority: 'pilot', channels: ['allegro'] },
  { id: 'gift-ran-out', label: 'Zabrakło gratisu', note: 'Łyżeczki nie ma na półce. Pakowacz wybiera: zamiennik ustawiony w promocji (torba prezentowa) albo pominięcie ze zgłoszeniem. To ta sama decyzja co w szczegółach zamówienia. Kosztów pakowacz nie widzi.', useCases: ['G-08', 'G-09', 'G-14'], priority: 'pilot', channels: ['allegro'] },
  { id: 'pilot-note', label: 'Tryb pilota: notatka', note: 'Na etapie pilota gratis nie jest pozycją paczki. Pakowacz widzi notatkę z biura i wkłada łyżeczkę bez skanu. Stan zdejmuje biuro ręczną korektą.', useCases: ['G-20'], priority: 'stage0', channels: ['allegro'] },
  { id: 'gift-wrap', label: 'Pakowanie na prezent', note: 'Kupujący zapłacił za pakowanie na prezent. Pakowacz dostaje instrukcję i treść kartki. Usługa nie jest pozycją do skanu i nie rusza stanu.', useCases: ['G-14'], priority: 'later', channels: ['allegro'] },
  { id: 'split-parcel', label: 'Paczka podzielona', note: 'Zamówienie idzie w dwóch paczkach. Mapa paczek mówi, w której jest gratis: w tej, drugiej. Pierwsza paczka jest już spakowana bez gratisu.', useCases: ['G-09'], priority: 'later', channels: ['allegro'] },
  { id: 'done', label: 'Gotowe', note: 'Wszystko zeskanowane, paczka zamknęła się sama. Podsumowanie mówi, że gratis jest w środku i że stan zejdzie z PrestaShop z powodem "gratis".', useCases: ['B-11', 'G-09'], priority: 'pilot', channels: ['allegro'] },
  ...commonStates('paczki', 'wybierz paczkę z listy do spakowania'),
];

export const screen: ScreenDef = {
  id: 'bench',
  group: 'Magazyn',
  label: 'Stanowisko pakowania',
  states: STATES,
  render: (state) => <BenchView key={state} stateId={state} />,
};
