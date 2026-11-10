/**
 * Edytor zestawu (catalogue): guided wizard to define a bundle over a master
 * variant. Steps: variant, components (with a gift slot), price split,
 * availability, channels. A live summary rail and the version history.
 */
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { WizardLayout } from '@web/shared/ui/wizard-layout';
import { SetupStepper } from '@web/shared/ui/setup-stepper';
import { WizardSummaryRow } from '@web/shared/ui/wizard-summary-row';
import { Button } from '@web/shared/ui/button';
import { Alert } from '@web/shared/ui/alert';
import { Select } from '@web/shared/ui/select';
import { Input } from '@web/shared/ui/input';
import { Textarea } from '@web/shared/ui/textarea';
import { FormField } from '@web/shared/ui/form-field';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { KeyValueList } from '@web/shared/ui/key-value-list';
import { DetailSection } from '@web/shared/ui/detail-section';
import { ProductThumbnail } from '@web/shared/ui/product-thumbnail';
import { useToast } from '@web/shared/ui/toast-provider';
import { BUNDLES, CHANNELS, VARIANTS, type BundleComponent, type ChannelId } from '../model/catalog';
import { bundleAtp, mixedVat, splitBundlePrice, vatOfGross } from '../model/calc';
import { commonStates, useMoney, useProto, useWriteGuard, type ScreenDef } from '../proto';
import { BundleMark, GiftMark, StockPathTrail, Switch } from '../ui/marks';
import { ALL_BUNDLES, SUBIEKT_KIT, shortName, splitWithPrices, usedIn } from './cfg-data';
import './cfg.css';

const STEPS = ['Wariant zestawu', 'Składniki', 'Podział ceny', 'Dostępność', 'Kanały'] as const;

type Scenario =
  | 'step-variant'
  | 'step-components'
  | 'step-components-nested'
  | 'step-split'
  | 'step-split-over-standalone'
  | 'step-split-sum-mismatch'
  | 'step-split-missing-price'
  | 'step-split-mixed-vat'
  | 'step-split-changed'
  | 'step-availability'
  | 'step-channels'
  | 'step-channels-children-refused'
  | 'step-channels-gpsr'
  | 'step-channels-result'
  | 'versions';

const STEP_OF: Record<Scenario, number> = {
  'step-variant': 0,
  'step-components': 1,
  'step-components-nested': 1,
  'step-split': 2,
  'step-split-over-standalone': 2,
  'step-split-sum-mismatch': 2,
  'step-split-missing-price': 2,
  'step-split-mixed-vat': 2,
  'step-split-changed': 2,
  'step-availability': 3,
  'step-channels': 4,
  'step-channels-children-refused': 4,
  'step-channels-gpsr': 4,
  'step-channels-result': 4,
  versions: 1,
};

const EDITOR_CHANNELS: ChannelId[] = ['allegro', 'prestashop', 'woocommerce', 'shoper', 'erli'];
const SELLER = 'Kawowy Świat sp. z o.o. (kompletuje zestaw)';

const toInput = (g: number): string => (g / 100).toFixed(2).replace('.', ',');
function parseMoney(s: string): number | null {
  const t = s.trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

interface Draft {
  bundleKey: string;
  comps: BundleComponent[];
  overrides: Record<string, string>;
  reason: string;
  channels: Record<ChannelId, boolean>;
  producer: string;
  published: boolean;
  addError: string | null;
}

function initialDraft(s: Scenario): Draft {
  const missing = s === 'step-split-missing-price';
  const base: Draft = {
    bundleKey: missing ? 'grind' : 'morning',
    comps: (missing ? SUBIEKT_KIT.versions[0].components : BUNDLES.morning.versions[1].components).map((c) => ({ ...c })),
    overrides: {},
    reason: '',
    channels: { allegro: true, prestashop: true, woocommerce: false, shoper: false, erli: true, idosell: false, empik: false },
    producer: SELLER,
    published: s === 'step-channels-result',
    addError: null,
  };
  if (s === 'step-components-nested') base.addError = 'brew';
  if (s === 'step-split-over-standalone') {
    base.overrides = { mug: '28,99', coffee: '36,00' };
    base.reason = 'Kawa jest główną wartością zestawu.';
  }
  if (s === 'step-split-sum-mismatch') {
    base.overrides = { mug: '30,00', coffee: '30,00' };
    base.reason = 'Równy podział na prośbę księgowości.';
  }
  if (s === 'step-channels-children-refused') base.channels = { ...base.channels, woocommerce: true, shoper: true };
  if (s === 'step-channels-gpsr') base.producer = '';
  return base;
}

function bundleOf(key: string) {
  return ALL_BUNDLES.find((b) => b.key === key) ?? ALL_BUNDLES[0];
}

/* ── Validation ─────────────────────────────────────────────────────── */

interface SplitRow {
  variant: string;
  qty: number;
  gift: boolean;
  standalone: number | null;
  proposed: number;
  effective: number | null;
  overridden: boolean;
  vat: number;
  errors: string[];
}

function computeSplit(d: Draft, scenario: Scenario): { rows: SplitRow[]; sum: number; price: number; errors: string[]; missing: string[] } {
  const price = bundleOf(d.bundleKey).bundle.price;
  const priceOf = (k: string): number | null => {
    if (scenario === 'step-split-missing-price' && k === 'grinder') return null;
    if (scenario === 'step-split-changed' && k === 'mug') return 4499;
    return VARIANTS[k].price;
  };
  const split0 = splitWithPrices(price, d.comps, priceOf);
  const missing = split0.missing;
  let lines = split0.lines;
  const parsedOf = (k: string): number | null => {
    const raw = d.overrides[k];
    return raw !== undefined && raw.trim() !== '' ? parseMoney(raw) : null;
  };
  // With every missing price typed in by hand, split the rest over the priced components.
  if (missing.length && missing.every((m) => parsedOf(m) !== null)) {
    const fixed = missing.reduce((a, m) => a + (parsedOf(m) ?? 0), 0);
    const rest = splitWithPrices(Math.max(0, price - fixed), d.comps.filter((c) => !missing.includes(c.variant)), priceOf).lines;
    lines = lines.map((l) => (missing.includes(l.variant) ? l : { ...l, share: rest.find((r) => r.variant === l.variant)?.share ?? 0 }));
  }
  const rows: SplitRow[] = lines.map((l) => {
    const raw = d.overrides[l.variant];
    const parsed = raw !== undefined && raw.trim() !== '' ? parseMoney(raw) : null;
    const overridden = parsed !== null && !l.gift;
    const effective = l.gift ? 0 : overridden ? parsed : l.standalone === null ? null : l.share;
    const errors: string[] = [];
    if (!l.gift && l.standalone === null && !overridden) errors.push('Brak ceny osobno. Wpisz udział ręcznie albo uzupełnij cenę w masterze.');
    if (effective !== null && l.standalone !== null && effective > l.standalone) errors.push(`Udział wyższy niż cena osobno (${toInput(l.standalone)} zł).`);
    if (raw !== undefined && raw.trim() !== '' && parsed === null) errors.push('Wpisz kwotę, np. 36,00.');
    return { variant: l.variant, qty: l.qty, gift: l.gift, standalone: l.standalone, proposed: l.share, effective, overridden, vat: l.vat, errors };
  });
  const sum = rows.reduce((a, r) => a + (r.effective ?? 0), 0);
  const errors: string[] = [];
  if (missing.length && rows.some((r) => r.effective === null)) errors.push(`Brak ceny osobno dla: ${missing.map(shortName).join(', ')}. Podział proporcjonalny nie jest możliwy.`);
  if (rows.some((r) => r.errors.some((e) => e.startsWith('Udział wyższy')))) errors.push('Udział składnika nie może być wyższy niż jego cena osobno.');
  if (!rows.some((r) => r.effective === null) && sum !== price) errors.push(`Suma udziałów ${toInput(sum)} zł różni się od ceny zestawu ${toInput(price)} zł o ${toInput(Math.abs(price - sum))} zł.`);
  if (rows.some((r) => r.overridden) && !d.reason.trim()) errors.push('Podaj powód nadpisania podziału.');
  return { rows, sum, price, errors, missing };
}

function componentErrors(d: Draft): string[] {
  const out: string[] = [];
  if (!d.comps.some((c) => !c.gift)) out.push('Zestaw musi mieć co najmniej jeden płatny składnik.');
  if (d.comps.some((c) => !Number.isInteger(c.qty) || c.qty < 1)) out.push('Ilość składnika musi być liczbą całkowitą od 1.');
  return out;
}

function variantErrors(d: Draft): string[] {
  if (d.bundleKey === 'mug') return ['Kubek ceramiczny jest składnikiem 2 zestawów, więc nie może sam mieć składu. Zestaw w zestawie nie jest obsługiwany.'];
  return [];
}

/* ── Steps ──────────────────────────────────────────────────────────── */

function StepVariant({ d, set, ro }: { d: Draft; set: (p: Partial<Draft>) => void; ro: boolean }): ReactElement {
  const money = useMoney();
  const errs = variantErrors(d);
  const chosen = d.bundleKey === 'mug' ? null : bundleOf(d.bundleKey);
  return (
    <>
      <Alert tone="info" title="Skład trzymasz w OpenLinkerze">
        Wariant zestawu przychodzi z mastera (PrestaShop albo Subiekt GT) i tam ma nazwę, cenę i zdjęcie. Tutaj określasz, z czego się składa. Na tej podstawie OpenLinker liczy dostępność, rezerwuje i pakuje każdy składnik.
      </Alert>
      <FormField label="Wariant zestawu" name="bundle-variant" description="Wybierz wariant z mastera, który ma być zestawem.">
        <Select value={d.bundleKey} disabled={ro} onChange={(e) => set({ bundleKey: e.target.value })}>
          {ALL_BUNDLES.map(({ key, bundle }) => (
            <option key={key} value={key}>
              {bundle.name} ({bundle.sku})
            </option>
          ))}
          <option value="mug">Kubek ceramiczny 350 ml (KUB-350-BI)</option>
        </Select>
      </FormField>
      {errs.map((e) => (
        <Alert key={e} tone="error" density="compact" title="Nie można zapisać składu">
          {e}
        </Alert>
      ))}
      {chosen ? (
        <div className="cfg-ident">
          <ProductThumbnail src={chosen.bundle.image} name={chosen.bundle.name} />
          <KeyValueList
            items={[
              { id: 'sku', label: 'SKU', value: chosen.bundle.sku, mono: true },
              { id: 'ean', label: 'EAN', value: 'brak (zestaw sprzedawcy zwykle nie ma GTIN)' },
              { id: 'master', label: 'Master', value: chosen.master === 'subiekt' ? 'Subiekt GT' : 'PrestaShop (kawowyswiat.pl)' },
              { id: 'price', label: 'Cena brutto', value: <span className="tabular">{money(chosen.bundle.price, 'PLN')}</span> },
            ]}
          />
        </div>
      ) : null}
      {d.bundleKey === 'brew' ? (
        <Alert tone="warning" density="compact" title="Ten produkt jest w PrestaShop pakiem z własnym stanem">
          PrestaShop liczy stan paka osobno. Jeśli zapiszesz skład tutaj, OpenLinker zdejmie stan składników, a PrestaShop nie zmniejszy paka. Ustaw w PrestaShop stan paka liczony z produktów.
        </Alert>
      ) : null}
    </>
  );
}

function StepComponents({ d, set, ro, reason }: { d: Draft; set: (p: Partial<Draft>) => void; ro: boolean; reason?: string }): ReactElement {
  const [pick, setPick] = useState('tea');
  const [qty, setQty] = useState('1');
  const errs = componentErrors(d);
  const update = (i: number, patch: Partial<BundleComponent>): void => set({ comps: d.comps.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const add = (): void => {
    if (pick.startsWith('bundle:')) {
      set({ addError: pick.slice(7) });
      return;
    }
    const n = Number(qty);
    const existing = d.comps.findIndex((c) => c.variant === pick);
    if (existing >= 0) update(existing, { qty: d.comps[existing].qty + (Number.isFinite(n) ? n : 1) });
    else set({ comps: [...d.comps, { variant: pick, qty: Number.isFinite(n) && n > 0 ? Math.floor(n) : 1 }], addError: null });
  };
  const addErrorBundle = d.addError ? ALL_BUNDLES.find((b) => b.key === d.addError) : null;
  return (
    <>
      <p className="cfg-secondary">
        Każdy składnik to wariant z mastera i ilość na jeden zestaw. Składnik oznaczony jako gratis ma w podziale ceny 0 zł, ale rezerwuje się, pakuje i schodzi ze stanu jak każdy inny.
      </p>
      <div>
        {d.comps.map((c, i) => {
          const v = VARIANTS[c.variant];
          return (
            <div key={c.variant} className="cfg-comp-row">
              <span className="cfg-ident">
                <ProductThumbnail src={v.image} name={v.name} size="sm" />
                <span className="cfg-ident__text">
                  <span className="cfg-ident__name">{v.name}</span>
                  <span className="cfg-ident__meta">
                    <span className="mono-text">{v.sku}</span>
                    {c.gift ? <GiftMark compact /> : null}
                    {usedIn(c.variant).filter((u) => u.key !== d.bundleKey).length ? (
                      <span>także w: {usedIn(c.variant).filter((u) => u.key !== d.bundleKey).map((u) => u.bundle.name).join(', ')}</span>
                    ) : null}
                  </span>
                </span>
              </span>
              <Input type="number" min={1} step={1} value={c.qty} aria-label={`Ilość: ${v.name}`} disabled={ro} invalid={!Number.isInteger(c.qty) || c.qty < 1} onChange={(e) => update(i, { qty: Number(e.target.value) })} />
              <Switch checked={c.gift === true} onChange={(g) => update(i, { gift: g })} label="Gratis" disabled={ro} hint={reason ?? 'Gratis w zestawie ma udział 0 zł'} />
              <Button tone="ghost" disabled={ro} title={reason} onClick={() => set({ comps: d.comps.filter((_, j) => j !== i) })}>
                Usuń
              </Button>
            </div>
          );
        })}
      </div>
      <div className="cfg-add">
        <FormField label="Dodaj składnik" name="add-component">
          <Select value={pick} disabled={ro} onChange={(e) => setPick(e.target.value)}>
            <optgroup label="Warianty">
              {Object.entries(VARIANTS).filter(([k]) => !d.comps.some((c) => c.variant === k)).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Zestawy">
              {ALL_BUNDLES.filter((b) => b.key !== d.bundleKey).map((b) => (
                <option key={b.key} value={`bundle:${b.key}`}>
                  {b.bundle.name} (zestaw)
                </option>
              ))}
            </optgroup>
          </Select>
        </FormField>
        <span className="cfg-row">
          <Input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Ilość nowego składnika" disabled={ro} style={{ width: 72 }} />
          <Button tone="secondary" disabled={ro} title={reason} onClick={add}>
            Dodaj składnik
          </Button>
        </span>
      </div>
      {addErrorBundle ? (
        <Alert tone="error" density="compact" title={`Nie można dodać: ${addErrorBundle.bundle.name} jest zestawem`}>
          Zestaw nie może być składnikiem innego zestawu. Działa to w obie strony: wariant, który jest składnikiem jakiegoś zestawu, nie może sam dostać składu. Dodaj składniki tamtego zestawu osobno.
        </Alert>
      ) : null}
      {errs.map((e) => (
        <Alert key={e} tone="error" density="compact">
          {e}
        </Alert>
      ))}
    </>
  );
}

function StepSplit({ d, set, ro, scenario }: { d: Draft; set: (p: Partial<Draft>) => void; ro: boolean; scenario: Scenario }): ReactElement {
  const money = useMoney();
  const split = computeSplit(d, scenario);
  const mixed = mixedVat(d.comps);
  const before = scenario === 'step-split-changed' ? splitBundlePrice(split.price, d.comps) : null;
  const anyOverride = split.rows.some((r) => r.overridden);
  const perRate = new Map<number, number>();
  for (const r of split.rows) if (!r.gift && r.effective !== null) perRate.set(r.vat, (perRate.get(r.vat) ?? 0) + r.effective);
  return (
    <>
      <p className="cfg-secondary">
        OpenLinker dzieli cenę zestawu ({money(split.price, 'PLN')}) proporcjonalnie do cen składników kupowanych osobno, co do grosza. Podział przyda się przy zwrocie części zestawu i przy rozbiciu na dokumencie. Możesz go nadpisać, podając powód.
      </p>
      {before ? (
        <Alert tone="info" title="Podgląd podziału się zmienił">
          Cena kubka w PrestaShop zmieniła się z 39,99 zł na 44,99 zł. Proponowany podział przeliczył się dla nowej wersji. Zamówienia już przyjęte zachowują podział z dnia zamówienia.
        </Alert>
      ) : null}
      {mixed ? (
        <Alert tone="warning" density="compact" title="Składniki mają różne stawki VAT">
          Kubek ma 23%, a kawa 5%. W pilocie dokument sprzedaży zachowuje jedną pozycję zestawu z jedną stawką, tak jak sprzedał ją kanał. Rozbicie na składniki ze stawkami to opcja na później. Skonsultuj stawkę zestawu z doradcą podatkowym.
        </Alert>
      ) : null}
      <div className="cfg-scroll">
        <table className="cfg-table">
          <caption className="sr-only">Podział ceny zestawu na składniki</caption>
          <thead>
            <tr>
              <th scope="col">Składnik</th>
              <th scope="col" className="cfg-right">Cena osobno</th>
              {before ? <th scope="col" className="cfg-right">Udział przed zmianą</th> : null}
              <th scope="col" className="cfg-right">Udział proponowany</th>
              <th scope="col">Nadpisz</th>
            </tr>
          </thead>
          <tbody>
            {split.rows.map((r) => (
              <tr key={r.variant} className={r.errors.length ? 'cfg-row--error' : undefined}>
                <th scope="row">
                  <span className="cfg-stack cfg-stack--tight">
                    <span>
                      {r.qty} x {shortName(r.variant)} {r.gift ? <GiftMark compact /> : null}
                    </span>
                    <span className="cfg-muted">VAT {r.vat}%</span>
                    {r.errors.map((e) => (
                      <span key={e} className="cfg-comps__flag cfg-comps__flag--error" style={{ whiteSpace: 'normal' }}>
                        {e}
                      </span>
                    ))}
                  </span>
                </th>
                <td className="cfg-right tabular">{r.standalone === null ? 'brak' : money(r.standalone, 'PLN')}</td>
                {before ? <td className="cfg-right tabular">{money(before.find((b) => b.variant === r.variant)?.share ?? 0, 'PLN')}</td> : null}
                <td className="cfg-right tabular">{r.gift ? '0,00 zł' : r.standalone === null ? '-' : money(r.proposed, 'PLN')}</td>
                <td>
                  {r.gift ? (
                    <span className="cfg-muted">gratis</span>
                  ) : (
                    <Input
                      inputMode="decimal"
                      value={d.overrides[r.variant] ?? ''}
                      placeholder={r.standalone === null ? 'wpisz' : toInput(r.proposed)}
                      aria-label={`Udział: ${shortName(r.variant)}`}
                      invalid={r.errors.length > 0}
                      disabled={ro}
                      style={{ width: 96 }}
                      onChange={(e) => set({ overrides: { ...d.overrides, [r.variant]: e.target.value } })}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Suma</th>
              <td className="cfg-right tabular">{money(split.rows.reduce((a, r) => a + (r.gift ? 0 : r.standalone ?? 0), 0), 'PLN')}</td>
              {before ? <td /> : null}
              <td className="cfg-right tabular" colSpan={2}>
                {money(split.sum, 'PLN')} z {money(split.price, 'PLN')}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {scenario === 'step-split-mixed-vat' ? (
        <DetailSection title="Ile VAT wyszłoby przy rozbiciu">
          <ul className="cfg-list">
            {[...perRate.entries()].map(([rate, gross]) => (
              <li key={rate}>
                <span className="cfg-row cfg-row--between">
                  <span>Stawka {rate}%</span>
                  <span className="tabular">
                    brutto {money(gross, 'PLN')}, VAT {money(vatOfGross(gross, rate), 'PLN')}
                  </span>
                </span>
              </li>
            ))}
            <li>
              <span className="cfg-row cfg-row--between">
                <span>Jedna pozycja zestawu, stawka 23% (pilot)</span>
                <span className="tabular">VAT {money(vatOfGross(split.price, 23), 'PLN')}</span>
              </span>
            </li>
          </ul>
          <p className="cfg-muted">To tylko porównanie. Która forma jest właściwa, ustala sprzedawca z doradcą podatkowym.</p>
        </DetailSection>
      ) : null}
      {anyOverride || split.missing.length ? (
        <FormField label="Powód nadpisania" name="override-reason" description="Zapisujemy go w historii wersji zestawu." error={anyOverride && !d.reason.trim() ? 'Podaj powód nadpisania.' : undefined}>
          <Textarea value={d.reason} disabled={ro} rows={2} onChange={(e) => set({ reason: e.target.value })} />
        </FormField>
      ) : null}
      {anyOverride ? (
        <div className="cfg-actions cfg-actions--start">
          <Button tone="ghost" disabled={ro} onClick={() => set({ overrides: {}, reason: '' })}>
            Przywróć podział proporcjonalny
          </Button>
        </div>
      ) : null}
      {split.errors.map((e) => (
        <Alert key={e} tone="error" density="compact">
          {e}
        </Alert>
      ))}
    </>
  );
}

function StepAvailability({ d }: { d: Draft }): ReactElement {
  const { oms } = useProto();
  const res = bundleAtp(d.comps);
  const master = bundleOf(d.bundleKey).master === 'subiekt' ? 'Subiekt GT' : 'PrestaShop';
  return (
    <>
      <p className="cfg-secondary">
        Dostępność zestawu to najmniejsza liczba pełnych kompletów, które dają składniki po odjęciu rezerwacji. Tę liczbę OpenLinker wysyła do kanałów.
      </p>
      <div className="cfg-scroll">
        <table className="cfg-table">
          <caption className="sr-only">Dostępność składników</caption>
          <thead>
            <tr>
              <th scope="col">Składnik</th>
              <th scope="col" className="cfg-right">Stan</th>
              <th scope="col" className="cfg-right">Zarezerwowane</th>
              <th scope="col" className="cfg-right">Dostępne</th>
              <th scope="col" className="cfg-right">Na zestaw</th>
              <th scope="col" className="cfg-right">Starczy na</th>
            </tr>
          </thead>
          <tbody>
            {res.perComponent.map((p) => {
              const v = VARIANTS[p.variant];
              const lim = p.variant === res.limiting;
              return (
                <tr key={p.variant} className={lim ? 'cfg-row--limit' : undefined}>
                  <th scope="row">
                    {shortName(p.variant)} {lim ? <StatusBadge tone="neutral" compact>Ogranicza</StatusBadge> : null}
                  </th>
                  <td className="cfg-right tabular">{v.stock}</td>
                  <td className="cfg-right tabular">{v.held}</td>
                  <td className="cfg-right tabular">{p.available}</td>
                  <td className="cfg-right tabular">{p.qty}</td>
                  <td className={`cfg-right tabular${lim ? ' cfg-strong' : ''}`}>{p.sets}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Alert tone={res.atp !== null && res.atp <= 2 ? 'warning' : 'info'} density="compact" title={res.atp === null ? 'Dostępność nieznana' : `Dostępne: ${res.atp} zestawów`}>
        {res.limiting ? `Ogranicza ${shortName(res.limiting)}. Dokup ten składnik albo zmniejsz jego ilość w zestawie, żeby sprzedać więcej.` : 'Żaden składnik nie ogranicza.'}
      </Alert>
      <div>
        <p className="cfg-muted">Po sprzedaży ({oms ? 'OMS włączony' : 'OMS wyłączony'})</p>
        <StockPathTrail
          steps={
            oms
              ? [
                  { label: 'Zarezerwowano', state: 'done', detail: 'każdy składnik osobno' },
                  { label: 'Spakowano', state: 'active', detail: 'skan każdego składnika' },
                  { label: `Zdjęto ze stanu w ${master}`, state: 'todo' },
                ]
              : [
                  { label: `Wysłano do ${master} jako pozycja zestawu`, state: 'done' },
                  { label: 'Sklep zdjął stan', state: 'todo', detail: 'według ustawień paka w sklepie' },
                ]
          }
        />
      </div>
    </>
  );
}

interface ChannelCheck {
  ok: boolean;
  tone: 'success' | 'error' | 'neutral' | 'warning';
  label: string;
  reason: string;
}

function checkChannel(id: ChannelId, d: Draft, on: boolean): ChannelCheck {
  const ch = CHANNELS[id];
  if (!on) return { ok: true, tone: 'neutral', label: 'Nie publikujesz', reason: 'Włącz, żeby wysłać zestaw do tego kanału.' };
  if (ch.emitsChildrenAsLines === true)
    return { ok: false, tone: 'error', label: 'Odrzucone na tym połączeniu', reason: `${ch.name} wysyła składniki zestawu jako osobne pozycje zamówienia. Z definicją w OpenLinkerze stan zszedłby dwa razy. Wyłącz zestaw w tym kanale albo usuń definicję.` };
  if (ch.emitsChildrenAsLines === null)
    return { ok: false, tone: 'error', label: 'Odrzucone do weryfikacji', reason: `Nie wiemy jeszcze, czy ${ch.name} wysyła składniki jako pozycje. Do czasu weryfikacji traktujemy go tak, jakby wysyłał, i nie publikujemy zestawów.` };
  if (id === 'allegro') {
    const producers = new Set(d.comps.map((c) => VARIANTS[c.variant].producer));
    if (producers.size > 1 && !d.producer)
      return { ok: false, tone: 'error', label: 'Brakuje producenta (GPSR)', reason: `Allegro wymaga jednego producenta odpowiedzialnego za produkt. Składniki mają ${producers.size} różnych producentów. Wskaż, kto odpowiada za zestaw.` };
    return { ok: true, tone: 'success', label: 'Gotowe', reason: 'Oferta zestawu jak zwykła oferta, ilość z dostępności zestawu.' };
  }
  if (id === 'prestashop') return { ok: true, tone: 'success', label: 'Gotowe', reason: 'Zestaw jest produktem w PrestaShop. OpenLinker wysyła tylko ilość.' };
  return { ok: true, tone: 'success', label: 'Gotowe', reason: `${ch.name} przysyła tylko SKU zestawu, bez składników.` };
}

function StepChannels({ d, set, ro, reason }: { d: Draft; set: (p: Partial<Draft>) => void; ro: boolean; reason?: string }): ReactElement {
  const { go } = useProto();
  const res = bundleAtp(d.comps);
  const producers = [...new Set(d.comps.map((c) => VARIANTS[c.variant].producer))];
  return (
    <>
      <p className="cfg-secondary">Wybierz kanały. OpenLinker sprawdza każdy kanał przed publikacją i mówi, czego brakuje.</p>
      <div className="cfg-scroll">
        <table className="cfg-table">
          <caption className="sr-only">Publikacja zestawu w kanałach</caption>
          <thead>
            <tr>
              <th scope="col">Kanał</th>
              <th scope="col">Publikuj</th>
              <th scope="col">Sprawdzenie</th>
            </tr>
          </thead>
          <tbody>
            {EDITOR_CHANNELS.map((id) => {
              const on = d.channels[id];
              const c = checkChannel(id, d, on);
              const result = d.published && on ? (c.ok ? `Opublikowano, ${res.atp ?? 0} szt.` : 'Pominięto') : null;
              return (
                <tr key={id} className={!c.ok ? 'cfg-row--error' : undefined}>
                  <th scope="row">{CHANNELS[id].name}</th>
                  <td>
                    <Switch checked={on} disabled={ro} hint={reason} onChange={(v) => set({ channels: { ...d.channels, [id]: v }, published: false })} label={<span className="spike-sr">Publikuj w {CHANNELS[id].name}</span>} />
                  </td>
                  <td>
                    <span className="cfg-stack cfg-stack--tight">
                      <span className="cfg-row">
                        <StatusBadge tone={c.tone} compact withDot>{c.label}</StatusBadge>
                        {result ? <StatusBadge tone={c.ok ? 'info' : 'neutral'} compact>{result}</StatusBadge> : null}
                      </span>
                      <span className="cfg-muted">{c.reason}</span>
                      {id === 'shoper' && on ? (
                        <button type="button" className="cfg-link cfg-muted" onClick={() => go('settings', 'shoper-unknown')}>
                          Ustaw, jak Shoper wysyła zestawy
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {producers.length > 1 && d.channels.allegro ? (
        <FormField label="Producent odpowiedzialny (GPSR)" name="gpsr-producer" description="Allegro przyjmuje jednego producenta na ofertę. Zestaw kompletowany przez Ciebie zwykle ma Ciebie jako odpowiedzialnego." error={!d.producer ? 'Wybierz producenta, żeby opublikować na Allegro.' : undefined}>
          <Select value={d.producer} disabled={ro} invalid={!d.producer} onChange={(e) => set({ producer: e.target.value, published: false })}>
            <option value="">Wybierz</option>
            <option value={SELLER}>{SELLER}</option>
            {producers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      {d.published ? (
        <Alert tone="success" title="Zapisano zestaw i opublikowano">
          Wersja v3 Zestawu porannego jest zapisana. Nowe zamówienia dostaną ten skład, a 3 otwarte zamówienia zostają na v1 i 12 na v2.
        </Alert>
      ) : null}
    </>
  );
}

/* ── Version history and summary ─────────────────────────────────────── */

const VERSION_ROWS = [
  { v: 'v3', when: 'szkic, niezapisany', comps: 'kubek, kawa, łyżeczka (gratis)', orders: 'nowe zamówienia po zapisie', tone: 'neutral' as const },
  { v: 'v2', when: 'zapisana 2 lis 2026', comps: 'kubek, kawa, łyżeczka (gratis)', orders: '12 otwartych zamówień', tone: 'success' as const },
  { v: 'v1', when: 'zapisana 2 paź 2026', comps: 'kubek, kawa', orders: '3 otwarte zamówienia trzymają v1', tone: 'warning' as const },
];

function VersionRail(): ReactElement {
  return (
    <section className="wizard-summary__section">
      <h3 className="wizard-summary__section-title">Historia wersji</h3>
      <dl className="wizard-summary__rows">
        {VERSION_ROWS.map((r) => (
          <WizardSummaryRow key={r.v} label={`${r.v}, ${r.when}`} value={r.orders} />
        ))}
      </dl>
    </section>
  );
}

function VersionHistory({ full }: { full: boolean }): ReactElement {
  const money = useMoney();
  const b = BUNDLES.morning;
  const rows = VERSION_ROWS;
  return (
    <DetailSection title="Historia wersji" titleAside={<span className="cfg-muted tabular">{money(b.price, 'PLN')}</span>}>
      {full ? (
        <Alert tone="info" density="compact" title="v2 zapisana 2 lis, 3 otwarte zamówienia trzymają v1">
          Skład zamraża się przy pierwszym przyjęciu zamówienia. Zapis nowej wersji nie zmienia rezerwacji, pakowania ani dokumentów zamówień, które już są w OpenLinkerze.
        </Alert>
      ) : null}
      <ul className="cfg-list">
        {rows.map((r) => (
          <li key={r.v}>
            <span className="cfg-row cfg-row--between">
              <span className="cfg-strong">{r.v}</span>
              <StatusBadge tone={r.tone} compact>{r.when}</StatusBadge>
            </span>
            <span className="cfg-muted">{r.comps}</span>
            <span className="cfg-muted">{r.orders}</span>
          </li>
        ))}
      </ul>
    </DetailSection>
  );
}

function Summary({ d, step, scenario }: { d: Draft; step: number; scenario: Scenario }): ReactElement {
  const money = useMoney();
  const b = d.bundleKey === 'mug' ? null : bundleOf(d.bundleKey).bundle;
  const split = computeSplit(d, scenario);
  const res = bundleAtp(d.comps);
  const gift = d.comps.find((c) => c.gift);
  const ready = EDITOR_CHANNELS.filter((id) => d.channels[id] && checkChannel(id, d, true).ok);
  const refused = EDITOR_CHANNELS.filter((id) => d.channels[id] && !checkChannel(id, d, true).ok);
  return (
    <>
      <section className="wizard-summary__section">
        <h3 className="wizard-summary__section-title">Zestaw</h3>
        <dl className="wizard-summary__rows">
          <WizardSummaryRow label="Wariant" value={b ? b.name : null} />
          <WizardSummaryRow label="SKU" value={b ? b.sku : null} mono />
          <WizardSummaryRow label="Cena" value={b ? money(b.price, 'PLN') : null} />
        </dl>
      </section>
      {step >= 1 ? (
        <section className="wizard-summary__section">
          <h3 className="wizard-summary__section-title">Skład</h3>
          <dl className="wizard-summary__rows">
            <WizardSummaryRow label="Składniki" value={d.comps.map((c) => `${c.qty} x ${shortName(c.variant)}`).join(', ') || null} />
            <WizardSummaryRow label="Gratis w zestawie" value={gift ? shortName(gift.variant) : 'brak'} />
          </dl>
        </section>
      ) : null}
      {step >= 2 ? (
        <section className="wizard-summary__section">
          <h3 className="wizard-summary__section-title">Podział ceny</h3>
          <dl className="wizard-summary__rows">
            <WizardSummaryRow label="Sposób" value={split.rows.some((r) => r.overridden) ? 'nadpisany ręcznie' : 'proporcjonalnie do cen osobno'} />
            <WizardSummaryRow label="Stan" value={split.errors.length ? `${split.errors.length} do poprawy` : 'zgadza się co do grosza'} />
            <WizardSummaryRow label="VAT" value={mixedVat(d.comps) ? 'różne stawki, dokument: jedna pozycja' : 'jedna stawka'} />
          </dl>
        </section>
      ) : null}
      {step >= 3 ? (
        <section className="wizard-summary__section">
          <h3 className="wizard-summary__section-title">Dostępność</h3>
          <dl className="wizard-summary__rows">
            <WizardSummaryRow label="Dostępne" value={res.atp === null ? 'nieznane' : `${res.atp} szt.`} />
            <WizardSummaryRow label="Ogranicza" value={res.limiting ? shortName(res.limiting) : null} />
          </dl>
        </section>
      ) : null}
      {step >= 4 ? (
        <section className="wizard-summary__section">
          <h3 className="wizard-summary__section-title">Kanały</h3>
          <dl className="wizard-summary__rows">
            <WizardSummaryRow label="Gotowe" value={ready.map((id) => CHANNELS[id].name).join(', ') || null} />
            <WizardSummaryRow label="Odrzucone" value={refused.map((id) => CHANNELS[id].name).join(', ') || 'brak'} />
          </dl>
        </section>
      ) : null}
      <p className="wizard-summary__note">
        <BundleMark compact label={scenario === 'versions' ? 'v2 aktualna' : 'v3 szkic'} /> Edytujesz nową wersję. Zamówienia już przyjęte trzymają swoją.
      </p>
      {scenario !== 'versions' ? <VersionRail /> : null}
    </>
  );
}

/* ── Screen ─────────────────────────────────────────────────────────── */

function BundleEditor({ scenario }: { scenario: Scenario }): ReactElement {
  const { go } = useProto();
  const { showToast } = useToast();
  const { canWrite, reason } = useWriteGuard();
  const ro = !canWrite;
  const [step, setStep] = useState(STEP_OF[scenario]);
  const [maxStep, setMaxStep] = useState(STEP_OF[scenario]);
  const [d, setD] = useState<Draft>(() => initialDraft(scenario));
  const set = (p: Partial<Draft>): void => setD((x) => ({ ...x, ...p }));

  const stepErrors = useMemo(() => {
    if (step === 0) return variantErrors(d);
    if (step === 1) return componentErrors(d);
    if (step === 2) return computeSplit(d, scenario).errors;
    return [];
  }, [d, step, scenario]);

  const canPublish = EDITOR_CHANNELS.filter((id) => d.channels[id]).every((id) => checkChannel(id, d, true).ok) && EDITOR_CHANNELS.some((id) => d.channels[id]);
  const goTo = (n: number): void => {
    setStep(n);
    setMaxStep((m) => Math.max(m, n));
  };
  const blocked = stepErrors.length > 0;

  let body: ReactNode;
  if (step === 0) body = <StepVariant d={d} set={set} ro={ro} />;
  else if (step === 1) body = <StepComponents d={d} set={set} ro={ro} reason={reason} />;
  else if (step === 2) body = <StepSplit d={d} set={set} ro={ro} scenario={scenario} />;
  else if (step === 3) body = <StepAvailability d={d} />;
  else body = <StepChannels d={d} set={set} ro={ro} reason={reason} />;

  return (
    <div className="cfg-stack">
      <div className="page-header page-header--split">
        <div className="page-header__content">
          <p className="eyebrow">Zestawy</p>
          <h2 className="page-title">Edytor zestawu</h2>
          <p className="page-description">Zestaw poranny, nowa wersja. Skład, podział ceny, dostępność i kanały w pięciu krokach.</p>
        </div>
        <div className="page-header__actions">
          <Button tone="ghost" onClick={() => go('bundles', 'main')}>
            Wróć do listy
          </Button>
        </div>
      </div>
      {scenario === 'versions' ? <VersionHistory full /> : null}
      <WizardLayout
        stepper={<SetupStepper steps={STEPS} currentStep={step} onSelectStep={goTo} maxReachedStep={maxStep} completedSteps={new Set(Array.from({ length: step }, (_, i) => i))} />}
        summary={<Summary d={d} step={step} scenario={scenario} />}
      >
        <div className="wizard-card">
          <h3 className="detail-card__title">
            Krok {step + 1}. {STEPS[step]}
          </h3>
          {body}
          <div className="wizard-actions">
            <div className="wizard-actions__group">
              {step > 0 ? (
                <Button tone="secondary" onClick={() => setStep(step - 1)}>
                  Wstecz
                </Button>
              ) : null}
            </div>
            <div className="wizard-actions__group">
              {step < STEPS.length - 1 ? (
                <Button disabled={blocked} title={blocked ? 'Popraw błędy w tym kroku, żeby przejść dalej.' : undefined} onClick={() => goTo(step + 1)}>
                  Dalej
                </Button>
              ) : (
                <Button
                  disabled={ro || !canPublish}
                  title={ro ? reason : !canPublish ? 'Popraw kanały oznaczone jako odrzucone albo je wyłącz.' : undefined}
                  onClick={() => {
                    set({ published: true });
                    showToast({ title: 'Zapisano zestaw', description: 'Zestaw poranny v3 zapisany i opublikowany w wybranych kanałach.', tone: 'success' });
                  }}
                >
                  Zapisz zestaw i opublikuj
                </Button>
              )}
            </div>
          </div>
        </div>
      </WizardLayout>
    </div>
  );
}

export const screen: ScreenDef = {
  id: 'bundle-editor',
  group: 'Katalog',
  label: 'Edytor zestawu',
  states: [
    { id: 'step-variant', label: 'Krok 1: wariant', note: 'Wariant zestawu przychodzi z mastera, a skład określa OpenLinker. Wybór kubka (składnika innych zestawów) blokuje dalszy krok, a wybór paka z PrestaShop ostrzega o jego własnym stanie.', useCases: ['B-01', 'B-03'], priority: 'pilot' },
    { id: 'step-components', label: 'Krok 2: składniki', note: 'Dodaj, usuń, zmień ilość. Przełącznik "Gratis" robi z łyżeczki gratis w zestawie: ma udział 0 zł, ale rezerwuje się i pakuje jak każdy składnik.', useCases: ['B-01'], priority: 'pilot' },
    { id: 'step-components-nested', label: 'Krok 2: zestaw w zestawie', note: 'Próba dodania Zestawu do parzenia jako składnika jest odrzucona. Zasada działa w obie strony: składnik innego zestawu nie dostanie składu (krok 1, kubek).', useCases: ['B-26', 'B-01'], priority: 'pilot' },
    { id: 'step-split', label: 'Krok 3: podział ceny', note: 'Cena zestawu dzieli się proporcjonalnie do cen składników kupowanych osobno, co do grosza (największa reszta). Gratis w zestawie dostaje 0 zł.', useCases: ['B-14', 'B-01'], priority: 'pilot' },
    { id: 'step-split-over-standalone', label: 'Krok 3: udział ponad cenę osobno', note: 'Nadpisany udział kawy (36,00 zł) przekracza jej cenę osobno (34,99 zł). OpenLinker nie przyjmie takiego podziału, bo zwrot kawy oddałby więcej, niż kosztuje osobno.', useCases: ['B-14'], priority: 'pilot' },
    { id: 'step-split-sum-mismatch', label: 'Krok 3: suma inna niż cena', note: 'Udziały po nadpisaniu dają 60,00 zł, a zestaw kosztuje 64,99 zł. Krok pokazuje różnicę co do grosza i blokuje przejście dalej.', useCases: ['B-14'], priority: 'pilot' },
    { id: 'step-split-missing-price', label: 'Krok 3: brak ceny osobno', note: 'Młynek z Subiekta nie ma ceny sprzedaży osobno, więc podziału proporcjonalnego nie da się policzyć. Operator wpisuje udział ręcznie z powodem albo uzupełnia cenę w masterze.', useCases: ['B-14'], priority: 'pilot' },
    { id: 'step-split-mixed-vat', label: 'Krok 3: różne stawki VAT', note: 'Kubek ma 23%, kawa 5%. W pilocie dokument zostawia jedną pozycję zestawu, tak jak sprzedał kanał. Porównanie pokazuje, ile VAT wyszłoby przy rozbiciu. To nie jest porada podatkowa.', useCases: ['B-14'], priority: 'pilot' },
    { id: 'step-split-changed', label: 'Krok 3: podgląd się zmienił', note: 'Cena kubka w PrestaShop wzrosła, więc proponowany podział jest inny niż w poprzedniej wersji. Kolumna obok pokazuje udział przed zmianą. Przyjęte zamówienia trzymają podział z dnia zamówienia.', useCases: ['B-14', 'B-10'], priority: 'later' },
    { id: 'step-availability', label: 'Krok 4: dostępność', note: 'Dostępność z rozbiciem na składniki. Łyżeczka (4 na stanie, 3 zarezerwowane) ogranicza zestaw do 1 sztuki. Ścieżka stanu zmienia się z przełącznikiem OMS.', useCases: ['B-02'], priority: 'pilot' },
    { id: 'step-channels', label: 'Krok 5: kanały', note: 'Każdy kanał jest sprawdzany przed publikacją. Allegro, PrestaShop i Erli są gotowe. Włącz WooCommerce albo Shopera, żeby zobaczyć odmowę.', useCases: ['B-17'], priority: 'pilot', channels: ['allegro', 'prestashop', 'erli'] },
    { id: 'step-channels-children-refused', label: 'Krok 5: kanał wysyła składniki', note: 'WooCommerce (wtyczki zestawów) i Shoper mogą wysyłać składniki jako osobne pozycje. Z definicją w OpenLinkerze stan zszedłby dwa razy, więc publikacja na tych połączeniach jest odrzucona z powodem.', useCases: ['B-05', 'B-17'], priority: 'pilot', channels: ['woocommerce', 'shoper'] },
    { id: 'step-channels-gpsr', label: 'Krok 5: GPSR, różni producenci', note: 'Składniki mają trzech producentów, a Allegro przyjmuje jednego na ofertę. Publikacja na Allegro czeka, aż wskażesz producenta odpowiedzialnego za zestaw.', useCases: ['B-17'], priority: 'pilot', channels: ['allegro'] },
    { id: 'step-channels-result', label: 'Krok 5: wynik publikacji', note: 'Po zapisie każdy kanał pokazuje wynik: opublikowano z ilością z dostępności zestawu albo pominięto z powodem.', useCases: ['B-17', 'B-10'], priority: 'pilot', channels: ['allegro', 'prestashop', 'erli'] },
    { id: 'versions', label: 'Historia wersji', note: 'Każdy zapis tworzy nową wersję. Zamówienie zamraża skład przy pierwszym przyjęciu, więc 3 otwarte zamówienia dalej rezerwują i pakują skład z v1.', useCases: ['B-10', 'B-01'], priority: 'pilot' },
    ...commonStates('wariantów do zestawu', 'zsynchronizuj katalog z mastera'),
  ],
  render: (state) => <BundleEditor key={state} scenario={state as Scenario} />,
};
