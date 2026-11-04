/**
 * Documents lab (plan item 9): pick an order, a gift form, a bundle mode and a
 * provider, and see the receipt and invoice OpenLinker would issue, why, and
 * whether the document total equals what the buyer paid.
 */
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { DetailSection } from '@web/shared/ui/detail-section';
import { FormField } from '@web/shared/ui/form-field';
import { Select } from '@web/shared/ui/select';
import { SegmentedControl } from '@web/shared/ui/segmented-control';
import { Button } from '@web/shared/ui/button';
import { Alert } from '@web/shared/ui/alert';
import { StatusBadge, type StatusBadgeTone } from '@web/shared/ui/status-badge';
import { DataTable } from '@web/shared/ui/data-table';
import { Input } from '@web/shared/ui/input';
import { useToast } from '@web/shared/ui/toast-provider';
import type { DocResult } from '../model/calc';
import { DOC_PROVIDERS } from '../model/catalog';
import { Note, useMoney, useProto, useWriteGuard, type ScreenDef, type StateDef } from '../proto';
import { ReceiptPreview, InvoicePreview } from '../ui/documents';
import { WhoPaysStrip, ChannelPayload } from '../ui/marks';
import {
  PROVIDER_ORDER, SCENARIOS, SCENARIO_ORDER, TREATMENT_LABEL, TREATMENT_ORDER, allocateDiscount, composeDoc, DISCOUNT, DISCOUNT_PAID, proportionalRebates,
  issues, providerName, roundingAfter, roundingBefore, ROUNDING_PAID, splitMissingDoc, SPLIT_MISSING_ROWS, zeroLineDoc,
  type BundleMode, type LabConfig, type ScenarioId, type TreatmentChoice,
} from './doc-data';
import { explain, type Risk } from './doc-explain';
import { BundleSplitTable, EurReviewPanel, InternalRecordPanel, PreviewCell, SumCheck, giftPaidOnDoc, giftUnitCost } from './doc-panels';
import './doc.css';

type Extra = 'rounding' | 'discount' | 'split-missing' | 'error-41' | 'rebate-100' | 'p10' | 'gift-wrap' | 'other-rate';

interface Seed {
  cfg: LabConfig;
  extra?: Extra;
}

const cfg = (scenario: ScenarioId, treatment: TreatmentChoice, bundleMode: BundleMode, provider: LabConfig['provider']): LabConfig => ({ scenario, treatment, bundleMode, provider });

const SEEDS: Record<string, Seed> = {
  'gift-same-rate-omitted': { cfg: cfg('morning-spoon', 'omit', 'one-line', 'eparagony') },
  'gift-other-rate-held': { cfg: cfg('coffee-mug', 'omit', 'one-line', 'eparagony'), extra: 'other-rate' },
  'gift-grosz': { cfg: cfg('morning-spoon', 'grosz', 'one-line', 'eparagony') },
  'gift-grosz-no-same-rate': { cfg: cfg('coffee-mug', 'grosz', 'one-line', 'eparagony') },
  'gift-priced-in': { cfg: cfg('coffee-mug', 'priced-in', 'one-line', 'subiekt') },
  'gift-internal-record': { cfg: cfg('coffee-mug', 'internal-record', 'one-line', 'eparagony') },
  'treatment-not-set': { cfg: cfg('morning-spoon', 'omit', 'one-line', 'subiekt') },
  'bundle-one-line': { cfg: cfg('brew', 'omit', 'one-line', 'ksef') },
  'bundle-components': { cfg: cfg('brew', 'omit', 'components', 'subiekt') },
  'bundle-split-missing': { cfg: cfg('brew', 'omit', 'components', 'subiekt'), extra: 'split-missing' },
  'rounding-cent': { cfg: cfg('morning-spoon', 'omit', 'one-line', 'eparagony'), extra: 'rounding' },
  'order-discount-spread': { cfg: cfg('coffee-mug', 'omit', 'one-line', 'subiekt'), extra: 'discount' },
  'eparagony-error-41': { cfg: cfg('coffee-mug', 'priced-in', 'one-line', 'eparagony'), extra: 'error-41' },
  'ksef-p10': { cfg: cfg('morning-spoon', 'omit', 'components', 'ksef'), extra: 'p10' },
  'eur-de-vat': { cfg: cfg('erli-eur', 'omit', 'one-line', 'eparagony') },
  'gift-wrap-line': { cfg: cfg('gift-wrap', 'omit', 'one-line', 'subiekt'), extra: 'gift-wrap' },
  'rebate-100-high-risk': { cfg: cfg('morning-spoon', 'rebate-100', 'one-line', 'eparagony'), extra: 'rebate-100' },
};

const RISK_TONE: Record<Risk, StatusBadgeTone> = { niskie: 'success', średnie: 'warning', wysokie: 'error', brak: 'neutral' };
const RISK_LABEL: Record<Risk, string> = { niskie: 'Ryzyko niskie', średnie: 'Ryzyko średnie', wysokie: 'Ryzyko wysokie', brak: 'Nic nie wystawiono' };

/* ── Controls ──────────────────────────────────────────────────────── */

function Controls({ value, onChange }: { value: LabConfig; onChange: (patch: Partial<LabConfig>) => void }): ReactElement {
  const sc = SCENARIOS[value.scenario];
  return (
    <DetailSection title="Ustawienia podglądu">
      <div className="doc-lab-controls">
        <FormField label="Zamówienie" name="doc-scenario" description={`Kanał: ${sc.channel}`}>
          <Select value={value.scenario} onChange={(e) => onChange({ scenario: e.target.value as ScenarioId })}>
            {SCENARIO_ORDER.map((id) => (
              <option key={id} value={id}>{SCENARIOS[id].label}</option>
            ))}
          </Select>
        </FormField>
        <FormField label="Gratis na dokumencie" name="doc-treatment" description={sc.gift ? 'Ustawienie połączenia, tu do podglądu.' : 'To zamówienie nie ma gratisu.'}>
          <Select value={value.treatment} disabled={!sc.gift} onChange={(e) => onChange({ treatment: e.target.value as TreatmentChoice })}>
            {TREATMENT_ORDER.map((t) => (
              <option key={t} value={t} disabled={t === 'rebate-100' || (t === 'grosz' && !groszAllowed(value.provider))}>
                {t === 'grosz' && !groszAllowed(value.provider) ? `${TREATMENT_LABEL[t]} (niepotrzebne: ${providerName(value.provider)} przyjmuje 0,00 zł)` : TREATMENT_LABEL[t]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Dostawca dokumentu" name="doc-provider" description={issueText(value.provider)}>
          <Select value={value.provider} onChange={(e) => onChange({ provider: e.target.value as LabConfig['provider'] })}>
            {PROVIDER_ORDER.map((p) => (
              <option key={p} value={p}>{providerName(p)}</option>
            ))}
          </Select>
        </FormField>
        <div className="doc-lab-field">
          <span className="form-field__label" id="doc-bundle-label">Zestaw na dokumencie</span>
          <SegmentedControl<BundleMode>
            aria-labelledby="doc-bundle-label"
            value={value.bundleMode}
            onChange={(v) => onChange({ bundleMode: v })}
            options={[
              { value: 'one-line', label: 'Jedna linia', disabled: !sc.hasBundle },
              { value: 'components', label: 'Składniki', disabled: !sc.hasBundle },
            ]}
          />
          <p className="form-field__description">{sc.hasBundle ? 'Składniki dostają udział w cenie zestawu.' : 'To zamówienie nie ma zestawu.'}</p>
        </div>
      </div>
    </DetailSection>
  );
}

/** The 1 grosz form is offered only where the provider refuses a 0,00 line or rate (eparagony error 41). */
function groszAllowed(p: LabConfig['provider']): boolean {
  return !DOC_PROVIDERS[p].zeroLine || !DOC_PROVIDERS[p].zeroRateBucket;
}

function issueText(p: LabConfig['provider']): string {
  const i = issues(p);
  return i.receipt && i.invoice ? 'Wystawia paragon i fakturę.' : i.receipt ? 'Wystawia paragon.' : 'Wystawia fakturę.';
}

function captionFor(kind: 'receipt' | 'invoice', p: LabConfig['provider']): string {
  const i = issues(p);
  const yes = kind === 'receipt' ? i.receipt : i.invoice;
  return yes ? `Wystawia: ${providerName(p)}.` : `${providerName(p)} nie wystawia ${kind === 'receipt' ? 'paragonu' : 'faktury'}. Podgląd dla porównania.`;
}

/* ── Explainer ─────────────────────────────────────────────────────── */

function WhyPanel({ value, doc, extraBullets }: { value: LabConfig; doc: DocResult; extraBullets?: string[] }): ReactElement {
  const { risk, bullets } = extraBullets ? { risk: 'niskie' as Risk, bullets: extraBullets } : explain(value, doc);
  const sc = SCENARIOS[value.scenario];
  return (
    <DetailSection title="Dlaczego tak" titleAside={<StatusBadge tone={RISK_TONE[risk]} compact withDot>{RISK_LABEL[risk]}</StatusBadge>}>
      <ul className="doc-lab-why">
        {bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      {sc.gift && !extraBullets ? (
        <WhoPaysStrip qty={sc.gift.qty} unitCost={giftUnitCost(sc.gift.variant)} buyerPays={giftPaidOnDoc(doc)} currency="PLN" />
      ) : null}
      <Note>To nie jest porada prawna. Formę gratisu i zestawu na dokumencie wybiera sprzedawca, najlepiej z doradcą podatkowym.</Note>
    </DetailSection>
  );
}

/* ── Preview pairs ─────────────────────────────────────────────────── */

function Pair({ left, right }: { left: ReactNode; right: ReactNode }): ReactElement {
  return (
    <div className="doc-lab-previews">
      {left}
      {right}
    </div>
  );
}

function StandardPreviews({ value, doc, paid, p10 }: { value: LabConfig; doc: DocResult; paid: number; p10?: boolean }): ReactElement {
  return (
    <DetailSection title="Podgląd dokumentów" titleAside={<SumCheck doc={doc} paid={paid} />}>
      <Pair
        left={<PreviewCell caption={captionFor('receipt', value.provider)}><ReceiptPreview doc={doc} /></PreviewCell>}
        right={<PreviewCell caption={captionFor('invoice', value.provider)}><InvoicePreview doc={doc} p10={p10 ?? value.provider === 'ksef'} /></PreviewCell>}
      />
    </DetailSection>
  );
}

function RoundingPanel(): ReactElement {
  const before = roundingBefore();
  const after = roundingAfter();
  return (
    <DetailSection title="Reszta z zaokrąglenia: przed i po" titleAside="Allegro podało sumę 74,99 zł, pozycje dają 74,98 zł">
      <Pair
        left={
          <PreviewCell caption={<>Przed: reszta doliczona do ostatniej pozycji. Gratis kosztuje nagle 0,01 zł i przestaje być gratisem. <SumCheck doc={before} paid={ROUNDING_PAID} /></>}>
            <ReceiptPreview doc={before} title="Przed: reszta na gratisie" />
          </PreviewCell>
        }
        right={
          <PreviewCell caption={<>Po: reszta trafia na największą płatną pozycję. Gratis zostaje za 0,00 zł w stawce kubka. <SumCheck doc={after} paid={ROUNDING_PAID} /></>}>
            <ReceiptPreview doc={after} title="Po: reszta na płatnej pozycji" />
          </PreviewCell>
        }
      />
    </DetailSection>
  );
}

const toInput = (g: number): string => (g / 100).toFixed(2).replace('.', ',');
const fromInput = (v: string): number | null => {
  const n = Number(v.trim().replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

/** Whole-order discount: spread automatically on the document, never held; the operator may override the split. */
function DiscountPanel({ value }: { value: LabConfig }): ReactElement {
  const money = useMoney();
  const { canWrite, reason } = useWriteGuard();
  const { showToast } = useToast();
  const auto = proportionalRebates();
  const [rebates, setRebates] = useState<number[]>(auto);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(auto.map(toInput));
  const alloc = allocateDiscount(rebates);
  const isAuto = rebates.every((r, i) => r === auto[i]);
  const parsed = draft.map(fromInput);
  const draftSum = parsed.reduce<number>((a, v) => a + (v ?? 0), 0);
  const draftOk = parsed.every((v) => v !== null) && draftSum === DISCOUNT;
  return (
    <div className="doc-lab-stack">
      <Alert
        tone="success"
        title={isAuto ? 'Rabat rozłożony automatycznie proporcjonalnie do wartości linii' : 'Rabat rozłożony ręcznie'}
        action={
          editing ? undefined : (
            <Button tone="secondary" disabled={!canWrite} title={reason} onClick={() => { setDraft(rebates.map(toInput)); setEditing(true); }}>
              Zmień podział
            </Button>
          )
        }
      >
        {isAuto
          ? 'PrestaShop przysłał kod rabatowy KAWA10 na całe zamówienie. OpenLinker od razu podzielił 10,00 zł na pozycje, dokładnie do grosza, a resztę dał największej płatnej pozycji. Dokument wychodzi bez czekania. Gratis za 0,00 zł nigdy nie dostaje rabatu.'
          : 'Podział ustawiony ręcznie. Suma rabatów nadal wynosi 10,00 zł, więc dokument zgadza się z zapłatą.'}
      </Alert>
      {editing ? (
        <DetailSection title="Zmień podział rabatu">
          <div className="doc-lab-stack">
            {alloc.perLine.map((r, i) => (
              <FormField key={r.name} label={`${r.name} (stawka ${r.vat}%)`} name={`rebate-${i}`} description={`Cena ${money(r.before, 'PLN')}`}>
                <Input inputMode="decimal" value={draft[i]} onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? e.target.value : x)))} />
              </FormField>
            ))}
            {!draftOk ? (
              <Alert tone="warning" density="compact" title="Suma się nie zgadza">
                Rabaty muszą dać razem {money(DISCOUNT, 'PLN')}. Teraz dają {money(draftSum, 'PLN')}.
              </Alert>
            ) : null}
            <div className="doc-lab-actions">
              <Button
                tone="primary"
                disabled={!draftOk}
                onClick={() => {
                  setRebates(parsed.map((v) => v ?? 0));
                  setEditing(false);
                  showToast({ tone: 'success', title: 'Zapisano podział', description: 'Dokument użyje Twojego podziału rabatu.' });
                }}
              >
                Zapisz podział
              </Button>
              <Button tone="ghost" onClick={() => { setRebates(auto); setEditing(false); }}>
                Przywróć automatyczny
              </Button>
            </div>
          </div>
        </DetailSection>
      ) : null}
      <DataTable
        caption="Rabat na pozycjach"
        columns={[
          { id: 'n', header: 'Pozycja', cell: (r) => r.name },
          { id: 'b', header: 'Przed', align: 'right', cell: (r) => <span className="tabular">{money(r.before, 'PLN')}</span> },
          { id: 'r', header: 'Rabat', align: 'right', cell: (r) => <span className="tabular">-{money(r.rebate, 'PLN')}</span> },
          { id: 'a', header: 'Po', align: 'right', cell: (r) => <span className="tabular">{money(r.after, 'PLN')}</span> },
          { id: 'v', header: 'Stawka', align: 'right', cell: (r) => <span className="tabular">{r.vat}%</span>, hideBelow: 768 },
        ]}
        rows={alloc.perLine}
        rowKey={(r) => r.name}
        cardView={{ title: (r) => r.name, subtitle: (r) => `stawka ${r.vat}%`, meta: (r) => <span className="tabular">{money(r.after, 'PLN')}</span> }}
      />
      <StandardPreviews value={value} doc={alloc.doc} paid={DISCOUNT_PAID} />
    </div>
  );
}

function SplitMissingPanel({ value }: { value: LabConfig }): ReactElement {
  const money = useMoney();
  const { go } = useProto();
  return (
    <div className="doc-lab-stack">
      <Alert tone="warning" title="Brak klucza podziału ceny zestawu" action={<Button tone="secondary" onClick={() => go('bundle-editor', 'step-split-missing-price')}>Uzupełnij cenę składnika</Button>}>
        Zestaw degustacyjny ma składnik, który nie jest sprzedawany osobno i nie ma kosztu zakupu. Bez ceny osobno albo kosztu nie da się podzielić ceny, więc dokument czeka.
      </Alert>
      <DataTable
        caption="Składniki zestawu degustacyjnego"
        columns={[
          { id: 'n', header: 'Składnik', cell: (r) => r.name },
          { id: 'q', header: 'Ilość', align: 'right', cell: (r) => <span className="tabular">{r.qty}</span> },
          { id: 's', header: 'Cena osobno', align: 'right', cell: (r) => (r.standalone === null ? <StatusBadge tone="warning" compact>Brak ceny i kosztu</StatusBadge> : <span className="tabular">{money(r.standalone, 'PLN')}</span>) },
          { id: 'v', header: 'Stawka', align: 'right', cell: (r) => <span className="tabular">{r.vat}%</span>, hideBelow: 768 },
        ]}
        rows={SPLIT_MISSING_ROWS}
        rowKey={(r) => r.name}
        cardView={{ title: (r) => r.name, subtitle: (r) => (r.standalone === null ? 'Brak ceny i kosztu' : `${money(r.standalone, 'PLN')}, stawka ${r.vat}%`) }}
      />
      <StandardPreviews value={value} doc={splitMissingDoc()} paid={8900} />
    </div>
  );
}

function Error41Panel({ value, doc }: { value: LabConfig; doc: DocResult }): ReactElement {
  const zero = zeroLineDoc(value);
  const paid = SCENARIOS[value.scenario].paid;
  return (
    <div className="doc-lab-stack">
      <ChannelPayload
        title="IdoSell: gratis jako pozycja 0,00 zł"
        lines={[
          { text: '{ "productName": "Kawa ziarnista Etiopia 250 g", "price": 34.99, "vat": 5 },', tone: 'muted' },
          { text: '{ "productName": "Kubek ceramiczny 350 ml", "price": 0.00, "vat": 23,', tone: 'key' },
          { text: '  "orderSalesMode": "gift" }', tone: 'warn' },
        ]}
      />
      <DetailSection title="Sprawdzenie przed wysłaniem do eparagony">
        <Pair
          left={
            <PreviewCell caption={<>Tego paragonu OpenLinker nie wysyła. Stawka A ma tylko gratis za 0,00 zł. <SumCheck doc={zero} paid={paid} /></>}>
              <ReceiptPreview doc={zero} title="Co przysłał kanał" />
            </PreviewCell>
          }
          right={
            <PreviewCell caption={<>Co wyśle OpenLinker przy wybranej formie gratisu. <SumCheck doc={doc} paid={paid} /></>}>
              <ReceiptPreview doc={doc} title="Po wybraniu formy gratisu" />
            </PreviewCell>
          }
        />
      </DetailSection>
    </div>
  );
}

function P10Note(): ReactElement {
  const money = useMoney();
  const { perLine } = allocateDiscount();
  return (
    <DetailSection title="Kolumna P_10 w KSeF">
      <p className="doc-lab-text">P_10 to kwota opustu, gdy nie jest w cenie jednostkowej. OpenLinker wypełnia ją dla zwykłego rabatu rozłożonego na pozycje. Gratis jest pominięty, bo KSeF przyjmuje 0,00 zł, więc nie ma na nim opustu.</p>
      <ul className="doc-lab-rates">
        {perLine.map((p) => (
          <li key={p.name} className="tabular">
            Przykład z rabatem: {p.name}, cena {money(p.before, 'PLN')}, P_10 {money(p.rebate, 'PLN')}, wartość {money(p.after, 'PLN')}
          </li>
        ))}
      </ul>
    </DetailSection>
  );
}

/* ── The lab ───────────────────────────────────────────────────────── */

function DocumentLab({ seed }: { seed: Seed }): ReactElement {
  const { go } = useProto();
  const [value, setValue] = useState<LabConfig>(seed.cfg);
  const [extra, setExtra] = useState<Extra | undefined>(seed.extra);
  const doc = useMemo(() => composeDoc(value), [value]);
  const sc = SCENARIOS[value.scenario];

  const onChange = (patch: Partial<LabConfig>): void => {
    setValue((v) => {
      const next = { ...v, ...patch };
      if (next.treatment === 'grosz' && !groszAllowed(next.provider)) next.treatment = 'omit';
      if (patch.scenario && !SCENARIOS[patch.scenario].gift) next.treatment = 'omit';
      if (patch.scenario && !SCENARIOS[patch.scenario].hasBundle) next.bundleMode = 'one-line';
      return next;
    });
    // Keep the error-41 and P_10 explanations while only the gift form changes.
    if (!(extra === 'error-41' && patch.treatment) && !(extra === 'p10' && patch.treatment)) setExtra(undefined);
  };

  let main: ReactNode;
  if (value.scenario === 'erli-eur') main = <EurReviewPanel />;
  else if (extra === 'rounding') main = <RoundingPanel />;
  else if (extra === 'discount') main = <DiscountPanel value={value} />;
  else if (extra === 'split-missing') main = <SplitMissingPanel value={value} />;
  else if (extra === 'error-41') main = <Error41Panel value={value} doc={doc} />;
  else
    main = (
      <>
        {extra === 'rebate-100' ? (
          <Alert tone="error" title="Forma cena katalogowa i rabat 100% nie jest dostępna">
            W interpretacji z 23 stycznia 2026 r. (0114-KDIP1-1.4012.876.2025.2.IZ) KIS uznała towar z rabatem 100% za nieodpłatną dostawę z art. 7 ust. 2, opodatkowaną od ceny nabycia i niedokumentowaną fakturą. Dlatego OpenLinker jej nie oferuje. Podgląd pokazuje gratis za 0,01 zł.
          </Alert>
        ) : null}
        {extra === 'other-rate' || (doc.status === 'held' && (value.treatment === 'omit' || value.treatment === 'grosz')) ? (
          <Alert tone="warning" title="Gratis w innej stawce: dokument wstrzymany" action={<Button tone="secondary" onClick={() => go('settings', 'treatment-not-set')}>Zmień formę gratisu w ustawieniach</Button>}>
            Kubek gratis ma stawkę 23%, a kawa 5%. {value.treatment === 'grosz' ? 'Grosz można zdjąć tylko z płatnej pozycji w tej samej stawce, a takiej tu nie ma.' : 'Pominięcie gratisu przeniosłoby jego wartość do stawki 5%.'} OpenLinker nie wystawia dokumentu, dopóki nie wybierzesz udziału w cenie albo ewidencji wewnętrznej.
          </Alert>
        ) : null}
        {extra === 'gift-wrap' ? (
          <Alert tone="info" title="Pakowanie na prezent jest osobną pozycją" action={<Button tone="secondary" onClick={() => go('bench')}>Zobacz na stanowisku pakowania</Button>}>
            Allegro przysłało płatną usługę GIFT_WRAP (9,90 zł). OpenLinker czyta ją jako pozycję usługi, więc trafia na paragon i fakturę, a pakowacz widzi prośbę o zapakowanie.
          </Alert>
        ) : null}
        <StandardPreviews value={value} doc={doc} paid={sc.paid} />
        {value.treatment === 'internal-record' && sc.gift ? <InternalRecordPanel doc={doc} /> : null}
        {value.bundleMode === 'components' && sc.hasBundle && sc.paidLines[0].bundle ? <BundleSplitTable bundle={sc.paidLines[0].bundle as 'morning' | 'brew'} /> : null}
        {extra === 'p10' ? <P10Note /> : null}
      </>
    );

  const extraBullets =
    value.scenario === 'erli-eur'
      ? ['Erli od maja 2026 r. przysyła walutę i rynek zamówienia. OpenLinker bierze walutę i kraj stawki z zamówienia, a nie stałe PLN i PL.', 'Dokument w złej walucie albo z polską stawką dla niemieckiego klienta nie wychodzi. Zamówienie trafia do przeglądu.', 'Możesz przypisać do rynku niemieckiego dostawcę, który wystawia dokumenty w EUR.']
      : extra === 'rounding'
        ? ['Reszta z zaokrąglenia zawsze trafia na największą płatną pozycję, nigdy na gratis. Jest przydzielana raz i potem już się nie przesuwa.', 'Gdy wartość pozycji nie dzieli się równo przez ilość, OpenLinker dzieli ją na dwie linie, żeby ilość razy cena dała wartość. To dzieje się samo, bez ustawienia.', 'Suma dokumentu jest w obu wersjach równa temu, co zapłacił klient. Zmienia się tylko to, która pozycja niesie grosz.', 'Decyzja: tak robią Apilo i Shopify, bez żadnego przycisku.']
        : extra === 'discount'
          ? ['Rabat na całe zamówienie OpenLinker rozkłada sam, proporcjonalnie do wartości pozycji, dokładnie do grosza. Dokument nie czeka.', 'Gratis za 0,00 zł nigdy nie dostaje rabatu. Reszta w groszach trafia na największą płatną pozycję.', 'Gdy podział ma być inny, zmień go ręcznie. Suma rabatów musi się zgadzać.', 'Decyzja: wszyscy rozkładają rabat sami, bez wstrzymania: BaseLinker, Apilo, Sellasist, Shopify, Brightpearl.']
          : extra === 'split-missing'
            ? ['Podział ceny zestawu liczy się z cen składników osobno. Gdy jakiegoś składnika nie ma osobno, zastępuje go koszt zakupu.', 'Tu nie ma ani ceny, ani kosztu, więc OpenLinker nie zgaduje i wstrzymuje dokument.', 'Uzupełnij cenę albo koszt składnika w edytorze zestawu albo przełącz zestaw na jedną linię.']
            : undefined;

  return (
    <div className="doc-lab">
      <Controls value={value} onChange={onChange} />
      {main}
      <WhyPanel value={value} doc={doc} extraBullets={extraBullets} />
    </div>
  );
}

/* ── States ────────────────────────────────────────────────────────── */

const STATES: StateDef[] = [
  { id: 'gift-same-rate-omitted', label: 'Gratis pominięty, ta sama stawka', note: 'Łyżeczka gratis ma 23%, tak jak linia zestawu. Pominięcie nie przesuwa podatku, więc paragon wychodzi bez gratisu. Stan łyżeczki i tak schodzi z PrestaShop z powodem gratis.', useCases: ['G-10', 'G-18'], priority: 'pilot', channels: ['allegro'] },
  { id: 'gift-other-rate-held', label: 'Gratis w innej stawce, wstrzymany', note: 'Kubek gratis (23%) do kawy (5%). Pominięcie przeniosłoby wartość między stawkami, więc OpenLinker wstrzymuje dokument z nazwanym powodem i odsyła do ustawień połączenia.', useCases: ['G-10', 'G-18'], priority: 'pilot', channels: ['allegro'] },
  { id: 'gift-grosz', label: 'Gratis za 0,01 zł', note: 'Gratis ma symboliczną cenę 0,01 zł. Grosz jest zdjęty z płatnej pozycji w tej samej stawce, więc suma dokumentu jest równa zapłacie i podatek się nie przesuwa. Ta forma jest potrzebna tylko u dostawcy, który odrzuca 0,00 zł (eparagony). Decyzja: grosz tylko z linii w tej samej stawce, jak w praktyce BaseLinkera dla IdoSell; Shopify i Sellasist w ogóle nie używają grosza.', useCases: ['G-10', 'G-18'], priority: 'pilot' },
  { id: 'gift-grosz-no-same-rate', label: 'Grosz bez pozycji w tej stawce', note: 'Kubek gratis ma 23%, a jedyna płatna pozycja (kawa) 5%. Grosza nie da się zdjąć z pozycji w tej samej stawce, więc OpenLinker go nie używa i wstrzymuje dokument z powodem. Decyzja: grosz z innej stawki przesuwałby podatek, dlatego nie ma takiego wyjścia awaryjnego.', useCases: ['G-10', 'G-18'], priority: 'pilot', channels: ['allegro'] },
  { id: 'gift-priced-in', label: 'Gratis z udziałem w cenie', note: 'Część zapłaty przechodzi na gratis proporcjonalnie do cen osobno, nie więcej niż jego cena. Każdy towar jest w swojej stawce. Klient widzi niższą cenę kawy.', useCases: ['G-10'], priority: 'later' },
  { id: 'gift-internal-record', label: 'Gratis w ewidencji wewnętrznej', note: 'Gratis nie trafia do klienta na dokumencie. OpenLinker zapisuje go w ewidencji nieodpłatnych przekazań z ceną nabycia i stawką. Próg 20 zł liczy się od kosztu, nie od ceny.', useCases: ['G-19', 'D-07'], priority: 'later' },
  { id: 'treatment-not-set', label: 'Forma nieustawiona: domyślnie pomiń', note: 'Nikt nie wybrał formy gratisu, więc działa domyślne pominięcie. Łyżeczka ma tę samą stawkę co zestaw, więc paragon wychodzi od razu. Decyzja: opcja "wstrzymuj każdy dokument z gratisem" usunięta, nikt na rynku jej nie ma (wszystkie 7 przeglądów).', useCases: ['G-10'], priority: 'pilot' },
  { id: 'bundle-one-line', label: 'Zestaw jako jedna linia', note: 'W pilocie zestaw zostaje na dokumencie jedną pozycją w stawce wariantu zestawu. Stan schodzi ze składników, dokument tego nie pokazuje.', useCases: ['B-14'], priority: 'pilot', channels: ['prestashop'] },
  { id: 'bundle-components', label: 'Zestaw jako składniki', note: 'Cena zestawu dzielona proporcjonalnie do cen osobno, reszta w groszach na największy udział. Każdy składnik ma swoją stawkę, a podział jest zamrażany do zwrotów.', useCases: ['B-14', 'R-05'], priority: 'later' },
  { id: 'bundle-split-missing', label: 'Brak klucza podziału', note: 'Składnik nie jest sprzedawany osobno i nie ma kosztu. OpenLinker nie zgaduje podziału i wstrzymuje dokument, a przycisk prowadzi do edytora zestawu.', useCases: ['B-14'], priority: 'later' },
  { id: 'rounding-cent', label: 'Grosz z zaokrąglenia', note: 'Kanał podał sumę o grosz wyższą niż suma pozycji. Przed: grosz trafia na ostatnią pozycję, czyli gratis. Po: grosz trafia na największą płatną pozycję, a gratis zostaje za 0,00 zł. Podział linii, gdy ilość razy cena się nie zgadza, też dzieje się sam. Decyzja: automatycznie i bez ustawienia, reszta przydzielana raz, jak w Shopify i Apilo.', useCases: ['G-17', 'D-01'], priority: 'pilot' },
  { id: 'order-discount-spread', label: 'Rabat całego zamówienia rozłożony', note: 'Kod rabatowy obniża całe zamówienie, nie pozycje. OpenLinker od razu rozkłada go proporcjonalnie do wartości pozycji, dokładnie do grosza, i dokument wychodzi bez czekania. "Zmień podział" pozwala ustawić go ręcznie. Decyzja: wszyscy rozkładają rabat sami, bez wstrzymania: BaseLinker, Apilo, Sellasist, Shopify, Brightpearl.', useCases: ['D-03'], priority: 'pilot', channels: ['prestashop'] },
  { id: 'eparagony-error-41', label: 'eparagony, kod 41', note: 'Gratis za 0,00 zł sam w swojej stawce dałby stawkę o wartości 0,00 zł. eparagony odrzuca taki paragon, więc OpenLinker sprawdza to przed wysłaniem i pokazuje przyczynę zamiast błędu dostawcy. Bez płatnej pozycji w stawce gratisu grosz odpada, więc podgląd pokazuje udział w cenie.', useCases: ['D-02', 'G-18'], priority: 'pilot', channels: ['idosell'] },
  { id: 'ksef-p10', label: 'Faktura KSeF z P_10', note: 'Faktura KSeF ma kolumnę P_10 na opusty. OpenLinker wypełnia ją dla zwykłych rabatów. KSeF przyjmuje 0,00 zł, więc gratis jest po prostu pominięty.', useCases: ['D-04'], priority: 'later' },
  { id: 'eur-de-vat', label: 'EUR i niemiecki VAT', note: 'Zamówienie z Erli na rynek niemiecki w EUR ze stawkami 7% i 19%. Żaden dostawca nie ma trasy dla EUR z niemieckim VAT, więc zamówienie dostaje zwykłą blokadę "brak trasy dokumentu" i nie wychodzi paragon w PLN. Decyzja: na razie wstrzymanie przez ogólną blokadę, docelowo automatyczna faktura OSS, tak jak robi to Shoper.', useCases: ['X-08'], priority: 'stage0', channels: ['erli'] },
  { id: 'gift-wrap-line', label: 'Płatne pakowanie na prezent', note: 'Allegro przysyła płatną usługę pakowania osobno od pozycji. OpenLinker dodaje ją jako pozycję usługi bez stanu, więc dokument zgadza się z zapłatą, a pakowacz widzi prośbę.', useCases: ['D-05'], priority: 'stage0', channels: ['allegro'] },
  { id: 'rebate-100-high-risk', label: 'Rabat 100% niedostępny', note: 'Forma cena katalogowa i rabat 100% jest na liście, ale wyłączona. Interpretacja KIS z 2026 r. traktuje ją jako nieodpłatną dostawę. Podgląd pokazuje bezpieczną zamianę: 0,01 zł.', useCases: ['G-10'], priority: 'out' },
];

export const screen: ScreenDef = {
  id: 'documents',
  group: 'Dokumenty',
  label: 'Paragon i faktura',
  states: STATES,
  render: (state) => {
    const seed = SEEDS[state === 'order-discount-held' ? 'order-discount-spread' : state] ?? SEEDS['gift-same-rate-omitted'];
    return (
      <PageLayout
        title="Paragon i faktura"
        description="Podgląd dokumentu sprzedaży dla zamówienia z zestawem lub gratisem. Zmień zamówienie, formę gratisu, zestaw albo dostawcę, a podgląd przeliczy się od razu."
      >
        <DocumentLab key={state} seed={seed} />
      </PageLayout>
    );
  },
};

