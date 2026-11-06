/**
 * Order detail: how a bundle line and a gift line look, who pays for the gift,
 * and where each line's stock goes. One OrderPage driven by a scenario object.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { DetailSection } from '@web/shared/ui/detail-section';
import { Button } from '@web/shared/ui/button';
import { Alert } from '@web/shared/ui/alert';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { SegmentedControl } from '@web/shared/ui/segmented-control';
import { useToast } from '@web/shared/ui/toast-provider';
import { BUNDLES, PROMOTIONS } from '../model/catalog';
import { bundleAtp } from '../model/calc';
import { commonStates, Note, useProto, useWriteGuard, type ScreenDef, type StateDef } from '../proto';
import { GiftMark } from '../ui/marks';
import { ORDER_SCENARIOS, bundle, gift, lineName, type OrdLine, type OrdScenario } from './ord-data';
import { OrdDelivery, OrdGiftPanel, OrdHeader, OrdLines, OrdPayload, OrdPrice, OrdStock, OrdTimeline, OrdWriteback, useEffectiveOms } from './ord-ui';
import { AddGiftDialog, EditLinesDialog, type AddGiftMode } from './ord-dialogs';
import './ord.css';

/* ── Page ──────────────────────────────────────────────────────────── */

interface PageProps {
  s: OrdScenario;
  top?: ReactNode;
  addGiftMode?: AddGiftMode;
  addGiftOpen?: boolean;
  editOpen?: boolean;
  lineAction?: (l: OrdLine) => ReactNode;
}

function OrderPage({ s: initial, top, addGiftMode, addGiftOpen = false, editOpen = false, lineAction }: PageProps): ReactElement {
  const { go, oms: globalOms } = useProto();
  const { canWrite, reason } = useWriteGuard();
  const oms = useEffectiveOms(initial);
  const [added, setAdded] = useState<OrdLine[]>([]);
  const [giftOpen, setGiftOpen] = useState(addGiftOpen);
  const [edit, setEdit] = useState(editOpen);
  const s: OrdScenario = added.length ? { ...initial, lines: [...initial.lines, ...added], adjustments: [...initial.adjustments, ...added.map((l) => ({ label: `Gratis: ${lineName(l)}`, amount: -(l.listPrice ?? 0) * l.qty, funder: 'seller' as const, note: 'dodany ręcznie' }))] } : initial;
  const mode: AddGiftMode = addGiftMode ?? (s.stage === 'packed' || s.stage === 'shipped' ? 'after-packing' : 'after-routing');
  const cancelled = s.stage === 'cancelled';
  const hasGift = s.lines.some((l) => l.kind === 'gift' && !l.removed);
  return (
    <PageLayout
      eyebrow="Sprzedaż · Zamówienia"
      title="Szczegóły zamówienia"
      actions={
        <div className="button-group">
          <Button tone="ghost" className="button--sm" onClick={() => go('orders', 'all')}>
            Wróć do listy
          </Button>
          <Button tone="secondary" className="button--sm" disabled={!canWrite || cancelled} title={!canWrite ? reason : cancelled ? 'Zamówienie jest anulowane' : undefined} onClick={() => setEdit(true)}>
            Edytuj pozycje
          </Button>
          <Button tone="primary" className="button--sm" disabled={!canWrite || cancelled} title={!canWrite ? reason : cancelled ? 'Zamówienie jest anulowane' : undefined} onClick={() => setGiftOpen(true)}>
            Dodaj gratis
          </Button>
        </div>
      }
    >
      <OrdHeader s={s} oms={oms} />
      {initial.forceOms !== undefined && initial.forceOms !== globalOms ? (
        <Note>Ten stan pokazuje pracę {initial.forceOms ? 'z włączonym' : 'bez'} OMS, niezależnie od przełącznika u góry.</Note>
      ) : null}
      {top ? <div className="ord-top">{top}</div> : null}

      <DetailSection title="Pozycje zamówienia" titleAside={<span className="ord-muted">{s.lines.length} wierszy</span>}>
        <OrdLines s={s} onRowNote={lineAction} />
      </DetailSection>

      {hasGift ? <OrdGiftPanel s={s} /> : null}

      <div className="order-detail__primary-grid order-detail__primary-grid--split">
        <div className="order-detail__stack">
          <OrdStock s={s} />
          {s.payload ? <OrdPayload s={s} /> : null}
        </div>
        <div className="order-detail__stack">
          <OrdPrice s={s} />
          {s.writeback ? <OrdWriteback s={s} /> : null}
          <OrdDelivery s={s} />
        </div>
      </div>

      <OrdTimeline
        s={s}
        extra={added.map((l) => ({ id: `add-${l.id}`, timestamp: '2026-11-04T10:20:00+01:00', title: `Dodano gratis: ${lineName(l)} x${String(l.qty)}`, by: 'Ty (operator)', description: 'Zarezerwowano i dopisano do zadania pakowania.', tone: 'success' as const }))}
      />

      <AddGiftDialog open={giftOpen} onOpenChange={setGiftOpen} mode={mode} s={s} onAdded={(l) => setAdded((a) => [...a, l])} />
      <EditLinesDialog open={edit} onOpenChange={setEdit} s={s} />
    </PageLayout>
  );
}

/* ── State-specific wrappers ───────────────────────────────────────── */

function GiftOutOfStock(): ReactElement {
  const base = ORDER_SCENARIOS['gift-out-of-stock'];
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const { go } = useProto();
  const [choice, setChoice] = useState<'substitute' | 'skip' | 'hold' | null>(null);
  const promo = PROMOTIONS.find((p) => p.id === 'promo-spoon');
  let s = base;
  if (choice === 'substitute') {
    s = {
      ...base,
      health: { label: 'Zsynchronizowane', tone: 'success' },
      phase: { label: 'Do spakowania', tone: 'info' },
      lines: [...base.lines.filter((l) => l.kind !== 'gift'), gift('ol-gift:promo-spoon:L1', 'bag', 1, 'ol-rule', { olOnly: true, status: { label: 'Zarezerwowano', tone: 'success' }, note: 'Zamiennik za łyżeczkę, której zabrakło' })],
      adjustments: [base.adjustments[0], { label: 'Gratis: Torba prezentowa kraft (zamiennik)', amount: -999, funder: 'seller', note: 'Wartość katalogowa' }],
    };
  } else if (choice === 'skip') {
    s = {
      ...base,
      health: { label: 'Zsynchronizowane', tone: 'success' },
      phase: { label: 'Do spakowania', tone: 'info' },
      lines: base.lines.map((l) => (l.kind === 'gift' ? { ...l, removed: true, status: undefined, note: 'Pominięty: brak na stanie. Notatka dla obsługi klienta dodana.', trail: [{ label: 'Nie zarezerwowano', state: 'skipped' as const }] } : l)),
      adjustments: [base.adjustments[0]],
    };
  } else if (choice === 'hold') {
    s = { ...base, phase: { label: 'Wstrzymane: czeka na gratis', tone: 'warning' } };
  }
  const decide = (c: 'substitute' | 'skip' | 'hold', toast: string): void => {
    setChoice(c);
    showToast({ tone: 'success', title: toast, description: 'Decyzja zapisana w historii zamówienia.' });
  };
  const top =
    choice === null ? (
      <Alert tone="error" title="Gratis bez stanu: Łyżeczka do kawy">
        <span className="ord-alert-body">
          Promocja "{promo?.name}" dodała łyżeczkę, ale nie ma jej wolnej na stanie: 4 szt. w PrestaShop, wszystkie obiecane innym zamówieniom. Zamówienie czeka na Twoją decyzję. To samo pytanie widzi pakowacz, jeśli gratisu zabraknie na stanowisku.
        </span>
        <span className="ord-resolve">
          <Button tone="primary" className="button--sm" disabled={!canWrite} title={reason} onClick={() => decide('substitute', 'Dano zamiennik')}>
            Daj zamiennik: Torba prezentowa
          </Button>
          <Button tone="secondary" className="button--sm" disabled={!canWrite} title={reason} onClick={() => decide('skip', 'Pominięto gratis')}>
            Pomiń gratis i dodaj notatkę
          </Button>
          <Button tone="ghost" className="button--sm" disabled={!canWrite} title={reason} onClick={() => decide('hold', 'Wstrzymano zamówienie')}>
            Wstrzymaj zamówienie
          </Button>
        </span>
        <span className="ord-muted">Promocja ma ustawiony zamiennik: Torba prezentowa kraft (wolne 310 szt., koszt 2,40 zł).</span>
      </Alert>
    ) : (
      <Alert
        tone={choice === 'hold' ? 'warning' : 'success'}
        title={choice === 'substitute' ? 'Dano zamiennik: Torba prezentowa kraft' : choice === 'skip' ? 'Gratis pominięty' : 'Zamówienie wstrzymane do dostawy łyżeczek'}
        action={
          <Button tone="ghost" className="button--sm" onClick={() => setChoice(null)}>
            Cofnij decyzję
          </Button>
        }
      >
        {choice === 'substitute'
          ? 'Torba jest zarezerwowana i trafi do zadania pakowania zamiast łyżeczki.'
          : choice === 'skip'
            ? 'Zamówienie idzie do pakowania bez gratisu. Rezerwacji łyżeczki nie ma, nic nie zejdzie ze stanu.'
            : 'Zamówienie nie trafi do pakowania, dopóki łyżeczka nie wróci na stan albo nie zmienisz decyzji.'}{' '}
        <button type="button" className="ord-link" onClick={() => go('bench', 'gift-ran-out')}>
          Zobacz to samo pytanie na stanowisku pakowania
        </button>
      </Alert>
    );
  return <OrderPage s={s} top={top} />;
}

function MultipackHeld(): ReactElement {
  const base = ORDER_SCENARIOS['multipack-held'];
  const { go } = useProto();
  const { canWrite, reason } = useWriteGuard();
  const [defined, setDefined] = useState(false);
  const s: OrdScenario = defined
    ? {
        ...base,
        health: { label: 'Zsynchronizowane', tone: 'success' },
        phase: { label: 'Do spakowania', tone: 'info' },
        lines: bundle('L1', 'triple', 1, 1, {}, { status: { label: 'Zarezerwowano', tone: 'success' } }),
        adjustments: [{ label: 'Multipak taniej niż osobno', amount: -998, funder: 'seller', note: '3 x 34,99 = 104,97 zł' }],
      }
    : base;
  const atp = bundleAtp(BUNDLES.triple.versions[0].components);
  return (
    <OrderPage
      s={s}
      top={
        defined ? (
          <Alert tone="success" title="Zwolniono: oferta to teraz zestaw Kawa Etiopia, 3 opakowania" action={<Button tone="ghost" className="button--sm" onClick={() => setDefined(false)}>Pokaż jeszcze raz</Button>}>
            Pozycja rozłożyła się na 3 sztuki kawy. Rezerwacja wzięła 3 opakowania, dostępnych zestawów: {atp.atp ?? 'nieznane'}.
          </Alert>
        ) : (
          <Alert tone="warning" title="Wstrzymane: oferta to 3 sztuki jednego produktu">
            <span className="ord-alert-body">
              Allegro podało w productSet ilość 3, a oferta jest powiązana z pojedynczym wariantem "Kawa ziarnista Etiopia 250 g". Bez definicji zestawu zarezerwowalibyśmy i spakowali 1 opakowanie zamiast 3. Zdefiniuj zestaw dla tej oferty, żeby zwolnić zamówienie.
            </span>
            <span className="ord-resolve">
              <Button tone="primary" className="button--sm" onClick={() => go('bundle-editor')}>
                Zdefiniuj zestaw
              </Button>
              <Button tone="secondary" className="button--sm" disabled={!canWrite} title={reason} onClick={() => setDefined(true)}>
                Sprawdź ponownie
              </Button>
            </span>
          </Alert>
        )
      }
    />
  );
}

function DestinationRefused(): ReactElement {
  const base = ORDER_SCENARIOS['destination-refused-zero-line'];
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const [fixed, setFixed] = useState(false);
  const s: OrdScenario = fixed
    ? {
        ...base,
        health: { label: 'Zsynchronizowane', tone: 'success' },
        lines: base.lines.map((l) =>
          l.kind === 'gift'
            ? {
                ...l,
                status: { label: 'Korekta ręczna', tone: 'success' },
                trail: [
                  { label: 'Wysłano do PrestaShop jako pozycja 0,00 zł', state: 'blocked', detail: 'sklep odrzucił pozycję' },
                  { label: 'Korekta stanu w PrestaShop: -1', state: 'done', detail: 'powód: gratis' },
                ],
              }
            : l,
        ),
      }
    : base;
  return (
    <OrderPage
      s={s}
      top={
        fixed ? (
          <Alert tone="success" title="Zdjęto stan ręcznie">
            Łyżeczka do kawy: -1 w PrestaShop z powodem "gratis". Pakowacz w sklepie dostał notatkę, żeby dołożył łyżeczkę.
          </Alert>
        ) : (
          <Alert
            tone="error"
            title="Sklep odrzucił pozycję gratisu 0,00 zł"
            action={
              <Button
                tone="primary"
                className="button--sm"
                disabled={!canWrite}
                title={reason}
                onClick={() => {
                  setFixed(true);
                  showToast({ tone: 'success', title: 'Zdjęto stan ręcznie', description: 'Łyżeczka do kawy: -1 w PrestaShop, powód: gratis.' });
                }}
              >
                Zdejmij stan ręcznie
              </Button>
            }
          >
            OMS jest wyłączony, więc zamówienie trafiło do PrestaShop, a sklep sam pakuje i zdejmuje stan. Sklep nie przyjął pozycji z ceną 0,00 zł, więc gratisu nie ma w zamówieniu w sklepie i stan łyżeczki się nie zmienił. Zdejmij stan ręcznie i dodaj notatkę dla pakowacza w sklepie.
          </Alert>
        )
      }
    />
  );
}

function DecrementBlocked(): ReactElement {
  const s = ORDER_SCENARIOS['decrement-blocked'];
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const [done, setDone] = useState(false);
  const fixed: OrdScenario = done
    ? { ...s, health: { label: 'Zsynchronizowane', tone: 'success' }, lines: s.lines.map((l) => (l.kind === 'component' ? { ...l, trail: [{ label: 'Zarezerwowano', state: 'done' as const }, { label: 'Spakowano', state: 'done' as const }, { label: 'Korekta ręczna w PrestaShop', state: 'done' as const, detail: 'powód: sprzedaż' }] } : l)) }
    : s;
  return (
    <OrderPage
      s={fixed}
      top={
        done ? (
          <Alert tone="success" title="Oznaczono stan jako zdjęty">
            Zapisano korekty: French press -1, Kawa -2 w PrestaShop.
          </Alert>
        ) : (
          <Alert
            tone="error"
            title="Zdjęcie stanu zablokowane"
            action={
              <Button
                tone="primary"
                className="button--sm"
                disabled={!canWrite}
                title={reason}
                onClick={() => {
                  setDone(true);
                  showToast({ tone: 'success', title: 'Zdjęto stan ręcznie', description: 'French press -1, Kawa -2 w PrestaShop.' });
                }}
              >
                Zdejmij stan ręcznie
              </Button>
            }
          >
            W PrestaShop "Zestaw do parzenia" to pak ustawiony na "zmniejszaj stan składników". Zapis przez API zmieniłby tylko wiersz paka, a składniki zostałyby na stanie i sprzedałyby się drugi raz. OpenLinker nie zgaduje: zdejmij stan składników ręcznie albo zmień pak w PrestaShop na produkt bez własnego stanu.
          </Alert>
        )
      }
    />
  );
}

function PilotMode(): ReactElement {
  const s = ORDER_SCENARIOS['pilot-mode'];
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const { go } = useProto();
  const [saved, setSaved] = useState(false);
  return (
    <OrderPage
      s={s}
      top={
        <>
          <Alert tone="info" title="Notatka dla pakowacza (1)">
            Dołóż łyżeczkę do kawy (gratis z promocji na Allegro). Marta, dziś 9:20.{' '}
            <button type="button" className="ord-link" onClick={() => go('bench', 'pilot-note')}>
              Zobacz na stanowisku
            </button>
          </Alert>
          <DetailSection title="Tryb pilota: gratis bez pozycji w zamówieniu" titleAside={<StatusBadge tone={saved ? 'success' : 'warning'} withDot compact>{saved ? 'Korekta zapisana' : 'Korekta niezapisana'}</StatusBadge>}>
            <p className="proto-inline-note">
              Na etapie pilota gratis nie jest jeszcze pozycją zamówienia. Pakowacz wkłada go według notatki, a stan zdejmujesz ręczną korektą z powodem "gratis". Bez korekty stan łyżeczek w PrestaShop będzie za wysoki.
            </p>
            <div className="ord-correction">
              <span className="ord-correction__item">
                <GiftMark compact /> Łyżeczka do kawy, stal <span className="ord-muted tabular">LYZ-KAW · PrestaShop</span>
              </span>
              <span className="mono-text tabular">-1 szt.</span>
              <span className="ord-muted">powód: gratis · zamówienie {s.number}</span>
              <Button
                tone="primary"
                className="button--sm"
                disabled={!canWrite || saved}
                title={!canWrite ? reason : undefined}
                onClick={() => {
                  setSaved(true);
                  showToast({ tone: 'success', title: 'Zapisano korektę', description: 'Łyżeczka do kawy: -1 w PrestaShop, powód: gratis.' });
                }}
              >
                Zapisz korektę
              </Button>
            </div>
            {!saved ? (
              <Alert tone="warning" density="compact">
                Korekta niezapisana. Paczka może wyjść z łyżeczką, a stan w PrestaShop jej nie odejmie.
              </Alert>
            ) : null}
          </DetailSection>
        </>
      }
    />
  );
}

function ChannelFlag(): ReactElement {
  const [ch, setCh] = useState<'idosell' | 'empik'>('idosell');
  const s = ORDER_SCENARIOS[ch === 'idosell' ? 'gift-channel-flag' : 'gift-channel-flag-empik'];
  return (
    <OrderPage
      key={ch}
      s={s}
      top={
        <div className="ord-switch">
          <span className="ord-muted">Kanał w tym przykładzie:</span>
          <SegmentedControl
            aria-label="Kanał"
            value={ch}
            onChange={setCh}
            options={[
              { value: 'idosell', label: 'IdoSell (orderSalesMode)' },
              { value: 'empik', label: 'Empik (offered_quantity)' },
            ]}
          />
        </div>
      }
    />
  );
}

function TwoRules(): ReactElement {
  const s = ORDER_SCENARIOS['two-rules-matched'];
  const { go } = useProto();
  const spoon = PROMOTIONS.find((p) => p.id === 'promo-spoon');
  const sample = PROMOTIONS.find((p) => p.id === 'promo-sample');
  return (
    <OrderPage
      s={s}
      top={
        <DetailSection title="Pasujące promocje" titleAside={<span className="ord-muted">2 pasują, 1 zastosowana</span>}>
          <ul className="ord-rules">
            <li className="ord-rules__row">
              <StatusBadge tone="success" withDot compact>
                Zastosowana
              </StatusBadge>
              <span className="ord-rules__name">{spoon?.name}</span>
              <span className="ord-muted">priorytet 1 · łączy się z innymi · 2 szt. (1 na zestaw)</span>
            </li>
            <li className="ord-rules__row">
              <StatusBadge tone="neutral" compact>
                Pominięta
              </StatusBadge>
              <span className="ord-rules__name">{sample?.name}</span>
              <span className="ord-muted">priorytet 2 · nie łączy się z innymi promocjami</span>
            </li>
          </ul>
          <button type="button" className="ord-link" onClick={() => go('promotions')}>
            Zmień priorytety w promocjach
          </button>
        </DetailSection>
      }
    />
  );
}

function RoutingRefused(): ReactElement {
  const b = ORDER_SCENARIOS['bundle-edit-refused'];
  const s: OrdScenario = {
    ...b,
    id: 'routing-refused',
    number: 'f8c3a210',
    buyer: 'Zofia Wróbel',
    city: 'Gliwice',
    health: { label: 'Wymaga uwagi', tone: 'error' },
    phase: { label: 'Czeka: stan', tone: 'warning' },
    lines: b.lines.map((l) =>
      l.variant === 'press' && l.kind === 'component'
        ? { ...l, status: { label: 'Brak w lokalizacjach', tone: 'error' as const }, trail: [{ label: 'Routing odmówił', state: 'blocked' as const, detail: 'brak wolnego stanu w żadnej lokalizacji' }, { label: 'Czeka na dostawę', state: 'todo' as const }] }
        : l.kind === 'component'
          ? { ...l, status: { label: 'Czeka na zestaw', tone: 'warning' as const }, trail: [{ label: 'Zarezerwowano', state: 'done' as const }, { label: 'Czeka na French press', state: 'active' as const }] }
          : l,
    ),
    timeline: [
      ...b.timeline,
      { at: '2026-11-04T08:02:00+01:00', title: 'Routing odmówił: French press 800 ml', by: 'system · routing', desc: 'Żadna lokalizacja nie ma wolnej sztuki. Zestaw nie trafi do pakowania w częściach.', tone: 'error' },
    ],
  };
  return (
    <OrderPage
      s={s}
      top={
        <Alert tone="warning" title="Routing odmówił na składniku: French press 800 ml">
          Zestaw pakujemy w całości, więc czeka na wszystkie składniki. Kawa jest zarezerwowana, French press nie ma wolnego stanu w żadnej lokalizacji. Zamówienie wróci do routingu, gdy stan się pojawi.
        </Alert>
      }
    />
  );
}

/* ── States ────────────────────────────────────────────────────────── */

const SC = ORDER_SCENARIOS;

const STATES: StateDef[] = [
  { id: 'bundle-allegro', label: 'Zestaw z Allegro', note: 'Zamówienie Allegro na "Zestaw poranny". Allegro przysłało productSet, OpenLinker tylko sprawdził, że zgadza się z definicją. Pozycja zestawu rozkłada się na składniki L1~c:mug i L1~c:coffee: każdy ma własną rezerwację i ścieżkę stanu. Skład jest zamrożony na wersji 1 z chwili złożenia.', useCases: ['B-04', 'B-10', 'B-23'], priority: 'pilot', channels: ['allegro'] },
  { id: 'gift-ol-only', label: 'Gratis tylko w OpenLinkerze', note: 'Najważniejszy przypadek. Allegro nie ma gratisów, więc łyżeczkę dopisała promocja w OpenLinkerze jako pozycję ol-gift:promo-spoon:L1. Klient płaci 0,00 zł, Ciebie kosztuje 3,90 zł. Przy włączonym OMS gratis jest rezerwowany, skanowany na stanowisku i zdejmowany ze stanu w PrestaShop z powodem "gratis". Do Allegro nic o gratisie nie wraca.', useCases: ['G-04', 'G-06', 'G-21', 'X-09'], priority: 'pilot', channels: ['allegro'] },
  { id: 'gift-cart-rule', label: 'Gratis z reguły koszyka', note: 'PrestaShop przysyła gratis jako zwykłą pozycję w pełnej cenie, a rabat zapisuje na całym zamówieniu. OpenLinker łączy rabat 9,99 zł z torbą i pokazuje ją jako gratis z reguły koszyka. Stan zdjął sam sklep przy złożeniu zamówienia.', useCases: ['G-03', 'X-01', 'X-07'], priority: 'pilot', channels: ['prestashop'] },
  { id: 'gift-inferred', label: 'Gratis rozpoznany po cenie', note: 'Shoper nie oznacza gratisów. Aplikacja dodaje wariant za 0,01 zł. Reguła operatora w ustawieniach połączenia mówi, że taka pozycja to gratis. Klient zapłacił 0,01 zł, koszt zakupu to 3,90 zł.', useCases: ['G-02'], priority: 'later', channels: ['shoper'] },
  { id: 'gift-channel-flag', label: 'Gratis oznaczony przez kanał', note: 'IdoSell oznacza gratis polem orderSalesMode: gift, Empik (Mirakl) podaje offered_quantity. OpenLinker niczego nie zgaduje, tylko przepisuje znacznik. Empik nie mówi, kto finansuje gratis, więc pokazujemy to jako nieznane.', useCases: ['G-01', 'X-07'], priority: 'later', channels: ['idosell', 'empik'] },
  { id: 'bundle-plus-gift', label: 'Zestaw z gratisem w składzie', note: 'Zestaw poranny w wersji 2 ma łyżeczkę jako gratis w składzie (L1~g:spoon). Udział łyżeczki w cenie to 0,00 zł. Rezerwacja i pakowanie idą na trzech składnikach. Promocja z łyżeczką nie dubluje gratisu.', useCases: ['G-07', 'B-10'], priority: 'later', channels: ['erli'] },
  { id: 'gift-out-of-stock', label: 'Gratis bez stanu', note: 'Łyżeczki skończyły się w trakcie promocji. Zamówienie jest wstrzymane i czeka na decyzję: zamiennik (ustawiony w promocji), pominięcie z notatką albo wstrzymanie do dostawy. Kliknij przycisk, żeby zobaczyć skutek. To samo pytanie pada na stanowisku pakowania.', useCases: ['G-08', 'G-16'], priority: 'pilot', channels: ['allegro'] },
  { id: 'add-gift-before-routing', label: 'Dodaj gratis: przed routingiem', note: 'Operator dodaje gratis ręcznie, np. na przeprosiny. Zamówienie nie jest jeszcze przydzielone do pakowania, więc gratis po prostu wchodzi do rezerwacji i zadania pakowania. Podgląd pokazuje koszt i ścieżkę stanu.', useCases: ['G-05', 'X-04'], priority: 'pilot', channels: ['allegro'] },
  { id: 'add-gift-after-routing', label: 'Dodaj gratis: po routingu', note: 'Zamówienie jest już przydzielone do pakowania. Dodanie gratisu działa, ale tworzy nowe zadanie pakowania. Dialog o tym ostrzega przed zapisem.', useCases: ['G-05', 'X-04'], priority: 'pilot', channels: ['allegro'] },
  { id: 'add-gift-after-packing', label: 'Dodaj gratis: po spakowaniu', note: 'Paczka jest spakowana. Gratis nie trafi już do środka, więc zapis jest zablokowany z powodem i podpowiedzią: wyślij osobno albo dopisz do następnego zamówienia.', useCases: ['G-05', 'X-04'], priority: 'pilot', channels: ['allegro'] },
  { id: 'add-gift-after-invoice', label: 'Dodaj gratis: po dokumencie', note: 'Paragon jest już wystawiony bez gratisu. Gratis można dodać, ale dokument się nie zmieni. Dialog mówi, że kwota zostaje ta sama, i odsyła do formy gratisu w ustawieniach dokumentów.', useCases: ['G-05', 'D-05'], priority: 'later', channels: ['allegro'] },
  { id: 'multipack-held', label: 'Multipak wstrzymany', note: 'Allegro podało productSet z ilością 3, a oferta jest powiązana z jednym wariantem bez definicji zestawu. Pozycja jest wstrzymana, bo spakowalibyśmy 1 opakowanie zamiast 3. "Sprawdź ponownie" pokazuje stan po zdefiniowaniu zestawu.', useCases: ['B-08'], priority: 'pilot', channels: ['allegro'] },
  { id: 'shoper-double-children', label: 'Podwójne składniki z Shopera', note: 'Shoper przysłał zestaw i jego składniki jako osobne pozycje za 0,00 zł. Składniki pasują do definicji, więc OpenLinker je pomija i liczy stan z definicji. Bez tego stan zszedłby dwa razy.', useCases: ['B-05'], priority: 'pilot', channels: ['shoper'] },
  { id: 'bundle-edit-refused', label: 'Edycja zestawu odrzucona', note: 'Operator chce zmienić ilość zestawu. Edycja jest zablokowana z kodem LINE_IS_BUNDLE, bo rezerwacje, pakowanie i zdjęcie stanu są zapisane na składnikach, a edycja jeszcze ich nie rozkłada. Pozostałe pozycje można zmienić.', useCases: ['B-24', 'X-10'], priority: 'pilot', channels: ['allegro'] },
  { id: 'routing-refused', label: 'Routing odmówił na składniku', note: 'Jeden składnik zestawu (French press) nie ma wolnego stanu w żadnej lokalizacji. Zestaw pakujemy w całości, więc czeka. Pozostałe składniki trzymają rezerwację.', useCases: ['B-12', 'B-23'], priority: 'pilot', channels: ['allegro'] },
  { id: 'customer-limit-reached', label: 'Limit klienta osiągnięty', note: 'Zamówienie spełnia próg promocji z próbką kawy, ale klient wykorzystał już limit 1 gratisu. Gratisu nie dodano, a powód jest w historii.', useCases: ['G-15'], priority: 'later', channels: ['allegro'] },
  { id: 'gift-removed-below-threshold', label: 'Gratis usunięty poniżej progu', note: 'Po zmniejszeniu ilości koszyk spadł poniżej 150 zł. Promocja zdjęła gratis, rezerwacja próbki wróciła do puli. Linia zostaje widoczna jako usunięta, żeby było wiadomo dlaczego.', useCases: ['G-15', 'X-04'], priority: 'later', channels: ['allegro'] },
  { id: 'two-rules-matched', label: 'Dwie promocje pasują', note: 'Pasują dwie promocje. Zastosowano tę z wyższym priorytetem, druga nie łączy się z innymi. Panel pokazuje obie i powód pominięcia. Oś czasu zapisuje, która reguła co zmieniła, z wartością przed i po.', useCases: ['G-06', 'X-06'], priority: 'later', channels: ['allegro'] },
  { id: 'budget-reached', label: 'Budżet promocji wyczerpany', note: 'Promocja "Torba prezentowa przy 2 kubkach" wydała cały budżet. Zamówienie spełnia warunek, ale gratisu nie dodano. Powód widać w zamówieniu i w historii.', useCases: ['G-06', 'G-16'], priority: 'later', channels: ['woocommerce'] },
  { id: 'gift-wrap', label: 'Pakowanie na prezent', note: 'Kupujący zapłacił 5,00 zł za pakowanie na prezent i dodał wiadomość. To usługa, nie towar: nie rusza stanu. Pakowacz dostaje instrukcję i treść kartki.', useCases: ['G-14', 'D-05', 'X-05'], priority: 'later', channels: ['allegro'] },
  { id: 'cancelled', label: 'Anulowane', note: 'Kupujący anulował zamówienie przed spakowaniem. Rezerwacje składników zestawu i gratisu wróciły do puli. Nic nie zeszło ze stanu w PrestaShop.', useCases: ['B-24', 'G-21'], priority: 'pilot', channels: ['allegro'] },
  { id: 'destination-refused-zero-line', label: 'Sklep odrzucił pozycję 0,00', note: 'OMS wyłączony: zamówienie idzie do PrestaShop, a gratis jako pozycja 0,00 zł. Sklep odrzucił tę pozycję, więc stan łyżeczki się nie zmienił. Zastępczo: ręczna korekta stanu i notatka dla pakowacza w sklepie.', useCases: ['G-04', 'G-20'], priority: 'pilot', channels: ['allegro', 'prestashop'] },
  { id: 'decrement-blocked', label: 'Zdjęcie stanu zablokowane', note: 'Zestaw w PrestaShop to pak zmniejszający stan składników. Zapis przez API zmieniłby tylko wiersz paka. OpenLinker blokuje zdjęcie stanu i prosi o ręczną korektę, zamiast cicho zostawić składniki na stanie.', useCases: ['B-20', 'B-22'], priority: 'pilot', channels: ['allegro', 'prestashop'] },
  { id: 'eur-order', label: 'Zamówienie w EUR', note: 'Erli przysłało zamówienie w EUR ze stawkami VAT Niemiec. Kwoty są w EUR, koszt gratisu w PLN z kursem. Zamówienie jest do przeglądu przed wystawieniem dokumentu.', useCases: ['X-08'], priority: 'later', channels: ['erli'] },
  { id: 'pilot-mode', label: 'Tryb pilota', note: 'Na etapie pilota gratis nie jest pozycją zamówienia. Pakowacz wkłada go według notatki, a stan zdejmujesz ręczną korektą z powodem "gratis". Dopóki korekta nie jest zapisana, ekran to wyraźnie mówi.', useCases: ['G-20'], priority: 'stage0', channels: ['allegro'] },
  ...commonStates('zamówienia', 'wróć do listy zamówień'),
];

function OrderScreen({ id }: { id: string }): ReactElement {
  const { go } = useProto();
  switch (id) {
    case 'bundle-allegro':
      return (
        <OrderPage
          s={SC['bundle-allegro']}
          top={
            <Alert tone="info" title="Skład zamrożony na wersji 1" action={<Button tone="ghost" className="button--sm" onClick={() => go('bundle-editor')}>Otwórz zestaw</Button>}>
              Zestaw poranny zmieniono 2 listopada na wersję 2 (z łyżeczką). To zamówienie złożono 1 listopada, więc pakujemy wersję 1: kubek i kawę. Allegro przysłało productSet, OpenLinker tylko sprawdził, że zgadza się z definicją.
            </Alert>
          }
        />
      );
    case 'gift-ol-only':
      return <OrderPage s={SC['gift-ol-only']} />;
    case 'gift-cart-rule':
      return <OrderPage s={SC['gift-cart-rule']} />;
    case 'gift-inferred':
      return (
        <OrderPage
          s={SC['gift-inferred']}
          top={
            <Note>
              Reguła rozpoznawania gratisów jest w{' '}
              <button type="button" className="ord-link" onClick={() => go('settings')}>
                ustawieniach połączenia Shoper
              </button>
              . Bez niej ta pozycja byłaby zwykłym towarem za 0,01 zł.
            </Note>
          }
        />
      );
    case 'gift-channel-flag':
      return <ChannelFlag />;
    case 'bundle-plus-gift':
      return <OrderPage s={SC['bundle-plus-gift']} />;
    case 'gift-out-of-stock':
      return <GiftOutOfStock />;
    case 'add-gift-before-routing':
      return <OrderPage s={{ ...SC['add-gift'], stage: 'new', phase: { label: 'Nowe', tone: 'neutral' } }} addGiftMode="before-routing" addGiftOpen />;
    case 'add-gift-after-routing':
      return <OrderPage s={SC['add-gift']} addGiftMode="after-routing" addGiftOpen />;
    case 'add-gift-after-packing':
      return <OrderPage s={{ ...SC['add-gift'], stage: 'packed', phase: { label: 'Spakowane', tone: 'success' } }} addGiftMode="after-packing" addGiftOpen />;
    case 'add-gift-after-invoice':
      return <OrderPage s={{ ...SC['add-gift'], payment: 'Opłacone · paragon wystawiony' }} addGiftMode="after-invoice" addGiftOpen />;
    case 'multipack-held':
      return <MultipackHeld />;
    case 'shoper-double-children':
      return (
        <OrderPage
          s={SC['shoper-double-children']}
          top={
            <Alert tone="info" title="Pominięto 2 pozycje składników przysłane przez Shoper">
              Shoper wysyła zestaw razem z jego składnikami za 0,00 zł. Składniki zgadzają się z definicją "Zestaw do parzenia", więc liczymy je z definicji, a przysłane pozycje pomijamy. Inaczej French press i kawa zeszłyby ze stanu dwa razy.
            </Alert>
          }
        />
      );
    case 'bundle-edit-refused':
      return <OrderPage s={SC['bundle-edit-refused']} editOpen />;
    case 'routing-refused':
      return <RoutingRefused />;
    case 'customer-limit-reached':
      return (
        <OrderPage
          s={SC['customer-limit-reached']}
          top={
            <Alert tone="info" title="Promocja nie dodała gratisu: limit klienta">
              Koszyk 158,98 zł spełnia próg promocji "Próbka kawy przy zakupach od 150 zł", ale klient dostał już ten gratis 12 października (zamówienie 7d21f0aa). Limit to 1 na klienta.{' '}
              <button type="button" className="ord-link" onClick={() => go('promotions')}>
                Otwórz promocję
              </button>
            </Alert>
          }
        />
      );
    case 'gift-removed-below-threshold':
      return (
        <OrderPage
          s={SC['gift-removed-below-threshold']}
          top={
            <Alert tone="info" title="Gratis usunięty: koszyk poniżej progu">
              Po zmianie ilości kawy koszyk spadł z 158,98 zł do 123,99 zł, poniżej progu 150 zł. Próbka kawy zniknęła z zamówienia, a jej rezerwacja wróciła do puli.
            </Alert>
          }
        />
      );
    case 'two-rules-matched':
      return <TwoRules />;
    case 'budget-reached':
      return (
        <OrderPage
          s={SC['budget-reached']}
          top={
            <Alert tone="info" title="Budżet promocji wyczerpany">
              Zamówienie ma 2 kubki, więc spełnia warunek promocji "Torba prezentowa przy 2 kubkach". Promocja wydała już cały budżet: 120,00 zł z 120,00 zł. Gratisu nie dodano.{' '}
              <button type="button" className="ord-link" onClick={() => go('promotions')}>
                Zwiększ budżet
              </button>
            </Alert>
          }
        />
      );
    case 'gift-wrap':
      return (
        <OrderPage
          s={SC['gift-wrap']}
          top={
            <DetailSection title="Pakowanie na prezent" titleAside={<span className="ord-muted">usługa Allegro, 5,00 zł</span>}>
              <div className="ord-wrap">
                <p className="ord-wrap__line">
                  <strong>Instrukcja dla pakowacza:</strong> zapakuj w papier prezentowy, bez paragonu w środku.
                </p>
                <blockquote className="ord-wrap__msg">Wszystkiego najlepszego, Kasiu. Niech każda kawa smakuje jak w Etiopii. Basia</blockquote>
                <button type="button" className="ord-link" onClick={() => go('bench', 'gift-wrap')}>
                  Zobacz na stanowisku pakowania
                </button>
              </div>
            </DetailSection>
          }
        />
      );
    case 'cancelled':
      return (
        <OrderPage
          s={SC.cancelled}
          top={
            <Alert tone="info" title="Zamówienie anulowane">
              Stan składników zestawu i gratisu wrócił do puli: Kubek x1, Kawa x1, Łyżeczka x1. Nic nie zeszło ze stanu w PrestaShop, bo paczki nie spakowano.
            </Alert>
          }
        />
      );
    case 'destination-refused-zero-line':
      return <DestinationRefused />;
    case 'decrement-blocked':
      return <DecrementBlocked />;
    case 'eur-order':
      return (
        <OrderPage
          s={SC['eur-order']}
          top={
            <Alert tone="conflict" title="Do przeglądu: zamówienie w EUR ze stawkami VAT Niemiec">
              Erli podało walutę EUR i stawki 19% oraz 7%. Kwoty pokazujemy w EUR, a koszt gratisu w PLN po kursie 1 EUR = 4,2500 PLN. Sprawdź dokument sprzedaży przed wystawieniem.
            </Alert>
          }
        />
      );
    case 'pilot-mode':
      return <PilotMode />;
    default:
      return <OrderPage s={SC['gift-ol-only']} />;
  }
}

export const screen: ScreenDef = {
  id: 'order',
  group: 'Sprzedaż',
  label: 'Szczegóły zamówienia',
  states: STATES,
  render: (state) => <OrderScreen key={state} id={state} />,
};

