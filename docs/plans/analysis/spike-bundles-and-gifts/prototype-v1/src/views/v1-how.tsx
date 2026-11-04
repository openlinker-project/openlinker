/**
 * "Jak to działa": who does what. Integrations carry platform specifics through
 * a few optional fields and declarations; OpenLinker does four generic steps.
 * Source: docs/plans/analysis/spike-bundles-and-gifts/ports-v1.md.
 */
import type { ReactElement } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { DetailSection } from '@web/shared/ui/detail-section';
import { MetricCard } from '@web/shared/ui/metric-card';
import { StatusBadge } from '@web/shared/ui/status-badge';
import type { ScreenDef } from '../proto';

const BY_INTEGRATION = [
  'Mówi, który produkt w zamówieniu jest gratisem, jeśli kanał to wie (reguła koszyka PrestaShop, IdoSell, Empik).',
  'Wysyła gratis do sklepu i na dokument po swojemu: pozycja 0,00 zł albo pominięta, zależnie od tego, co przyjmuje dostawca.',
  'Może pobrać skład paku z PrestaShop albo kompletu z Subiekta.',
];

const BY_OL = [
  'Rozkłada zestaw na składniki: rezerwacja, pakowanie i zdjęcie stanu idą po składnikach.',
  'Dodaje gratisy z własnych promocji, także na Allegro i Erli, gdzie kanał ich nie zna.',
  'Pilnuje, żeby suma dokumentu była równa temu, co zapłacił klient.',
  'Liczy dostępność zestawu z najmniej dostępnego składnika i wysyła ją do kanałów.',
];

const INTEGRATIONS: { name: string; does: string; tone: 'success' | 'neutral' | 'info' }[] = [
  { name: 'Allegro', does: 'Podaje, ile sztuk jest w multipaku. Bez tego zamówienie czeka na zestaw "N x produkt".', tone: 'info' },
  { name: 'Erli', does: 'Nic. Gratis i zestaw obsługuje OpenLinker.', tone: 'success' },
  { name: 'PrestaShop (sklep źródłowy)', does: 'Wydziela gratis z reguły koszyka jako osobną pozycję za 0,00 zł.', tone: 'info' },
  { name: 'PrestaShop, Subiekt (katalog)', does: 'Opcjonalnie: odczyt składu paku lub kompletu.', tone: 'neutral' },
  { name: 'PrestaShop, WooCommerce, Shoper (sklep docelowy)', does: 'Nic. Gratis to pozycja 0,00 zł, zestaw to zwykły produkt.', tone: 'success' },
  { name: 'WooCommerce (sklep źródłowy)', does: 'Nic. Gratisy z wtyczek przychodzą jako pozycje 0,00 zł.', tone: 'success' },
  { name: 'Shoper (sklep źródłowy)', does: 'Skleja składniki zestawu w jedną pozycję, oznacza gratisy z aplikacji.', tone: 'info' },
  { name: 'IdoSell, Empik (później)', does: 'Przepisuje swoją flagę gratisu.', tone: 'info' },
  { name: 'KSeF, inFakt', does: 'Opcjonalnie deklaruje: przyjmuję pozycję 0,00 zł.', tone: 'neutral' },
  { name: 'eparagony, Subiekt', does: 'Opcjonalnie deklaruje: nie przyjmuję 0,00 zł (błąd 41). Wtedy grosz z pozycji w tej samej stawce.', tone: 'neutral' },
];

function How(): ReactElement {
  return (
    <PageLayout
      eyebrow="Start"
      title="Jak to działa"
      description="Integracje znają swoje platformy, więc to one mówią, co jest gratisem, i zapisują go po swojemu. OpenLinker robi tylko cztery ogólne kroki, takie same dla każdego kanału."
    >
      <div className="spike-metrics proto-metrics">
        <MetricCard label="Nowe obowiązkowe metody w portach" value="0" tone="success" description="wszystkie pola i deklaracje są opcjonalne" />
        <MetricCard label="Zmienione miejsca w core" value="16" description="w tym 5 jednolinijkowych zamian listy pozycji" />
        <MetricCard label="Integracje, które muszą coś zrobić" value="3" description="Allegro, PrestaShop, Shoper; reszta działa bez zmian" />
      </div>
      <DetailSection title="Robi integracja">
        <ul className="proto-gaps">{BY_INTEGRATION.map((t) => <li key={t}>{t}</li>)}</ul>
      </DetailSection>
      <DetailSection title="Robi OpenLinker">
        <ul className="proto-gaps">{BY_OL.map((t) => <li key={t}>{t}</li>)}</ul>
      </DetailSection>
      <DetailSection title="Co robi każda integracja">
        <div className="data-table__container" tabIndex={0} aria-label="Integracje">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Integracja</th>
                <th scope="col">Co robi</th>
              </tr>
            </thead>
            <tbody>
              {INTEGRATIONS.map((i) => (
                <tr key={i.name}>
                  <th scope="row">{i.name}</th>
                  <td><StatusBadge tone={i.tone} compact>{i.tone === 'success' ? 'Nic' : i.tone === 'info' ? 'Mapuje' : 'Opcjonalnie'}</StatusBadge> {i.does}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="proto-inline-note">Integracja, która nic nie zadeklaruje, działa jak dziś: pozycja bez oznaczenia jest zwykłą pozycją, a gratis jest pomijany na dokumencie.</p>
      </DetailSection>
    </PageLayout>
  );
}

export const screen: ScreenDef = {
  id: 'how',
  group: 'Start',
  label: 'Jak to działa',
  states: [
    {
      id: 'overview',
      label: 'Kto co robi',
      note: 'Podział pracy między integracje i OpenLinker. Pod spodem: zamówienie ma jedną listę sprzedanych pozycji, a OpenLinker wylicza z niej listę fizyczną (zestaw rozłożony na składniki), z której korzysta magazyn i pakowanie. Szczegóły techniczne: ports-v1.md w spike\'u.',
      useCases: [],
      priority: 'pilot',
    },
  ],
  render: () => <How />,
};
