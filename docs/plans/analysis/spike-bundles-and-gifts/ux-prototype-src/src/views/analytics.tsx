/**
 * Analytics: gift cost, bundles and the stock movement ledger (plan item 11).
 * Mirrors the real /analytics page: PageLayout, the date-range toolbar, a KPI
 * strip of AnalyticsKpiCard, dense panels with data tables and coverage notes.
 */
import type { ReactElement } from 'react';
import { Button } from '@web/shared/ui/button';
import { PageLayout } from '@web/shared/ui/page-layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@web/shared/ui/tabs';
import { useToast } from '@web/shared/ui/toast-provider';
import { commonStates, useProto, type ScreenDef } from '../proto';
import { BundlesTab, type BundlesMode } from './ana-bundles';
import { GiftsTab, type GiftsMode } from './ana-gifts';
import { MovementsTab, type MovementsMode } from './ana-movements';
import { AnaToolbar } from './ana-shared';
import { PERIOD } from './ana-data';
import './ana.css';

type Tab = 'gifts' | 'bundles' | 'movements';

const FIRST_STATE: Record<Tab, string> = { gifts: 'gifts-overview', bundles: 'bundles-margin', movements: 'movements-gift' };

function tabOf(state: string): Tab {
  if (state.startsWith('bundles')) return 'bundles';
  if (state.startsWith('movements')) return 'movements';
  return 'gifts';
}

function AnalyticsScreen({ state }: { state: string }): ReactElement {
  const { go } = useProto();
  const { showToast } = useToast();
  const tab = tabOf(state);
  const giftsMode: GiftsMode =
    state === 'gifts-cost-unknown' ? 'cost-unknown' : state === 'gifts-small-gift-register' ? 'register' : state === 'gifts-by-channel' ? 'by-channel' : state === 'gifts-empty' ? 'empty' : 'overview';
  const bundlesMode: BundlesMode = state === 'bundles-no-cost' ? 'no-cost' : state === 'bundles-component-demand' ? 'component-demand' : 'margin';
  const movementsMode: MovementsMode = state === 'movements-bundle-components' ? 'bundle-components' : 'gift';
  return (
    <PageLayout
      eyebrow="Analityka"
      title="Koszt gratisów i zestawy"
      description="Ile kosztują Cię gratisy, ile zarabiasz na zestawach i jak schodzą ze stanu."
      actions={
        <Button tone="secondary" onClick={() => showToast({ tone: 'success', description: 'Wyeksportowano raport do CSV.' })}>
          Eksportuj CSV
        </Button>
      }
    >
      <div className="ana-scope">
      <AnaToolbar from={PERIOD.from} to={PERIOD.to} />
      <Tabs value={tab} onValueChange={(v) => go('analytics', FIRST_STATE[v as Tab])}>
        <TabsList aria-label="Widok analityki">
          <TabsTrigger value="gifts">Koszt gratisów</TabsTrigger>
          <TabsTrigger value="bundles">Zestawy</TabsTrigger>
          <TabsTrigger value="movements">Ruchy magazynowe</TabsTrigger>
        </TabsList>
        <TabsContent value="gifts">{tab === 'gifts' ? <GiftsTab mode={giftsMode} /> : null}</TabsContent>
        <TabsContent value="bundles">{tab === 'bundles' ? <BundlesTab mode={bundlesMode} /> : null}</TabsContent>
        <TabsContent value="movements">{tab === 'movements' ? <MovementsTab mode={movementsMode} /> : null}</TabsContent>
      </Tabs>
      </div>
    </PageLayout>
  );
}

export const screen: ScreenDef = {
  id: 'analytics',
  group: 'Analityka',
  label: 'Koszt gratisów i zestawy',
  states: [
    {
      id: 'gifts-overview',
      label: 'Koszt gratisów',
      note: 'Operator widzi, ile sztuk gratisów wydał, ile kosztowały netto, ile wypada na zamówienie z gratisem i jaką część marży zjadły. Koszt to koszt zakupu wariantu z dnia wydania, a nie cena katalogowa. Tabela pokazuje każdą promocję z budżetem do wydania i podziałem na kanały.',
      useCases: ['G-12', 'G-06', 'X-01'],
      priority: 'later',
      channels: ['allegro', 'prestashop', 'woocommerce', 'shoper', 'erli'],
    },
    {
      id: 'gifts-cost-unknown',
      label: 'Koszt nieznany',
      note: 'Część gratisów nie ma kosztu: próbki przyjęte zanim wpisano koszt (OpenLinker nie dopisuje kosztu wstecz) i młynki dodane ręcznie z Subiekt GT bez kosztu zakupu. Kwoty liczą tylko znany koszt, a nieznany jest pokazany osobno, nigdy jako zero ani jako „poniżej 20 zł”.',
      useCases: ['G-12', 'G-05', 'B-16'],
      priority: 'later',
      channels: ['allegro', 'prestashop'],
    },
    {
      id: 'gifts-small-gift-register',
      label: 'Rejestr małych prezentów',
      note: 'Pakiet krajowy PL liczy roczny koszt zakupu gratisów na odbiorcę względem 100 zł z rejestrem i koszt sztuki względem 20 zł. Dotyczy tylko gratisów przekazanych nieodpłatnie (zapis wewnętrzny), nie gratisów wliczonych w cenę. Rejestr wymaga rozpoznanego klienta, więc kłóci się z przechowywaniem samych skrótów danych osobowych. To podgląd danych, nie porada podatkowa.',
      useCases: ['G-12', 'G-19', 'D-07'],
      priority: 'later',
    },
    {
      id: 'gifts-by-channel',
      label: 'Gratisy według kanału',
      note: 'Ten sam koszt w podziale na kanały, z udziałem w marży zamówień z gratisem. Kolumna kanału mówi, jak kanał przekazuje gratis: Allegro i Erli nie mają gratisów, więc gratis istnieje tylko w OpenLinker, ale i tak schodzi ze stanu w sklepie, który go prowadzi.',
      useCases: ['G-12', 'G-01', 'G-02', 'G-03'],
      priority: 'later',
      channels: ['allegro', 'prestashop', 'woocommerce', 'shoper', 'erli'],
    },
    {
      id: 'gifts-empty',
      label: 'Brak gratisów',
      note: 'Żadna promocja nie wydała jeszcze gratisu. Zamiast pustych tabel ekran wyjaśnia, skąd wezmą się dane, i prowadzi do utworzenia promocji.',
      useCases: ['G-12'],
      priority: 'later',
    },
    {
      id: 'bundles-margin',
      label: 'Marża zestawów',
      note: 'Przychód netto i marża każdego zestawu, gdzie koszt to suma kosztów składników razy ilość. Wersje zestawu liczą się osobno, bo mają inne składniki; łyżeczka-gratis w v2 obniża marżę. Obok udział zamówień z zestawem w każdym kanale.',
      useCases: ['B-16', 'B-10', 'B-14'],
      priority: 'later',
      channels: ['allegro', 'prestashop', 'woocommerce', 'shoper', 'erli'],
    },
    {
      id: 'bundles-no-cost',
      label: 'Zestaw bez kosztu',
      note: 'Zestaw z młynkiem nie ma kosztu, bo młynek nie ma kosztu zakupu w Subiekt GT. Jego sprzedaż jest poza marżą. Operator może wpisać koszt całego zestawu (proces pilota) albo uzupełnić koszt składnika; zamówienia już przyjęte zostają bez kosztu.',
      useCases: ['B-16'],
      priority: 'later',
      channels: ['allegro', 'prestashop'],
    },
    {
      id: 'bundles-component-demand',
      label: 'Popyt na składniki',
      note: 'Ile sztuk każdego składnika zeszło przez zestawy, a ile sprzedano osobno, i ile jest dostępne. Zestaw schodzi ze stanu składnikami, więc to ten sam stan; łyżeczka-gratis jest wąskim gardłem Zestawu porannego.',
      useCases: ['B-16', 'B-23', 'B-02'],
      priority: 'later',
    },
    {
      id: 'movements-gift',
      label: 'Ruchy: gratis',
      note: 'Historia ruchów z filtrem „Gratis”. Z włączonym OMS gratis ma własny ruch z powodem gratis, numerem zamówienia i identyfikatorem pozycji ol-gift, także na Allegro i Erli. Korekta ręczna z trybu pilota też tu trafia. Z wyłączonym OMS sklep sam zdejmuje stan i OpenLinker widzi tylko zmianę z synchronizacji.',
      useCases: ['G-04', 'G-20', 'G-06'],
      priority: 'pilot',
      channels: ['allegro', 'woocommerce', 'erli'],
    },
    {
      id: 'movements-bundle-components',
      label: 'Ruchy: składniki zestawu',
      note: 'Filtr „Składnik zestawu”: każdy składnik ma osobny ruch z identyfikatorem pozycji {linia}~c:{wariant}. Gratis w zestawie ma oba oznaczenia. Pakiet PrestaShop w trybie składników nie może być zdjęty ze stanu, więc ruch jest odrzucony z powodem i wskazówką.',
      useCases: ['B-23', 'B-11', 'B-20', 'B-22'],
      priority: 'pilot',
      channels: ['allegro', 'prestashop', 'erli'],
    },
    ...commonStates('analityki gratisów i zestawów', 'utwórz promocję z gratisem'),
  ],
  render: (state) => <AnalyticsScreen key={state} state={state} />,
};
