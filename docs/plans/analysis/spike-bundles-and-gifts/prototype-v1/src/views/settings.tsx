/**
 * Ustawienia połączeń (settings): per connection, how the channel sends
 * bundles, how a gift and a bundle appear on the sales document, and what the
 * document provider declares it can print. Live receipt or invoice preview.
 */
import { useState, type ReactElement } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { DetailSection } from '@web/shared/ui/detail-section';
import { Select } from '@web/shared/ui/select';
import { SegmentedControl } from '@web/shared/ui/segmented-control';
import { FilterCheck } from '@web/shared/ui/filter-check';
import { FormField } from '@web/shared/ui/form-field';
import { KeyValueList } from '@web/shared/ui/key-value-list';
import { StatusBadge, type StatusBadgeTone } from '@web/shared/ui/status-badge';
import { Alert } from '@web/shared/ui/alert';
import { Button } from '@web/shared/ui/button';
import { useToast } from '@web/shared/ui/toast-provider';
import { BUNDLES, DOC_PROVIDERS, VARIANTS, type ChannelId, type DocProvider, type GiftDocTreatment } from '../model/catalog';
import { buildDocument, type DocResult } from '../model/calc';
import { commonStates, useProto, useWriteGuard, type ScreenDef } from '../proto';
import { InvoicePreview, ReceiptPreview } from '../ui/documents';
import { GiftMark } from '../ui/marks';
import './cfg.css';

type Scenario = 'allegro' | 'prestashop' | 'shoper-unknown' | 'eparagony' | 'ksef' | 'treatment-not-set' | 'viewer-readonly';
type ConnId = 'allegro' | 'prestashop' | 'woocommerce' | 'shoper' | 'erli' | 'eparagony' | 'ksef';
type BundleShapeChoice = 'adapter' | 'parent-only' | 'children';

interface Conn {
  id: ConnId;
  name: string;
  kind: 'channel' | 'docs';
  channel?: ChannelId;
  provider: DocProvider;
  /** What the adapter declares about bundles, null = not declared. */
  adapterShape: 'parent-only' | 'children' | null;
  adapterText: string;
  priceSide: string;
}

const CONNS: Conn[] = [
  { id: 'allegro', name: 'Allegro: kawowyswiat', kind: 'channel', channel: 'allegro', provider: 'eparagony', adapterShape: 'parent-only', adapterText: 'Wysyła jedną pozycję zestawu. Skład oferty (productSet) przychodzi tylko do sprawdzenia, bez wariantów OpenLinkera.', priceSide: 'na pozycji zestawu' },
  { id: 'prestashop', name: 'PrestaShop: kawowyswiat.pl', kind: 'channel', channel: 'prestashop', provider: 'subiekt', adapterShape: 'parent-only', adapterText: 'Pak przychodzi jako jedna pozycja w stawce paka. Gratis z reguły koszyka przychodzi w pełnej cenie, a jego wartość jest tylko w rabatach koszyka.', priceSide: 'na pozycji paka' },
  { id: 'woocommerce', name: 'WooCommerce: sklep.kawowyswiat.pl', kind: 'channel', channel: 'woocommerce', provider: 'infakt', adapterShape: 'children', adapterText: 'Wtyczki zestawów wysyłają pozycję zestawu i składniki jako osobne pozycje.', priceSide: 'zależy od wtyczki: na zestawie albo na składnikach' },
  { id: 'shoper', name: 'Shoper: kawa-sklep', kind: 'channel', channel: 'shoper', provider: 'eparagony', adapterShape: null, adapterText: 'Adapter nie deklaruje, czy wysyła składniki zestawu jako pozycje.', priceSide: 'nieznane' },
  { id: 'erli', name: 'Erli: kawowyswiat', kind: 'channel', channel: 'erli', provider: 'eparagony', adapterShape: 'parent-only', adapterText: 'Wysyła tylko SKU zestawu, bez składników.', priceSide: 'na pozycji zestawu' },
  { id: 'eparagony', name: 'eparagony.pl: kasa wirtualna', kind: 'docs', provider: 'eparagony', adapterShape: null, adapterText: '', priceSide: '' },
  { id: 'ksef', name: 'KSeF: faktury', kind: 'docs', provider: 'ksef', adapterShape: null, adapterText: '', priceSide: '' },
];

const CONN_OF: Record<Scenario, ConnId> = {
  allegro: 'allegro',
  prestashop: 'prestashop',
  'shoper-unknown': 'shoper',
  eparagony: 'eparagony',
  ksef: 'ksef',
  'treatment-not-set': 'allegro',
  'viewer-readonly': 'allegro',
};

interface TreatmentDef {
  value: GiftDocTreatment;
  label: string;
  risk: string;
  tone: StatusBadgeTone;
  desc: string;
}

const TREATMENTS: TreatmentDef[] = [
  { value: 'omit', label: 'Pomiń gratis (domyślnie)', risk: 'Ryzyko niskie', tone: 'success', desc: 'Gratis nie trafia na dokument. Gdy jego stawka jest inna niż płatnych pozycji, dokument czeka z nazwanym powodem.' },
  { value: 'grosz', label: 'Gratis za 0,01 zł, grosz z płatnej pozycji w tej samej stawce', risk: 'Ryzyko niskie do średniego', tone: 'warning', desc: 'Gratis jest na dokumencie w swojej stawce. Grosz jest zdjęty z płatnej pozycji w tej samej stawce, więc suma zgadza się z zapłatą. Gdy takiej pozycji nie ma, dokument czeka.' },
  { value: 'priced-in', label: 'Gratis z udziałem w zapłaconej kwocie', risk: 'Ryzyko niskie', tone: 'success', desc: 'Część zapłaconej kwoty przechodzi na gratis proporcjonalnie do cen, nigdy powyżej jego ceny. Suma zgadza się z zapłatą.' },
  { value: 'internal-record', label: 'Zapis w ewidencji nieodpłatnych przekazań (art. 7 ust. 2)', risk: 'Ryzyko niskie', tone: 'success', desc: 'Gratisu nie ma na dokumencie klienta. OpenLinker zapisuje go osobno z kosztem zakupu i stawką.' },
];

type Decl = 'yes' | 'no' | 'undeclared';
interface ProviderDecl {
  zeroLine: Decl;
  zeroRateBucket: Decl;
  lineRebate: Decl;
  p10: Decl;
}

function declOf(p: DocProvider): ProviderDecl {
  const d = DOC_PROVIDERS[p];
  const yn = (b: boolean): Decl => (b ? 'yes' : 'no');
  if (p === 'subiekt') return { zeroLine: yn(d.zeroLine), zeroRateBucket: 'undeclared', lineRebate: yn(d.lineRebate), p10: 'undeclared' };
  return { zeroLine: yn(d.zeroLine), zeroRateBucket: yn(d.zeroRateBucket), lineRebate: yn(d.lineRebate), p10: yn(d.p10) };
}

const DECL_ROWS: { key: keyof ProviderDecl; label: string }[] = [
  { key: 'zeroLine', label: 'Pozycja za 0,00 zł' },
  { key: 'zeroRateBucket', label: 'Stawka VAT o wartości 0' },
  { key: 'lineRebate', label: 'Rabat na pozycji' },
  { key: 'p10', label: 'Opust na pozycji (P_10)' },
];

function DeclCell({ v }: { v: Decl }): ReactElement {
  if (v === 'yes') return <span className="cfg-check-yes">Tak</span>;
  if (v === 'no') return <span className="cfg-check-no">Nie</span>;
  return <span className="cfg-check-no">nie deklaruje, traktujemy jak "nie"</span>;
}

const GIFT_SAMPLE = { spoon: 'Łyżeczka do kawy, 23%', sample: 'Próbka kawy, 5%' } as const;
type GiftSample = keyof typeof GIFT_SAMPLE;

function previewDoc(treatment: GiftDocTreatment, bundleMode: 'one-line' | 'components', gift: GiftSample, provider: DocProvider): DocResult {
  return buildDocument({
    paidLines: [{ name: BUNDLES.morning.name, qty: 1, unitGross: BUNDLES.morning.price, vat: 23, bundle: 'morning' }],
    gift: { variant: gift, qty: 1 },
    giftTreatment: treatment,
    bundleMode,
    refusesZeroRate: provider === 'eparagony',
  });
}

/** What eparagony would get for a 0,00 gift alone in its VAT rate. Built by hand: no treatment produces it. */
function refusedZeroRateDoc(): DocResult {
  return {
    status: 'refused',
    reason: 'eparagony.pl odrzuca paragon: stawka C (5%) ma wartość 0 po rabatach. Kod błędu 41, odmowa przed drukarką.',
    lines: [
      { name: BUNDLES.morning.name, qty: 1, unitGross: BUNDLES.morning.price, gross: BUNDLES.morning.price, vat: 23, kind: 'bundle' },
      { name: `${VARIANTS.sample.name} (gratis)`, qty: 1, unitGross: 0, gross: 0, vat: 5, kind: 'gift' },
    ],
    total: BUNDLES.morning.price,
    perRate: [
      { rate: 23, gross: BUNDLES.morning.price, vat: 1215 },
      { rate: 5, gross: 0, vat: 0 },
    ],
  };
}

function SettingsScreen({ scenario }: { scenario: Scenario }): ReactElement {
  const { go } = useProto();
  const { showToast } = useToast();
  const guard = useWriteGuard();
  const forcedRo = scenario === 'viewer-readonly';
  const canWrite = guard.canWrite && !forcedRo;
  const reason = forcedRo ? 'Masz dostęp tylko do odczytu. Zmiany wymagają roli administratora lub operatora.' : guard.reason;

  const [connId, setConnId] = useState<ConnId>(CONN_OF[scenario]);
  const conn = CONNS.find((c) => c.id === connId) ?? CONNS[0];
  const [shape, setShape] = useState<BundleShapeChoice>('adapter');
  const unset = scenario === 'treatment-not-set';
  const [chosen, setTreatment] = useState<GiftDocTreatment>(scenario === 'eparagony' ? 'grosz' : 'omit');
  const [bundleMode, setBundleMode] = useState<'one-line' | 'components'>('one-line');
  const [gift, setGift] = useState<GiftSample>(scenario === 'treatment-not-set' ? 'sample' : 'spoon');

  const effectiveShape: 'parent-only' | 'children' = shape === 'adapter' ? conn.adapterShape ?? 'children' : shape;
  const provider = conn.provider;
  // The 1 grosz form exists only for providers that refuse a 0,00 line or rate (eparagony error 41).
  const groszAllowed = !DOC_PROVIDERS[provider].zeroRateBucket || !DOC_PROVIDERS[provider].zeroLine;
  const treatment: GiftDocTreatment = chosen === 'grosz' && !groszAllowed ? 'omit' : chosen;
  const decl = declOf(provider);
  const doc = previewDoc(treatment, bundleMode, gift, provider);
  const invoice = provider === 'ksef' || provider === 'infakt';

  return (
    <PageLayout
      title="Ustawienia połączeń"
      description="Jak kanał wysyła zestawy i gratisy oraz jak pokazujemy je na dokumentach sprzedaży. Ustawienia działają na nowe zamówienia z tego połączenia."
      actions={
        <Button disabled={!canWrite} title={reason} onClick={() => showToast({ title: 'Zapisano ustawienia', description: `${conn.name}: ustawienia zestawów i gratisów zapisane.`, tone: 'success' })}>
          Zapisz ustawienia
        </Button>
      }
    >
      <div className="cfg-stack">
        {forcedRo ? (
          <Alert tone="info" density="compact" title="Tylko do odczytu">
            Widzisz ustawienia, ale ich nie zmienisz. Poproś administratora o zmianę.
          </Alert>
        ) : null}
        <FormField label="Połączenie" name="connection">
          <Select value={connId} onChange={(e) => setConnId(e.target.value as ConnId)}>
            <optgroup label="Kanały sprzedaży">
              {CONNS.filter((c) => c.kind === 'channel').map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Dokumenty sprzedaży">
              {CONNS.filter((c) => c.kind === 'docs').map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </FormField>

        {unset && conn.kind === 'channel' ? (
          <Alert tone="info" title="Forma gratisu nieustawiona: działa domyślne pominięcie" action={<Button tone="secondary" onClick={() => go('orders')}>Zobacz zamówienia</Button>}>
            Nikt nie wybrał formy, więc gratis jest pomijany na dokumencie. Dokumenty wychodzą od razu, gdy gratis ma tę samą stawkę co płatna pozycja. Gdy stawka jest inna, jak przy próbce kawy, dokument czeka z powodem: wtedy wybierz udział w cenie albo ewidencję.
          </Alert>
        ) : null}

        {conn.kind === 'channel' ? (
          <DetailSection title="Jak kanał wysyła zestawy">
            <div className="cfg-stack">
              <KeyValueList
                items={[
                  { id: 'adapter', label: 'Deklaracja adaptera', value: conn.adapterShape === null ? <span className="cfg-row"><StatusBadge tone="warning" compact>Nieznane</StatusBadge><span>{conn.adapterText}</span></span> : conn.adapterText },
                  { id: 'price', label: 'Gdzie jest cena i VAT zestawu', value: conn.priceSide },
                ]}
              />
              <FormField label="Twoje ustawienie" name="bundle-shape" description="Nadpisz deklarację adaptera, gdy wiesz, jak działa Twój sklep albo wtyczka.">
                <Select value={shape} disabled={!canWrite} title={reason} onChange={(e) => setShape(e.target.value as BundleShapeChoice)}>
                  <option value="adapter">{conn.adapterShape === null ? 'Jak adapter (nieznane, bezpieczny domyślny)' : 'Jak adapter'}</option>
                  <option value="parent-only">Wysyła tylko pozycję zestawu</option>
                  <option value="children">Wysyła składniki jako osobne pozycje</option>
                </Select>
              </FormField>
              {effectiveShape === 'children' ? (
                <Alert tone={conn.adapterShape === null && shape === 'adapter' ? 'warning' : 'info'} density="compact" title={conn.adapterShape === null && shape === 'adapter' ? 'Traktujemy jak wysyłające składniki' : 'Składniki przychodzą jako pozycje'}>
                  {conn.adapterShape === null && shape === 'adapter'
                    ? 'Dopóki nie potwierdzisz, jak sklep wysyła zestawy, OpenLinker zakłada najbezpieczniejsze: składniki przychodzą jako pozycje. Definicje zestawów są na tym połączeniu odrzucane, żeby stan nie zszedł dwa razy.'
                    : 'Stan schodzi ze składników z zamówienia. Zestawy zdefiniowane w OpenLinkerze nie są publikowane na tym połączeniu, żeby nie liczyć ich dwa razy.'}
                </Alert>
              ) : (
                <p className="cfg-muted">Zestaw przychodzi jako jedna pozycja. OpenLinker rozkłada go na składniki według definicji i rezerwuje każdy z nich.</p>
              )}
            </div>
          </DetailSection>
        ) : (
          <Alert tone="info" density="compact" title="To połączenie wystawia dokumenty">
            Formę gratisu i zestawu ustawiasz przy kanale, z którego przychodzi zamówienie. Tu widzisz, co ten dostawca przyjmuje, i podgląd każdej formy.
          </Alert>
        )}

        <div className={`cfg-split${invoice ? '' : ' cfg-split--aside'}`}>
          <div className="cfg-stack">
            <DetailSection title="Gratis na dokumencie">
              <div className="cfg-stack">
                <p className="cfg-secondary">Forma zależy od dostawcy dokumentu: {DOC_PROVIDERS[provider].name}. Domyślnie gratis jest pomijany. 0,01 zł jest dostępne tylko u dostawcy, który odrzuca pozycję lub stawkę za 0,00 zł. To decyzja podatkowa: skonsultuj z doradcą podatkowym. OpenLinker nie udziela porad prawnych.</p>
                <ul className="cfg-options" role="radiogroup" aria-label="Gratis na dokumencie">
                  {TREATMENTS.map((t) => {
                    const blocked = t.value === 'grosz' && !groszAllowed;
                    return (
                      <li key={t.value} className={`cfg-option${treatment === t.value ? ' cfg-option--active' : ''}${blocked ? ' cfg-option--disabled' : ''}`}>
                        <span className="cfg-option__head">
                          <FilterCheck type="radio" name="gift-treatment" label={t.label} checked={treatment === t.value} disabled={!canWrite || blocked} title={blocked ? `${DOC_PROVIDERS[provider].name} przyjmuje 0,00 zł, więc grosz nie jest potrzebny.` : reason} onChange={() => setTreatment(t.value)} />
                          <StatusBadge tone={blocked ? 'neutral' : t.tone} compact>{blocked ? 'Niepotrzebne u tego dostawcy' : t.risk}</StatusBadge>
                        </span>
                        <p className="cfg-option__desc">{blocked ? `${DOC_PROVIDERS[provider].name} przyjmuje pozycję za 0,00 zł, więc wystarczy pominąć gratis.` : t.desc}</p>
                      </li>
                    );
                  })}
                  <li className="cfg-option cfg-option--disabled">
                    <span className="cfg-option__head">
                      <FilterCheck type="radio" name="gift-treatment" label="Cena katalogowa i rabat 100%" disabled checked={false} onChange={() => undefined} />
                      <StatusBadge tone="error" compact>Ryzyko wysokie, niedostępne</StatusBadge>
                    </span>
                    <p className="cfg-option__desc">Nie oferujemy tej formy. Interpretacja KIS z 23 stycznia 2026 uznała taki zapis za nieodpłatne przekazanie, a nie rabat.</p>
                  </li>
                </ul>
                <p className="cfg-muted">{unset ? 'Nikt jeszcze nie wybrał formy, działa domyślne pominięcie.' : 'Ustawione przez Annę Nowak, 2 lis 2026, z adnotacją "po konsultacji z doradcą".'}</p>
                <p className="cfg-muted">Inny sposób spotykany na rynku: Sellasist pokazuje gratis w pełnej cenie i dodaje linię rabatu w każdej stawce VAT. OpenLinker tego nie oferuje, bo rabat 100% na gratisie KIS w 2026 r. uznała za ryzykowny.</p>
              </div>
            </DetailSection>

            <DetailSection title="Zestaw na dokumencie">
              <div className="cfg-stack cfg-stack--tight">
                <SegmentedControl className="cfg-seg"
                  aria-label="Zestaw na dokumencie"
                  options={[
                    { value: 'one-line', label: 'Jedna pozycja zestawu', disabled: !canWrite },
                    { value: 'components', label: 'Składniki osobno', disabled: !canWrite },
                  ]}
                  value={bundleMode}
                  onChange={(v) => setBundleMode(v as 'one-line' | 'components')}
                />
                <p className="cfg-muted">
                  Zestaw poranny ma składniki w stawkach 23% i 5%. W pilocie dokument zostawia jedną pozycję w stawce zestawu. "Składniki osobno" dzieli cenę proporcjonalnie do cen osobno i każdy składnik dostaje swoją stawkę. Skonsultuj wybór z doradcą podatkowym.
                </p>
                {bundleMode === 'components' ? (
                  <StatusBadge tone="neutral" compact>Po pilocie</StatusBadge>
                ) : null}
              </div>
            </DetailSection>

          </div>

          <aside className="cfg-preview" aria-label="Podgląd dokumentu">
            <p className="cfg-strong">Podgląd: {DOC_PROVIDERS[provider].name}</p>
            <FormField label="Gratis w przykładzie" name="gift-sample">
              <SegmentedControl className="cfg-seg" aria-label="Gratis w przykładzie" options={(Object.keys(GIFT_SAMPLE) as GiftSample[]).map((g) => ({ value: g, label: GIFT_SAMPLE[g] }))} value={gift} onChange={(v) => setGift(v as GiftSample)} />
            </FormField>
            <span className="cfg-row">
              <GiftMark source="ol-rule" />
              <span className="cfg-muted">Zestaw poranny 64,99 zł i gratis</span>
            </span>
            {invoice ? <InvoicePreview doc={doc} p10={provider === 'ksef'} /> : <ReceiptPreview doc={doc} />}
            {treatment === 'omit' && doc.status === 'ready' ? (
              <p className="cfg-muted">Gratis pominięty na dokumencie: ma tę samą stawkę VAT co płatna pozycja. Stan i tak schodzi z magazynu z powodem "gratis".</p>
            ) : null}
            {provider === 'eparagony' && scenario === 'eparagony' ? (
              <>
                <p className="cfg-muted">Tak wyglądałaby odmowa, gdyby gratis 0,00 zł był sam w swojej stawce:</p>
                <ReceiptPreview doc={refusedZeroRateDoc()} title="Paragon odrzucony" />
              </>
            ) : null}
          </aside>
        </div>
        <DetailSection title="Co deklaruje dostawca dokumentów">
          <div className="cfg-stack">
            <div className="cfg-scroll">
              <table className="cfg-table">
                <caption className="sr-only">Deklaracje dostawców dokumentów</caption>
                <thead>
                  <tr>
                    <th scope="col">Możliwość</th>
                    {(Object.keys(DOC_PROVIDERS) as DocProvider[]).map((p) => (
                      <th key={p} scope="col" style={p === provider ? { color: 'var(--text-primary)' } : undefined}>
                        {DOC_PROVIDERS[p].name}
                        {p === provider ? <span className="spike-note">to połączenie</span> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DECL_ROWS.map((r) => (
                    <tr key={r.key}>
                      <th scope="row">{r.label}</th>
                      {(Object.keys(DOC_PROVIDERS) as DocProvider[]).map((p) => (
                        <td key={p} className={p === provider ? 'cfg-strong' : undefined}>
                          <DeclCell v={declOf(p)[r.key]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {Object.values(decl).includes('undeclared') ? (
              <p className="cfg-muted">Czego adapter nie deklaruje, OpenLinker nie używa: wybiera bezpieczną formę, w której rabat jest już w cenie pozycji.</p>
            ) : null}
            {provider === 'eparagony' ? (
              <Alert tone="error" density="compact" title="Ustawienie odrzucone przez urządzenie">
                "Gratis jako pozycja 0,00 zł w stawce, w której nie ma płatnej pozycji" nie jest dostępne. eparagony.pl odrzuca stawkę VAT o wartości 0 po rabatach (kod błędu 41), zanim paragon trafi do drukarki.
              </Alert>
            ) : null}
            {provider === 'ksef' ? (
              <Alert tone="info" density="compact" title="KSeF przyjmuje opust na pozycji">
                Faktura może pokazać cenę katalogową i opust w polu P_10. Gratis jako pozycja z opustem 100% nie jest jednak oferowany z powodu ryzyka opisanego wyżej.
              </Alert>
            ) : null}
          </div>
        </DetailSection>
      </div>
    </PageLayout>
  );
}

export const screen: ScreenDef = {
  id: 'settings',
  group: 'Ustawienia',
  label: 'Ustawienia połączeń',
  states: [
    { id: 'allegro', label: 'Allegro', note: 'Allegro nie zna gratisów i wysyła jedną pozycję zestawu. Forma gratisu na paragonie to ustawienie operatora zależne od dostawcy dokumentu: domyślnie pomiń, 0,01 zł tylko u dostawcy, który odrzuca 0,00 zł. Zmień formę albo gratis w przykładzie, żeby zobaczyć podgląd paragonu.', useCases: ['G-10', 'X-03'], priority: 'pilot', channels: ['allegro'] },
    { id: 'prestashop', label: 'PrestaShop', note: 'Pak przychodzi jako jedna pozycja w swojej stawce. Gratis z reguły koszyka przychodzi w pełnej cenie, a wartość jest w rabatach koszyka. Dokumenty wystawia Subiekt GT, który nie deklaruje części możliwości.', useCases: ['B-19', 'X-03', 'D-04'], priority: 'pilot', channels: ['prestashop'] },
    { id: 'shoper-unknown', label: 'Shoper: nieznane', note: 'Adapter Shopera nie deklaruje, czy wysyła składniki zestawu jako pozycje. OpenLinker przyjmuje najbezpieczniejszy domyślny: tak, wysyła. Definicje zestawów są odrzucane, dopóki operator tego nie potwierdzi.', useCases: ['B-05', 'B-19', 'X-03', 'B-27'], priority: 'pilot', channels: ['shoper'] },
    { id: 'eparagony', label: 'eparagony.pl: odmowa urządzenia', note: 'eparagony.pl odrzuca stawkę VAT o wartości 0 po rabatach (kod 41, sprawdzone na sandboksie). Tylko tu dostępna jest forma 0,01 zł, z groszem z płatnej pozycji w tej samej stawce. U dostawców, którzy przyjmują 0,00 zł, ta opcja jest wyłączona z powodem. Decyzja: forma zależy od dostawcy, domyślnie pomiń; Shopify i Sellasist w ogóle nie używają grosza.', useCases: ['G-10', 'D-04'], priority: 'pilot' },
    { id: 'ksef', label: 'KSeF: opust P_10', note: 'KSeF deklaruje opust na pozycji (P_10). Faktura może pokazać cenę i opust, ale forma "rabat 100%" i tak nie jest oferowana z powodu interpretacji KIS 2026.', useCases: ['D-04', 'G-10'], priority: 'later' },
    { id: 'treatment-not-set', label: 'Forma nieustawiona: domyślnie pomiń', note: 'Nikt nie wybrał formy gratisu, więc działa domyślne pominięcie i dokumenty wychodzą. Wstrzymany jest tylko dokument, w którym gratis ma inną stawkę niż płatna pozycja (tu próbka kawy 5%). Decyzja: opcja "wstrzymuj każdy dokument z gratisem" usunięta, nie ma jej BaseLinker, Apilo, Sellasist, Shopify ani Linnworks.', useCases: ['G-10', 'B-05'], priority: 'pilot', channels: ['allegro'] },
    { id: 'viewer-readonly', label: 'Tylko do odczytu', note: 'Użytkownik bez uprawnień widzi wszystkie ustawienia i podgląd dokumentu, ale nie zmieni formy ani nie zapisze. Każdy wyłączony przycisk mówi dlaczego.', useCases: ['X-03'], priority: 'pilot' },
    ...commonStates('ustawień połączeń', 'dodaj pierwsze połączenie'),
  ],
  render: (state) => <SettingsScreen key={state} scenario={state as Scenario} />,
};
