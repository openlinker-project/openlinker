/**
 * Scenario guide: pick a channel and a scenario, then walk an order through
 * every step. Each step opens the real screen in that state.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { DetailSection } from '@web/shared/ui/detail-section';
import { SegmentedControl } from '@web/shared/ui/segmented-control';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { Button } from '@web/shared/ui/button';
import { KpiCard } from '@web/shared/ui/kpi-card';
import { CHANNELS, PROMOTIONS, VARIANTS, type ChannelId } from '../model/catalog';
import { buildDocument, giftCost } from '../model/calc';
import { useMoney, useProto, type ScreenDef, type StateDef } from '../proto';
import { BundleMark, ChannelPayload, GiftMark, PartOf, StockPathTrail, WhoPaysStrip } from '../ui/marks';
import { ReceiptPreview } from '../ui/documents';
import { GUIDE_CHANNELS, SCENARIOS, SUPPORT_LABEL, story, type ScenarioId, type Step } from './guide-data';
import './gd.css';

function StepVisual({ step, scenario, payload }: { step: Step; scenario: ScenarioId; payload: { text: string; tone?: 'warn' | 'muted' | 'key' }[] }): ReactElement | null {
  const { oms } = useProto();
  const money = useMoney();
  const gift = scenario.startsWith('gift') || scenario === 'bundle-gift';
  switch (step.visual) {
    case 'payload':
      return <ChannelPayload title="Dane z kanału" lines={payload} />;
    case 'order':
      return (
        <div className="gd-mini-order">
          <div className="gd-mini-line">
            <BundleMark compact />
            <span className="gd-mini-name">Zestaw poranny</span>
            <span className="tabular">{money(6499)}</span>
          </div>
          <div className="gd-mini-line gd-mini-line--child"><PartOf bundle="Zestaw poranny" /><span className="gd-mini-name">{VARIANTS.mug.name}</span></div>
          <div className="gd-mini-line gd-mini-line--child"><PartOf bundle="Zestaw poranny" /><span className="gd-mini-name">{VARIANTS.coffee.name}</span></div>
          {gift ? (
            <div className="gd-mini-gift">
              <div className="gd-mini-line">
                <GiftMark source={scenario === 'gift-declared' ? 'channel-flag' : scenario === 'gift-inferred' ? 'inferred' : 'ol-rule'} />
                <span className="gd-mini-name">{VARIANTS.spoon.name}</span>
                <span className="tabular">{money(0)}</span>
              </div>
              <WhoPaysStrip qty={1} unitCost={VARIANTS.spoon.cost} compact />
            </div>
          ) : null}
        </div>
      );
    case 'trail':
    case 'stock':
      return (
        <StockPathTrail
          steps={
            oms
              ? [
                  { label: 'Zarezerwowano', state: 'done', detail: 'na pozycję zamówienia' },
                  { label: 'Spakowano', state: 'done', detail: 'zeskanowano na stanowisku' },
                  { label: 'Zdjęto ze stanu w PrestaShop', state: 'active', detail: gift ? 'powód: gratis' : 'składniki, nie pak' },
                ]
              : [
                  { label: 'Zarezerwowano', state: 'done' },
                  { label: gift ? 'Wysłano do PrestaShop jako pozycja 0,00 zł' : 'Wysłano zamówienie do PrestaShop', state: 'done' },
                  { label: 'Sklep zdjął stan', state: 'active', detail: 'rezerwacja zamknięta' },
                ]
          }
        />
      );
    case 'bench':
      return (
        <ul className="gd-mini-bench">
          <li><span className="tabular">1/1</span> {VARIANTS.mug.name}</li>
          <li><span className="tabular">0/1</span> {VARIANTS.coffee.name}</li>
          {gift ? (
            <li className="gd-mini-bench__gift">
              <GiftMark compact /> Włóż gratis: {VARIANTS.spoon.name}
            </li>
          ) : null}
        </ul>
      );
    case 'doc':
      return (
        <div className="gd-mini-doc">
          <ReceiptPreview
            doc={buildDocument({
              paidLines: [{ name: 'Zestaw poranny', qty: 1, unitGross: 6499, vat: 23, bundle: 'morning' }],
              gift: gift ? { variant: 'spoon', qty: 1 } : undefined,
              giftTreatment: 'omit',
              bundleMode: 'one-line',
              refusesZeroRate: true,
            })}
          />
        </div>
      );
    case 'analytics': {
      const p = PROMOTIONS[0];
      return (
        <div className="gd-mini-kpi">
          <KpiCard label="Gratisy wydane w listopadzie" value={String(p.given)} description={p.name} />
          <KpiCard label="Koszt gratisów" value={money(giftCost(p.gift, p.given), 'PLN')} description="netto, z kosztu zakupu" />
        </div>
      );
    }
    default:
      return null;
  }
}

function Guide({ scenario: initialScenario, showMatrix }: { scenario: ScenarioId; showMatrix?: boolean }): ReactElement {
  const { go } = useProto();
  const [channel, setChannel] = useState<ChannelId>(initialScenario === 'gift-declared' ? 'idosell' : initialScenario === 'gift-inferred' ? 'shoper' : 'allegro');
  const [scenario, setScenario] = useState<ScenarioId>(initialScenario);
  const [step, setStep] = useState(0);
  const s = useMemo(() => story(channel, scenario), [channel, scenario]);
  const cur = s.steps[Math.min(step, s.steps.length - 1)];
  const sup = SUPPORT_LABEL[s.support];

  const pickScenario = (id: ScenarioId): void => {
    setScenario(id);
    setStep(0);
  };

  return (
    <PageLayout
      eyebrow="Przewodnik"
      title="Jak OpenLinker obsługuje zestawy i gratisy"
      description="Wybierz kanał sprzedaży i sytuację. Przejdź krok po kroku przez zamówienie: od tego, co przysłał kanał, przez pakowanie i paragon, po magazyn i analitykę. Każdy krok otwiera prawdziwy ekran."
    >
      <div className="gd-channels">
        <SegmentedControl
          aria-label="Kanał sprzedaży"
          options={GUIDE_CHANNELS.map((c) => ({ value: c, label: CHANNELS[c].name }))}
          value={channel}
          onChange={(v) => {
            setChannel(v as ChannelId);
            setStep(0);
          }}
        />
      </div>

      <div className="gd-layout">
        <nav className="gd-scenarios" aria-label="Sytuacje">
          {SCENARIOS.map((sc) => {
            const sup2 = SUPPORT_LABEL[story(channel, sc.id).support];
            return (
              <button key={sc.id} type="button" className={`gd-scenario${sc.id === scenario ? ' gd-scenario--active' : ''}`} aria-current={sc.id === scenario ? 'true' : undefined} onClick={() => pickScenario(sc.id)}>
                <span className="gd-scenario__label">{sc.label}</span>
                <span className="gd-scenario__short">{sc.short}</span>
                <StatusBadge tone={sup2.tone} compact>{sup2.label}</StatusBadge>
              </button>
            );
          })}
        </nav>

        <div className="gd-story">
          <div className="gd-verdict">
            <StatusBadge tone={sup.tone}>{sup.label}</StatusBadge>
            <p>{s.verdict}</p>
          </div>

          <ol className="gd-steps" aria-label="Kroki zamówienia">
            {s.steps.map((st, i) => (
              <li key={i} className={`gd-step${i === step ? ' gd-step--current' : ''}${i < step ? ' gd-step--done' : ''}`}>
                <button type="button" className="gd-step__head" aria-expanded={i === step} onClick={() => setStep(i)}>
                  <span className="gd-step__n tabular" aria-hidden="true">{i + 1}</span>
                  <span className="gd-step__title">{st.title}</span>
                </button>
                {i === step ? (
                  <div className="gd-step__body">
                    <p>{st.body}</p>
                    <StepVisual step={st} scenario={scenario} payload={s.payload} />
                    <div className="gd-step__actions">
                      <Button tone="secondary" onClick={() => go(st.screen, st.state)}>Otwórz ten ekran</Button>
                      {i > 0 ? <Button tone="ghost" onClick={() => setStep(i - 1)}>Wstecz</Button> : null}
                      {i < s.steps.length - 1 ? <Button onClick={() => setStep(i + 1)}>Dalej</Button> : null}
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="gd-progress tabular" aria-live="polite">Krok {Math.min(step, s.steps.length - 1) + 1} z {s.steps.length}: {cur.title}</p>
        </div>
      </div>

      {showMatrix ? (
        <DetailSection title="Kto co obsługuje: kanał czy OpenLinker">
          <div className="data-table__container" tabIndex={0} aria-label="Macierz obsługi">
            <table className="data-table gd-matrix">
              <thead>
                <tr>
                  <th scope="col">Sytuacja</th>
                  {GUIDE_CHANNELS.map((c) => (
                    <th key={c} scope="col">{CHANNELS[c].name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SCENARIOS.map((sc) => (
                  <tr key={sc.id}>
                    <th scope="row">{sc.label}</th>
                    {GUIDE_CHANNELS.map((c) => {
                      const x = SUPPORT_LABEL[story(c, sc.id).support];
                      return (
                        <td key={c}>
                          <button type="button" className="gd-cell" title={story(c, sc.id).verdict} onClick={() => { setChannel(c); pickScenario(sc.id); window.scrollTo({ top: 0 }); }}>
                            <StatusBadge tone={x.tone} compact>{x.label}</StatusBadge>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DetailSection>
      ) : null}
    </PageLayout>
  );
}

const NOTES: Record<ScenarioId, string> = {
  'gift-ol-only': 'Najważniejszy scenariusz. Allegro i Erli nie mają gratisów, więc gratis istnieje tylko w OpenLinkerze. OpenLinker dopisuje go do zamówienia przy przyjęciu, rezerwuje, daje do spakowania i zdejmuje ze stanu w PrestaShop z powodem "gratis". Przełącz OMS w pasku, żeby zobaczyć drogę bez OMS: gratis idzie do sklepu jako pozycja 0,00 zł.',
  bundle: 'Zestaw sprzedany na kanale. OpenLinker zna skład z definicji, rezerwuje i pakuje składniki, a dokument zostawia na pozycji zestawu.',
  'bundle-gift': 'Gratis może być częścią definicji zestawu (wersja 2 zestawu porannego dodaje łyżeczkę). Wtedy rezerwuje się i pakuje razem ze składnikami.',
  'gift-declared': 'Kanały, które oznaczają gratis: IdoSell (orderSalesMode gift) i Empik (offered_quantity). PrestaShop daje tylko regułę koszyka, więc gratis przychodzi po pełnej cenie.',
  'gift-inferred': 'Shoper i WooCommerce przysyłają gratis jako pozycję za grosz albo za 0,00 zł. Bez reguły operatora OpenLinker nie zgaduje.',
  'gift-oos': 'Gratisu zabrakło. Promocja ma politykę: zamiennik, pominięcie z adnotacją albo wstrzymanie.',
  multipack: 'Multipack na Allegro po 12.01.2027. Bez definicji zestawu zamówienie jest wstrzymane.',
  'offer-bundle': 'Pakiet ofert Allegro: osobne pozycje z rabatem pakietu bez kwoty.',
  'gift-wrap': 'Pakowanie na prezent jest płatną usługą, nie gratisem.',
  cancel: 'Anulowanie oddaje stan składników i gratisu.',
  return: 'Zwroty zestawów i gratisów.',
};

const GUIDE_USE_CASES: Record<ScenarioId, string[]> = {
  'gift-ol-only': ['G-04', 'G-05', 'G-06', 'G-20', 'G-21'],
  bundle: ['B-04', 'B-05', 'B-23'],
  'bundle-gift': ['G-07', 'B-23'],
  'gift-declared': ['G-01', 'G-03'],
  'gift-inferred': ['G-02'],
  'gift-oos': ['G-08'],
  multipack: ['B-08'],
  'offer-bundle': ['B-07', 'X-01'],
  'gift-wrap': ['G-14', 'D-05'],
  cancel: ['B-24'],
  return: ['B-15', 'G-11', 'R-01'],
};

const states: StateDef[] = [
  ...SCENARIOS.map((sc) => ({
    id: sc.id,
    label: sc.label,
    note: NOTES[sc.id],
    useCases: GUIDE_USE_CASES[sc.id],
    priority: (sc.id === 'gift-ol-only' || sc.id === 'bundle' ? 'pilot' : sc.id === 'multipack' || sc.id === 'gift-wrap' ? 'stage0' : 'later') as StateDef['priority'],
  })),
  { id: 'matrix', label: 'Macierz: kanał czy OpenLinker', note: 'Jedna tabela: dla każdego kanału i sytuacji, czy kanał sam to obsługuje, czy robi to OpenLinker. Kliknij komórkę, żeby przejść przez scenariusz.', useCases: ['X-03'], priority: 'pilot' },
];

export const screen: ScreenDef = {
  id: 'guide',
  group: 'Start',
  label: 'Przewodnik',
  states,
  render: (state) => <Guide key={state} scenario={(state === 'matrix' ? 'gift-ol-only' : state) as ScenarioId} showMatrix={state === 'matrix'} />,
};
