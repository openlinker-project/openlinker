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
import {
  BUNDLE_MATRIX,
  CHANGED,
  CHANNELS,
  COLLISIONS,
  COMPETITORS,
  CONFIRMED,
  DECLARATIONS,
  FIELDS,
  GIFT_MATRIX,
  NEW_IN_R2,
  SCENARIO,
  type Cov,
  type MatrixRow,
} from './data';

const COV: Record<Cov, { label: string; tone: StatusBadgeTone }> = {
  F: { label: 'Tak', tone: 'success' },
  P: { label: 'Częściowo', tone: 'warning' },
  N: { label: 'Nie', tone: 'error' },
  U: { label: 'Brak danych', tone: 'neutral' },
};

const ROLE_TONE: Record<string, StatusBadgeTone> = {
  zestaw: 'info',
  składnik: 'neutral',
  gratis: 'review',
  zwykła: 'neutral',
};

const TABS = [
  { id: 'podsumowanie', label: 'Podsumowanie' },
  { id: 'standard', label: 'Standard i capability' },
  { id: 'rundy', label: 'Runda 1 a runda 2' },
  { id: 'kod', label: 'Wpływ na kod' },
  { id: 'konkurencja', label: 'Konkurencja' },
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

/* ── Run comparison maths, computed so the numbers cannot drift ── */
interface Diff {
  rowId: string;
  label: string;
  competitor: string;
  r1: Cov;
  r2: Cov;
}

function compare(rows: MatrixRow[]): { cells: number; same: number; filled: Diff[]; changed: Diff[] } {
  let cells = 0;
  let same = 0;
  const filled: Diff[] = [];
  const changed: Diff[] = [];
  for (const row of rows) {
    if (!row.r1) continue;
    row.r2.forEach((v, i) => {
      const before = row.r1![i];
      cells += 1;
      if (before === v) {
        same += 1;
        return;
      }
      const d = { rowId: row.id, label: row.label, competitor: COMPETITORS[i], r1: before, r2: v };
      if (before === 'U' || v === 'U') filled.push(d);
      else changed.push(d);
    });
  }
  return { cells, same, filled, changed };
}

/* ── Channel mapper: the one interactive element ── */
function ChannelMapper(): ReactElement {
  const [id, setId] = useState<string>(CHANNELS[0].id);
  const ch = CHANNELS.find((c) => c.id === id) ?? CHANNELS[0];
  return (
    <div className="mapper">
      <p className="mapper__scenario">{SCENARIO}</p>
      <SegmentedControl
        aria-label="Kanał sprzedaży"
        options={CHANNELS.map((c) => ({ value: c.id, label: c.label }))}
        value={id}
        onChange={setId}
        className="mapper__switch"
      />
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
          <h5 className="mapper__sub">Adapter deklaruje</h5>
          <ul className="mapper__bullets">
            {ch.declares.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </section>
        <section className="mapper__col mapper__col--model">
          <h4 className="mapper__h">
            <span className="mapper__step tabular" aria-hidden="true">2</span>
            Jeden model OpenLinkera
          </h4>
          <div className="data-table__container spike-scroll">
            <table className="data-table mapper__table">
              <caption className="spike-sr">Linie w neutralnym modelu</caption>
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
                      {n.list ? (
                        <span className="spike-note">
                          cena katalogowa {n.list} zł{n.reduction ? ` · ${n.reduction}` : ''}
                        </span>
                      ) : null}
                    </th>
                    <td>
                      <StatusBadge tone={ROLE_TONE[n.role]} compact>{n.role}</StatusBadge>
                    </td>
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
          <ul className="mapper__bullets">
            {ch.core.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
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

function Matrix({ rows, caption }: { rows: MatrixRow[]; caption: string }): ReactElement {
  return (
    <div className="data-table__container spike-scroll" tabIndex={0} aria-label={caption}>
      <table className="data-table spike-matrix">
        <caption className="spike-sr">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Przypadek</th>
            {COMPETITORS.map((c) => (
              <th key={c} scope="col">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="spike-matrix__case">
                <span className="mono-text spike-id">{r.id}</span>
                <span>{r.label}</span>
                {r.note ? <span className="spike-note">{r.note}</span> : null}
              </th>
              {r.r2.map((c, i) => {
                const before = r.r1?.[i];
                const moved = before !== undefined && before !== c;
                return (
                  <td key={COMPETITORS[i]} className={moved ? 'spike-cell--moved' : undefined}>
                    <StatusBadge tone={COV[c].tone} compact>{COV[c].label}</StatusBadge>
                    {moved ? <span className="spike-was">runda 1: {COV[before].label}</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Summary({ agreement }: { agreement: string }): ReactElement {
  return (
    <PageLayout
      eyebrow="Spike, runda 2 · 4 listopada 2026"
      title="Zestawy i gratisy w jednym standardzie"
      description="Druga, niezależna runda badań: problem w kanałach, 7 konkurentów jeszcze raz i trzy przeglądy kodu OpenLinkera pod kątem capability na portach. Wnioski z obu rund złożone w jedną propozycję."
    >
      <div className="spike-metrics">
        <MetricCard label="Raporty w rundzie 2" value="16" description="5 o kanałach, 8 o konkurencji, 3 o kodzie" />
        <MetricCard label="Zgodność ocen konkurencji" value={agreement} tone="info" description="Ta sama ocena w obu rundach, ta sama komórka macierzy" />
        <MetricCard label="Kolizje w kodzie" value="6" tone="error" description="Miejsca, które rozpoznają linię tylko po id linii zamówienia" />
        <MetricCard label="Nowe capability" value="2-4" description="Reszta to pola na linii i logika core" />
      </div>

      <DetailSection title="Decyzja, którą proponujemy" tone="hero">
        <ol className="spike-findings">
          <li className="spike-finding">
            <span className="spike-finding__n tabular" aria-hidden="true">1</span>
            <div className="spike-finding__body">
              <h4 className="spike-finding__title">Dane w polach linii, ograniczenia w deklaracjach adapterów</h4>
              <p>Skład zestawu i dowody obniżki (cena katalogowa, powód, dowód) to opcjonalne, neutralne pola linii zamówienia. Adapter i tak czyta całe zamówienie, więc osobna metoda czytałaby to samo dwa razy. To, czego adapter nie umie (rabat na linii, linia 0 zł, natywna oferta-zestaw, sposób liczenia stanu zestawu), deklaruje capability.</p>
            </div>
          </li>
          <li className="spike-finding">
            <span className="spike-finding__n tabular" aria-hidden="true">2</span>
            <div className="spike-finding__body">
              <h4 className="spike-finding__title">Brak deklaracji to zawsze najbezpieczniejsze zachowanie</h4>
              <p>Adapter, który nic nie deklaruje, działa jak dziś. Core przyjmuje założenie, które nie prowadzi do oversellingu ani odrzuconego paragonu. Tak działa już limit nazwy linii na paragonie (ADR-082) i efekt stanu przy tworzeniu zamówienia.</p>
            </div>
          </li>
          <li className="spike-finding">
            <span className="spike-finding__n tabular" aria-hidden="true">3</span>
            <div className="spike-finding__body">
              <h4 className="spike-finding__title">Dwie warstwy linii: kanału i realizacji</h4>
              <p>Linia zestawu z kanału zostaje do widoku, dokumentu i odpowiedzi do kanału. Składniki dostają własny identyfikator realizacji do rezerwacji, pakowania, zdjęcia stanu i przesyłek. Apilo i BaseLinker gubią linię zestawu; Linnworks trzyma obie warstwy.</p>
            </div>
          </li>
          <li className="spike-finding">
            <span className="spike-finding__n tabular" aria-hidden="true">4</span>
            <div className="spike-finding__body">
              <h4 className="spike-finding__title">Nikt z 7 konkurentów nie ma takiego standardu</h4>
              <p>Linnworks ma deklaracje integracji, ale bez słownika zestawów i gratisów. Shopify ma słownik, ale tylko dla własnych aplikacji. BaseLinker i Apilo każą operatorowi wszystko wiązać ręcznie, a ustawienia rabatów dorabiają osobno dla każdej integracji.</p>
            </div>
          </li>
        </ol>
      </DetailSection>

      <Alert tone="warning" title="Najgroźniejsze ryzyko przed startem prac">
        Klucz zdjęcia stanu przy sprzedaży zawiera tylko id linii zamówienia. Drugi składnik tego samego zestawu wygląda jak powtórka i jego stan nigdy nie schodzi, a system pokazuje go jako rozliczony. Każdy składnik musi dostać własną tożsamość, zanim powstanie pierwszy zestaw.
      </Alert>
    </PageLayout>
  );
}

function StandardTab(): ReactElement {
  return (
    <PageLayout
      eyebrow="Propozycja"
      title="Jeden model, wiele kanałów"
      description="Ten sam zestaw z gratisem, sześć kanałów. Wybierz kanał, żeby zobaczyć, co przychodzi, jak adapter to tłumaczy i co z tym robi core."
    >
      <DetailSection title="Ten sam zestaw z każdego kanału">
        <ChannelMapper />
      </DetailSection>

      <DetailSection title="Neutralne pola (dane)">
        <div className="data-table__container spike-scroll">
          <table className="data-table spike-def">
            <thead>
              <tr>
                <th scope="col">Pole</th>
                <th scope="col">Gdzie</th>
                <th scope="col">Co niesie</th>
                <th scope="col">Brak znaczy</th>
              </tr>
            </thead>
            <tbody>
              {FIELDS.map((f) => (
                <tr key={f.name}>
                  <th scope="row"><code className="mono-text">{f.name}</code></th>
                  <td>{f.where}</td>
                  <td>{f.what}</td>
                  <td>{f.absent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DetailSection>

      <DetailSection title="Deklaracje adapterów (capability)">
        <div className="data-table__container spike-scroll">
          <table className="data-table spike-def">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">Port</th>
                <th scope="col">Adapter mówi</th>
                <th scope="col">Bez deklaracji</th>
              </tr>
            </thead>
            <tbody>
              {DECLARATIONS.map((d) => (
                <tr key={d.name}>
                  <th scope="row"><code className="mono-text">{d.name}</code></th>
                  <td>{d.port}</td>
                  <td>{d.says}</td>
                  <td>{d.absent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="spike-footnote">Wszystkie jako guard-only: bez wpisu w manifeście, core sprawdza, czy metoda istnieje (ADR-046). Nowa nazwa w manifeście nie objęłaby istniejących połączeń, bo ich lista capability nie jest uzupełniana wstecz.</p>
      </DetailSection>

      <DetailSection title="Zasady country-agnostic">
        <KeyValueList
          items={[
            { id: 'c1', label: 'Słownik', value: 'W core nie ma słów "gratis", "zestaw", "komplet". Są role linii i typ obniżki.' },
            { id: 'c2', label: 'Typ darmowej linii', value: 'Rabat w towarze albo prezent. Włochy i UE traktują je różnie, więc typ jest zapisany, a polityka podatkowa jest per kraj.' },
            { id: 'c3', label: 'Progi i kwoty', value: 'Żadnych kwot w core (np. 100 zł). "0,01 zł = gratis" to reguła operatora.' },
            { id: 'c4', label: 'Pola kanałów', value: 'originalPrice, unitPriceBeforeRebate, children, P_10, rebatesMarkups zostają w adapterach.' },
            { id: 'c5', label: 'Limity urządzeń', value: 'Deklaruje adapter. Core trzyma tylko najbezpieczniejszy zapas.' },
          ]}
        />
      </DetailSection>
    </PageLayout>
  );
}

function RoundsTab(): ReactElement {
  const all = useMemo(() => compare([...BUNDLE_MATRIX, ...GIFT_MATRIX]), []);
  return (
    <PageLayout
      eyebrow="Weryfikacja"
      title="Co się potwierdziło, co się zmieniło"
      description="Runda 2 nie dostała wyników rundy 1. Porównanie pokazuje, które wnioski są stabilne, a które zależą od tego, kto szukał."
    >
      <div className="spike-metrics">
        <MetricCard label="Porównane oceny" value={String(all.cells)} description="7 konkurentów, przypadki obecne w obu rundach" />
        <MetricCard label="Takie same" value={String(all.same)} tone="success" />
        <MetricCard label="Uzupełnione luki" value={String(all.filled.length)} tone="info" description="Jedna runda nie znalazła danych" />
        <MetricCard label="Inna ocena" value={String(all.changed.length)} tone="warning" description="Obie rundy znalazły dane, ale ocena się różni" />
      </div>

      <DetailSection title="Potwierdzone w obu rundach">
        <List items={CONFIRMED.map((t, i) => ({ id: `P${i + 1}`, text: t }))} />
      </DetailSection>

      <DetailSection title="Zmienione albo doprecyzowane">
        <div className="data-table__container spike-scroll">
          <table className="data-table spike-def">
            <thead>
              <tr>
                <th scope="col">Temat</th>
                <th scope="col">Runda 1</th>
                <th scope="col">Runda 2</th>
              </tr>
            </thead>
            <tbody>
              {CHANGED.map((c) => (
                <tr key={c.title}>
                  <th scope="row">{c.title}</th>
                  <td>{c.r1}</td>
                  <td>{c.r2}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DetailSection>

      <DetailSection title="Inne oceny konkurencji">
        <div className="data-table__container spike-scroll">
          <table className="data-table spike-def">
            <thead>
              <tr>
                <th scope="col">Przypadek</th>
                <th scope="col">System</th>
                <th scope="col">Runda 1</th>
                <th scope="col">Runda 2</th>
              </tr>
            </thead>
            <tbody>
              {all.changed.map((d) => (
                <tr key={`${d.rowId}-${d.competitor}`}>
                  <th scope="row">
                    <span className="mono-text spike-id">{d.rowId}</span> {d.label}
                  </th>
                  <td>{d.competitor}</td>
                  <td><StatusBadge tone={COV[d.r1].tone} compact>{COV[d.r1].label}</StatusBadge></td>
                  <td><StatusBadge tone={COV[d.r2].tone} compact>{COV[d.r2].label}</StatusBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="spike-footnote">Różnice wynikają głównie z tego, co agent uznał za "pełne" (np. Shopify liczy stan zestawu, ale z sumy magazynów) i z dokumentacji za logowaniem (Brightpearl z archiwum, Cin7 przez API pomocy). Żadna różnica nie zmienia kierunku decyzji.</p>
      </DetailSection>

      <DetailSection title="Nowe w rundzie 2">
        <List items={NEW_IN_R2} />
      </DetailSection>
    </PageLayout>
  );
}

function CodeTab(): ReactElement {
  return (
    <PageLayout
      eyebrow="OpenLinker"
      title="Wpływ na kod"
      description="Trzy niezależne przeglądy kodu: system capability, linia zamówienia i dokumenty, magazyn i pakowanie."
    >
      <DetailSection title="Kolizje, gdy zestaw zmienia się w składniki">
        <List items={COLLISIONS.map((c, i) => ({ id: `K${i + 1}`, text: c }))} />
      </DetailSection>
      <DetailSection title="Co adaptery dziś ignorują">
        <KeyValueList
          items={[
            { id: 'a1', label: 'Allegro', value: 'productSet, originalPrice, discounts[], selectedAdditionalServices' },
            { id: 'a2', label: 'Shoper', value: 'type, children (w zamówieniach i w product master)' },
            { id: 'a3', label: 'PrestaShop', value: 'reguły koszyka z gratisem, skład paku, reduction_*' },
            { id: 'a4', label: 'WooCommerce', value: 'subtotal, meta_data, bundled_by / bundled_items, coupon_lines' },
            { id: 'a5', label: 'Erli', value: 'unitPriceBeforeRebate (w typie, nieczytane), rabat zamówienia, waluta EUR' },
            { id: 'a6', label: 'Subiekt', value: 'komplety, para cen przed i po rabacie na paragonie' },
            { id: 'a7', label: 'Dokumenty', value: 'KSeF bez P_10, eparagony bez rabatu na linii, brak strażnika stawki 0' },
          ]}
        />
      </DetailSection>
      <DetailSection title="Logika core, bez capability">
        <List
          items={[
            { id: 'C1', text: 'Definicja zestawu: składniki, cena w zestawie, flaga gratisu, bez zagnieżdżania.' },
            { id: 'C2', text: 'Dostępność zestawu, odwrotne wyszukiwanie, publikacja do kanałów po zmianie składnika.' },
            { id: 'C3', text: 'Rozbicie przy rezerwacji i routingu, z tożsamością składnika do końca.' },
            { id: 'C4', text: 'Jedna sztuka zestawu w jednej paczce, więc "wysłano" do kanału trzyma się samo.' },
            { id: 'C5', text: 'Gratis jako dodana linia w nakładce edycji i akcja automatyzacji "dodaj linię".' },
            { id: 'C6', text: 'Plan linii dokumentu: rabat, sama cena, pominięcie, scalenie albo odmowa, w sales-documents.' },
          ]}
        />
      </DetailSection>
    </PageLayout>
  );
}

function CompetitionTab(): ReactElement {
  return (
    <PageLayout
      eyebrow="Runda 2"
      title="Konkurencja"
      description="Ocena z rundy 2. Komórka z dopiskiem pokazuje, że runda 1 oceniła ją inaczej."
    >
      <DetailSection title="Zestawy">
        <Matrix rows={BUNDLE_MATRIX} caption="Zestawy u konkurencji" />
      </DetailSection>
      <DetailSection title="Gratisy">
        <Matrix rows={GIFT_MATRIX} caption="Gratisy u konkurencji" />
      </DetailSection>
      <DetailSection title="Jak konkurenci wyrównują różnice między integracjami">
        <KeyValueList
          items={[
            { id: 'n1', label: 'Linnworks', value: 'Integracja deklaruje flagi (anulowanie linii, zwrot do pozycji, wiele magazynów), ekrany ukrywają to, czego kanał nie umie. Dla zestawów tylko przełącznik Magento.' },
            { id: 'n2', label: 'Shopify', value: 'Jeden kształt zamówienia dla wszystkich aplikacji: aplikacja deklaruje zestaw na wariancie, platforma przysyła składniki w grupie.' },
            { id: 'n3', label: 'Cin7', value: 'Nazwane ustawienia na karcie każdej integracji. Brak mapowania zatrzymuje zamówienie zamiast zaksięgować je źle.' },
            { id: 'n4', label: 'BaseLinker', value: 'Integracje nic nie deklarują. Operator wiąże oferty ręcznie, a ustawienia rabatów są inne w każdej integracji.' },
            { id: 'n5', label: 'Apilo, Sellasist', value: 'Wszystko na poziomie katalogu: oferta powiązana z produktem-zestawem, rozbicie w OMS. Rabaty jednym przełącznikiem per integracja.' },
            { id: 'n6', label: 'Brightpearl', value: 'Rozbicie przy zapisie zamówienia, takie samo dla każdego kanału. Cała cena na zestawie, składniki 0 zł.' },
          ]}
        />
      </DetailSection>
    </PageLayout>
  );
}

function ScopeTab(): ReactElement {
  return (
    <PageLayout
      eyebrow="Plan"
      title="Zakres, D3 i issue"
      description="Szkic. Na GitHubie nic nie zmieniono."
    >
      <DetailSection title="Poprawki do D3">
        <List
          items={[
            { id: 'D3a', text: 'Cena "w zestawie" dla każdego składnika, z ostrzeżeniem, gdy przekracza zwykłą cenę składnika.' },
            { id: 'D3b', text: 'Rozpoznawanie kształtów zestawu z kanału przez pola linii, bez importu definicji.' },
            { id: 'D3c', text: 'Tożsamość składnika w całym przepływie (fulfilmentLineId).' },
            { id: 'D3d', text: 'Stan samego zestawu z mastera jest ignorowany; zestaw nigdy nie schodzi ze stanu jako on sam.' },
            { id: 'D3e', text: 'Nie zwalniamy rezerwacji składników przy tworzeniu zamówienia, chyba że sklep zadeklaruje to per linia.' },
            { id: 'D3f', text: 'Jedna sztuka zestawu w jednej paczce; bez zagnieżdżania; skład zamrożony przy przyjęciu.' },
            { id: 'D3g', text: 'Dokument: zestaw jako 1 linia albo składniki; przy różnych stawkach domyślnie składniki.' },
          ]}
        />
      </DetailSection>
      <DetailSection title="Kolejność prac">
        <List
          items={[
            { id: '0', text: 'Naprawa dziś: Allegro productSet i Shoper children rezerwują 1 sztukę.' },
            { id: '1', text: 'Fundament: tożsamość składnika i pola linii (composition, commercial).' },
            { id: '2', text: 'Zestawy (G15): definicja, dostępność, rozbicie, pakowanie, dokumenty, zwroty.' },
            { id: '3', text: 'Gratisy (G20): linia z ceną katalogową, dodanie przez operatora i regułę, brak gratisu, dokumenty.' },
            { id: '4', text: 'Deklaracje adapterów: dokumenty, stan zestawu w masterze, efekt stanu per linia.' },
          ]}
        />
      </DetailSection>
      <DetailSection title="Pytania do Ciebie">
        <List
          items={[
            { id: 'Q1', text: 'Dwa "reportery" źródła zamówień, czy same pola trzystanowe?' },
            { id: 'Q2', text: 'Czy "0,01 zł = gratis" tylko z reguły operatora?' },
            { id: 'Q3', text: 'Czy zestaw w pilocie musi być wariantem z mastera, a zestaw tylko w OL później?' },
            { id: 'Q4', text: 'Czy komplety Subiekta (gotowe, ze stanem) wchodzą w pilot?' },
            { id: 'Q5', text: 'Gratis dodany przez OL a sklep bez OMS: czy dopisujemy linię w sklepie (OrderLineAdder)?' },
          ]}
        />
      </DetailSection>
    </PageLayout>
  );
}

function Placeholder({ title }: { title: string }): ReactElement {
  return (
    <PageLayout eyebrow="UX" title={title} description="This screen is designed after the standard is agreed.">
      <EmptyState eyebrow="Next step" title="Not designed yet" message="We build this screen once the scope and the standard are approved." />
    </PageLayout>
  );
}

export function App(): ReactElement {
  const [tab, setTab] = useState<string>(readHash);
  const agreement = useMemo(() => {
    const c = compare([...BUNDLE_MATRIX, ...GIFT_MATRIX]);
    return `${Math.round((c.same / c.cells) * 100)}%`;
  }, []);

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
        <TabsContent value="podsumowanie"><Summary agreement={agreement} /></TabsContent>
        <TabsContent value="standard"><StandardTab /></TabsContent>
        <TabsContent value="rundy"><RoundsTab /></TabsContent>
        <TabsContent value="kod"><CodeTab /></TabsContent>
        <TabsContent value="konkurencja"><CompetitionTab /></TabsContent>
        <TabsContent value="zakres"><ScopeTab /></TabsContent>
        {TABS.filter((t) => t.id.startsWith('ux-')).map((t) => (
          <TabsContent key={t.id} value={t.id}><Placeholder title={t.label} /></TabsContent>
        ))}
      </Tabs>
    </main>
  );
}
