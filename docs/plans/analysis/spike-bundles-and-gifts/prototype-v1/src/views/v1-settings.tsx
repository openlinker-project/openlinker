/**
 * Ustawienia połączeń, wersja prosta: per connection two lines (gift and bundle
 * on the document) next to a live document preview. Alternatives hide behind
 * "Zmień (dla księgowej)". Everything the connector does on its own (grosz where
 * the provider refuses 0, other VAT rate priced in, order discount spread,
 * rounding) shows as one line, only when it applies.
 */
import { useState, type ReactElement } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { DetailSection } from '@web/shared/ui/detail-section';
import { Select } from '@web/shared/ui/select';
import { SegmentedControl } from '@web/shared/ui/segmented-control';
import { FilterCheck } from '@web/shared/ui/filter-check';
import { FormField } from '@web/shared/ui/form-field';
import { KeyValueList } from '@web/shared/ui/key-value-list';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { Alert } from '@web/shared/ui/alert';
import { Button } from '@web/shared/ui/button';
import { useToast } from '@web/shared/ui/toast-provider';
import { DOC_PROVIDERS, VARIANTS, type DocProvider } from '../model/catalog';
import { buildDocument, type DocLine, type DocResult } from '../model/calc';
import { commonStates, useMoney, useWriteGuard, type ScreenDef, type StateDef } from '../proto';
import { InvoicePreview, ReceiptPreview } from '../ui/documents';
import { EUR_ORDER, SCENARIOS, allocateDiscount, finalize, roundingAfter, composeDoc, splitMissingDoc, type ScenarioId } from './doc-data';
import './cfg.css';
import './v1-misc.css';

type GiftForm = 'omit' | 'show' | 'priced-in' | 'internal-record';
type BundleForm = 'one-line' | 'components';
type ConnId = 'allegro' | 'prestashop' | 'woocommerce' | 'shoper' | 'erli';
type AutoExample = 'discount' | 'rounding' | 'wrap';

const CONNS: Record<ConnId, { name: string; provider: DocProvider }> = {
  allegro: { name: 'Allegro: kawowyswiat', provider: 'eparagony' },
  prestashop: { name: 'PrestaShop: kawowyswiat.pl', provider: 'subiekt' },
  woocommerce: { name: 'WooCommerce: sklep.kawowyswiat.pl', provider: 'ksef' },
  shoper: { name: 'Shoper: kawa-sklep', provider: 'eparagony' },
  erli: { name: 'Erli: kawowyswiat', provider: 'eparagony' },
};

const GIFT_FORM_LABEL: Record<GiftForm, string> = {
  omit: 'pomijany',
  show: 'pokazany za 0 zł',
  'priced-in': 'wliczony w zapłaconą kwotę',
  'internal-record': 'w ewidencji wewnętrznej',
};

const GIFT_FORM_DESC: Record<GiftForm, string> = {
  omit: 'Gratisu nie ma na dokumencie. Stan i tak schodzi z magazynu. Tak robią Shoper i Apilo.',
  show: 'Gratis jest pozycją za 0,00 zł. Gdy dostawca nie przyjmuje zera, integracja sama zdejmuje 0,01 zł z płatnej pozycji w tej samej stawce.',
  'priced-in': 'Część zapłaty przechodzi na gratis, proporcjonalnie do cen, każdy towar w swojej stawce.',
  'internal-record': 'Gratis nie trafia na dokument klienta. OpenLinker zapisuje go jako nieodpłatne przekazanie z kosztem zakupu.',
};

/** What the connector did on its own for this document, one sentence, only when it applies. */
type AutoNote = 'other-rate' | 'grosz' | null;

/** Providers that take a 0,00 line and a 0,00 rate (KSeF, inFakt). Others get the grosz. */
const takesZero = (p: DocProvider): boolean => DOC_PROVIDERS[p].zeroLine && DOC_PROVIDERS[p].zeroRateBucket;

function compose(scn: ScenarioId, form: GiftForm, provider: DocProvider, bundle: BundleForm): { doc: DocResult; auto: AutoNote } {
  const sc = SCENARIOS[scn];
  const base = { paidLines: sc.paidLines, gift: sc.gift, bundleMode: bundle, refusesZeroRate: provider === 'eparagony' } as const;
  const asPricedIn = (): DocResult => composeDoc({ scenario: scn, treatment: 'priced-in', bundleMode: bundle, provider });
  if (!sc.gift) return { doc: composeDoc({ scenario: scn, treatment: 'omit', bundleMode: bundle, provider }), auto: null };
  if (form === 'omit') {
    const doc = buildDocument({ ...base, giftTreatment: 'omit' });
    return doc.status === 'ready' ? { doc: finalize(doc.lines, 'ready'), auto: null } : { doc: asPricedIn(), auto: 'other-rate' };
  }
  if (form === 'show') {
    if (takesZero(provider)) {
      const paid = buildDocument({ ...base, gift: undefined, giftTreatment: 'omit' });
      const g = VARIANTS[sc.gift.variant];
      const zero: DocLine = { name: `${g.name} (gratis)`, qty: sc.gift.qty, unitGross: 0, gross: 0, vat: g.vat, kind: 'gift', note: 'gratis, 0,00 zł' };
      return { doc: finalize([...paid.lines, zero], 'ready'), auto: null };
    }
    const doc = buildDocument({ ...base, giftTreatment: 'grosz' });
    return doc.status === 'ready' ? { doc: finalize(doc.lines, 'ready'), auto: 'grosz' } : { doc: asPricedIn(), auto: 'other-rate' };
  }
  return { doc: composeDoc({ scenario: scn, treatment: form, bundleMode: bundle, provider }), auto: null };
}

interface Seed {
  conn: ConnId;
  scenario: ScenarioId;
  gift: GiftForm;
  bundle: BundleForm;
  open?: boolean;
  readOnly?: boolean;
}

const SEEDS: Record<string, Seed> = {
  default: { conn: 'allegro', scenario: 'morning-spoon', gift: 'omit', bundle: 'one-line' },
  'gift-other-rate': { conn: 'allegro', scenario: 'coffee-mug', gift: 'omit', bundle: 'one-line' },
  'show-gift-receipt': { conn: 'allegro', scenario: 'morning-spoon', gift: 'show', bundle: 'one-line', open: true },
  'show-gift-ksef': { conn: 'woocommerce', scenario: 'morning-spoon', gift: 'show', bundle: 'one-line', open: true },
  'internal-record': { conn: 'allegro', scenario: 'morning-spoon', gift: 'internal-record', bundle: 'one-line', open: true },
  'bundle-components': { conn: 'prestashop', scenario: 'brew', gift: 'omit', bundle: 'components', open: true },
  'bundle-split-missing': { conn: 'prestashop', scenario: 'brew', gift: 'omit', bundle: 'components' },
  automatic: { conn: 'allegro', scenario: 'morning-spoon', gift: 'omit', bundle: 'one-line' },
  'shoper-unknown': { conn: 'shoper', scenario: 'morning-spoon', gift: 'omit', bundle: 'one-line' },
  'erli-eur': { conn: 'erli', scenario: 'morning-spoon', gift: 'omit', bundle: 'one-line' },
  'viewer-readonly': { conn: 'allegro', scenario: 'morning-spoon', gift: 'omit', bundle: 'one-line', readOnly: true },
};

function Preview({ doc, provider, paid }: { doc: DocResult; provider: DocProvider; paid: number }): ReactElement {
  const money = useMoney();
  const invoice = provider === 'ksef' || provider === 'infakt';
  return (
    <aside className="cfg-preview" aria-label="Podgląd dokumentu">
      <p className="cfg-strong">Podgląd: {DOC_PROVIDERS[provider].name}</p>
      {invoice ? <InvoicePreview doc={doc} p10={provider === 'ksef'} /> : <ReceiptPreview doc={doc} />}
      {doc.status === 'ready' && paid > 0 ? (
        <p className="cfg-muted">
          Suma dokumentu {money(doc.total, 'PLN')} = klient zapłacił {money(paid, 'PLN')}.
        </p>
      ) : null}
    </aside>
  );
}

function SettingsV1({ stateId }: { stateId: string }): ReactElement {
  const seed = SEEDS[stateId] ?? SEEDS.default;
  const { showToast } = useToast();
  const guard = useWriteGuard();
  const canWrite = guard.canWrite && !seed.readOnly;
  const reason = seed.readOnly ? 'Masz dostęp tylko do odczytu. Zmiany wymagają roli administratora lub operatora.' : guard.reason;

  const [connId, setConnId] = useState<ConnId>(seed.conn);
  const [gift, setGift] = useState<GiftForm>(seed.gift);
  const [bundle, setBundle] = useState<BundleForm>(seed.bundle);
  const [open, setOpen] = useState(Boolean(seed.open));
  const [shape, setShape] = useState<'unknown' | 'parent-only' | 'children'>('unknown');
  const [example, setExample] = useState<AutoExample>('discount');
  const conn = CONNS[connId];
  const provider = conn.provider;
  const scenario = SCENARIOS[connId === seed.conn ? seed.scenario : 'morning-spoon'];
  const splitMissing = stateId === 'bundle-split-missing' && bundle === 'components';
  const { doc, auto } = splitMissing ? { doc: splitMissingDoc(), auto: null } : compose(scenario.id, gift, provider, bundle);
  const eur = connId === 'erli' && stateId === 'erli-eur';

  const save = (): void => {
    showToast({ tone: 'success', title: 'Zapisano ustawienia', description: `${conn.name}: gratis ${GIFT_FORM_LABEL[gift]}, zestaw ${bundle === 'one-line' ? 'jako jedna pozycja' : 'jako składniki'}.` });
    setOpen(false);
  };

  return (
    <PageLayout title="Ustawienia połączeń" description="Jak gratisy i zestawy wyglądają na dokumentach sprzedaży. Domyślne ustawienia działają od razu, nic nie musisz wybierać.">
      <div className="cfg-stack">
        {seed.readOnly ? (
          <Alert tone="info" density="compact" title="Tylko do odczytu">
            Widzisz ustawienia i podgląd, ale ich nie zmienisz. Poproś administratora o zmianę.
          </Alert>
        ) : null}
        <FormField label="Połączenie" name="connection">
          <Select value={connId} onChange={(e) => setConnId(e.target.value as ConnId)}>
            {(Object.keys(CONNS) as ConnId[]).map((c) => (
              <option key={c} value={c}>
                {CONNS[c].name}
              </option>
            ))}
          </Select>
        </FormField>

        {eur ? (
          <Alert tone="warning" title="Zamówienia w EUR z niemieckim VAT czekają: brak trasy dokumentu">
            Zamówienie {EUR_ORDER.number} z Erli ma stawki 7% i 19%. Żaden dostawca dokumentów w tym połączeniu nie wystawia dokumentu w EUR z niemieckim VAT, więc OpenLinker nic nie wysyła i oznacza zamówienie do przejrzenia. Docelowo integracja wystawi automatycznie fakturę OSS, tak jak robi to Shoper.
          </Alert>
        ) : null}

        <div className="cfg-split cfg-split--aside v1-settings-split">
          <div className="cfg-stack">
            <DetailSection
              title="Dokumenty sprzedaży"
              titleAside={
                <Button tone="secondary" disabled={!canWrite} title={reason} onClick={() => setOpen((o) => !o)}>
                  {open ? 'Zamknij' : 'Zmień (dla księgowej)'}
                </Button>
              }
            >
              <div className="cfg-stack">
                <KeyValueList
                  items={[
                    { id: 'gift', label: 'Gratis na dokumencie', value: GIFT_FORM_LABEL[gift] },
                    { id: 'bundle', label: 'Zestaw na dokumencie', value: bundle === 'one-line' ? 'jedna pozycja' : 'składniki osobno' },
                    { id: 'provider', label: 'Wystawia', value: DOC_PROVIDERS[provider].name },
                  ]}
                />
                {auto === 'other-rate' ? (
                  <p className="v1-auto">Ten gratis ma inną stawkę VAT niż zapłacone pozycje, więc integracja wlicza go w zapłaconą kwotę. Inaczej podatek przesunąłby się między stawkami.</p>
                ) : null}
                {auto === 'grosz' ? (
                  <p className="v1-auto">{DOC_PROVIDERS[provider].name} nie przyjmuje pozycji za 0,00 zł (eparagony odrzuca ją kodem 41), więc integracja pokazuje gratis za 0,01 zł zdjęte z płatnej pozycji w tej samej stawce. Suma się nie zmienia.</p>
                ) : null}

                {open ? (
                  <div className="cfg-stack">
                    <ul className="cfg-options" role="radiogroup" aria-label="Gratis na dokumencie">
                      {(Object.keys(GIFT_FORM_LABEL) as GiftForm[]).map((f) => (
                        <li key={f} className={`cfg-option${gift === f ? ' cfg-option--active' : ''}`}>
                          <span className="cfg-option__head">
                            <FilterCheck type="radio" name="gift-form" label={`Gratis ${GIFT_FORM_LABEL[f]}`} checked={gift === f} disabled={!canWrite} title={reason} onChange={() => setGift(f)} />
                            {f === 'omit' ? <StatusBadge tone="neutral" compact>Domyślnie</StatusBadge> : null}
                          </span>
                          <p className="cfg-option__desc">{GIFT_FORM_DESC[f]}</p>
                        </li>
                      ))}
                      <li className="cfg-option cfg-option--disabled">
                        <span className="cfg-option__head">
                          <FilterCheck type="radio" name="gift-form" label="Cena katalogowa i rabat 100%" disabled checked={false} onChange={() => undefined} />
                          <StatusBadge tone="error" compact>Niedostępne</StatusBadge>
                        </span>
                        <p className="cfg-option__desc">Interpretacja KIS z 2026 r. uznała taki zapis za nieodpłatne przekazanie, a nie rabat.</p>
                      </li>
                    </ul>
                    <FormField label="Zestaw na dokumencie" name="bundle-form">
                      <SegmentedControl
                        className="cfg-seg"
                        aria-label="Zestaw na dokumencie"
                        options={[
                          { value: 'one-line', label: 'Jedna pozycja', disabled: !canWrite },
                          { value: 'components', label: 'Składniki osobno', disabled: !canWrite },
                        ]}
                        value={bundle}
                        onChange={(v) => setBundle(v as BundleForm)}
                      />
                    </FormField>
                    <p className="cfg-muted">Forma gratisu to decyzja podatkowa. Skonsultuj ją z księgową albo doradcą podatkowym.</p>
                    <span className="cfg-row">
                      <Button disabled={!canWrite} title={reason} onClick={save}>
                        Zapisz ustawienia
                      </Button>
                    </span>
                  </div>
                ) : null}

                {splitMissing ? (
                  <Alert
                    tone="warning"
                    density="compact"
                    title="Dokument czeka: brak ceny składnika"
                    action={
                      <Button tone="secondary" disabled={!canWrite} title={reason} onClick={() => showToast({ tone: 'success', title: 'Zapisano koszt', description: 'Miarka do kawy: koszt zakupu 6,00 zł. Wstrzymane dokumenty wyjdą same.' })}>
                        Uzupełnij koszt składnika
                      </Button>
                    }
                  >
                    Miarka do kawy nie jest sprzedawana osobno i nie ma kosztu zakupu, więc nie da się podzielić ceny zestawu na składniki. OpenLinker nie zgaduje podziału.
                  </Alert>
                ) : null}
              </div>
            </DetailSection>

            {connId === 'shoper' ? (
              <DetailSection title="Jak kanał wysyła zestawy">
                <div className="cfg-stack">
                  <p className="cfg-secondary">Integracja Shopera nie mówi, czy wysyła składniki zestawu jako osobne pozycje. Dopóki tego nie potwierdzisz, OpenLinker zakłada, że wysyła, żeby stan nie zszedł dwa razy.</p>
                  <FormField label="Twój sklep" name="bundle-shape">
                    <Select value={shape} disabled={!canWrite} title={reason} onChange={(e) => setShape(e.target.value as typeof shape)}>
                      <option value="unknown">Nie wiem (bezpiecznie: jak składniki)</option>
                      <option value="parent-only">Wysyła tylko pozycję zestawu</option>
                      <option value="children">Wysyła składniki jako osobne pozycje</option>
                    </Select>
                  </FormField>
                </div>
              </DetailSection>
            ) : null}

            {stateId === 'automatic' ? (
              <DetailSection title="Co integracja robi sama">
                <div className="cfg-stack">
                  <p className="cfg-secondary">Tych rzeczy nie ustawiasz. Wybierz przykład, żeby zobaczyć dokument.</p>
                  <SegmentedControl
                    className="cfg-seg"
                    aria-label="Przykład"
                    options={[
                      { value: 'discount', label: 'Rabat na zamówienie' },
                      { value: 'rounding', label: 'Grosz z zaokrąglenia' },
                      { value: 'wrap', label: 'Pakowanie na prezent' },
                    ]}
                    value={example}
                    onChange={(v) => setExample(v as AutoExample)}
                  />
                  <p className="v1-auto">
                    {example === 'discount'
                      ? 'Kod rabatowy na całe zamówienie integracja rozkłada na pozycje proporcjonalnie do ich wartości, dokładnie do grosza. Gratis nie dostaje rabatu.'
                      : example === 'rounding'
                        ? 'Gdy kanał poda sumę o grosz inną niż suma pozycji, grosz trafia na największą płatną pozycję, nigdy na gratis.'
                        : 'Płatne pakowanie na prezent to pozycja usługi w swojej stawce, bez stanu magazynowego.'}
                  </p>
                </div>
              </DetailSection>
            ) : null}
          </div>

          {eur ? null : (
            <Preview
              doc={stateId === 'automatic' ? (example === 'discount' ? allocateDiscount().doc : example === 'rounding' ? roundingAfter() : composeDoc({ scenario: 'gift-wrap', treatment: 'omit', bundleMode: 'one-line', provider })) : doc}
              provider={provider}
              paid={stateId === 'automatic' ? 0 : scenario.paid}
            />
          )}
        </div>
      </div>
    </PageLayout>
  );
}

const STATES: StateDef[] = [
  { id: 'default', label: 'Domyślnie', note: 'Dwie linijki: gratis pomijany, zestaw jedną pozycją, obok podgląd paragonu. Nic nie trzeba wybierać, dokumenty wychodzą od razu. Pod spodem: integracja eparagony dostaje pozycje z oznaczeniem, co jest gratisem i zestawem, i sama buduje paragon. Decyzja: Shoper i Apilo nie pytają o nic, IdoSell i BaseLinker o jeden przełącznik.', useCases: ['G-10', 'X-03', 'B-14'], priority: 'pilot', channels: ['allegro'] },
  { id: 'gift-other-rate', label: 'Gratis w innej stawce', note: 'Kubek gratis (23%) do kawy (5%). Pominięcie przesunęłoby podatek, więc integracja sama wlicza gratis w zapłaconą kwotę. Jedna linijka mówi, co się stało. Decyzja: zamiast wstrzymania automat, jak w Sellasist i Apilo.', useCases: ['G-10', 'G-18'], priority: 'pilot', channels: ['allegro'] },
  { id: 'show-gift-receipt', label: 'Gratis na paragonie (0,01 zł)', note: 'Księgowa chce widzieć gratis na paragonie. eparagony nie przyjmuje zera (kod 41), więc integracja zdejmuje 0,01 zł z płatnej pozycji w tej samej stawce. Suma = zapłata. Pod spodem: to robi integracja, OpenLinker tylko oznacza pozycję jako gratis.', useCases: ['G-10', 'G-18', 'D-02'], priority: 'pilot', channels: ['allegro'] },
  { id: 'show-gift-ksef', label: 'Gratis na fakturze KSeF', note: 'KSeF przyjmuje pozycję za 0,00 zł, więc gratis jest zwykłą pozycją bez grosza. Opusty z rabatów idą do P_10. Pod spodem: integracja KSeF sama decyduje, jak zapisać gratis.', useCases: ['D-04', 'G-10'], priority: 'pilot', channels: ['woocommerce'] },
  { id: 'internal-record', label: 'Ewidencja wewnętrzna', note: 'Gratis nie trafia na paragon. OpenLinker zapisuje nieodpłatne przekazanie z kosztem zakupu, a roczny eksport per klient trafia do księgowej.', useCases: ['G-19', 'D-07'], priority: 'later', channels: ['allegro'] },
  { id: 'bundle-components', label: 'Zestaw jako składniki', note: 'Cena zestawu dzielona proporcjonalnie do cen składników, reszta w groszach na największy udział, każdy składnik w swojej stawce. Ustawienie po pilocie, schowane pod "Zmień".', useCases: ['B-14', 'R-05', 'B-19', 'D-04'], priority: 'later', channels: ['prestashop'] },
  { id: 'bundle-split-missing', label: 'Brak ceny składnika', note: 'Składnik nie jest sprzedawany osobno i nie ma kosztu. To jedyne wstrzymanie, które zostało: OpenLinker nie zgaduje podziału. Jeden przycisk prowadzi do uzupełnienia kosztu.', useCases: ['B-14'], priority: 'later', channels: ['prestashop'] },
  { id: 'automatic', label: 'Co integracja robi sama', note: 'Rabat na całe zamówienie, grosz z zaokrąglenia i płatne pakowanie na prezent dzieją się same, bez ustawień i bez wstrzymań. Decyzja: wszyscy rozkładają rabat sami (BaseLinker, Apilo, Sellasist, Shopify).', useCases: ['D-01', 'D-03', 'D-05', 'G-17'], priority: 'pilot', channels: ['allegro'] },
  { id: 'shoper-unknown', label: 'Shoper: nieznany kształt zestawu', note: 'Jedyne połączenie, które pokazuje "Jak kanał wysyła zestawy", bo integracja Shopera tego nie deklaruje. Inne połączenia nie mają tej sekcji.', useCases: ['B-05', 'B-19', 'X-03', 'B-27'], priority: 'pilot', channels: ['shoper'] },
  { id: 'erli-eur', label: 'Erli: EUR i niemiecki VAT', note: 'Brak trasy dokumentu dla EUR z niemieckim VAT: zamówienie czeka do przejrzenia. Docelowo integracja wystawi fakturę OSS, jak Shoper.', useCases: ['X-08'], priority: 'later', channels: ['erli'] },
  { id: 'viewer-readonly', label: 'Tylko do odczytu', note: 'Widać ustawienia i podgląd, przyciski są wyłączone z powodem.', useCases: ['X-03'], priority: 'pilot' },
  ...commonStates('ustawień połączeń', 'dodaj połączenie'),
];

export const screen: ScreenDef = {
  id: 'settings',
  group: 'Ustawienia',
  label: 'Ustawienia połączeń',
  states: STATES,
  render: (state) => <SettingsV1 key={state} stateId={state} />,
};
