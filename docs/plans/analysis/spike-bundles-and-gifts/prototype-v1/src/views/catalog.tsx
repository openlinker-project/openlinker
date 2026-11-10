/**
 * State catalogue: every screen state with a link, filterable, plus a coverage
 * check that every spike use case (except out-of-scope ones) has a state.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { PageLayout } from '@web/shared/ui/page-layout';
import { DetailSection } from '@web/shared/ui/detail-section';
import { MetricCard } from '@web/shared/ui/metric-card';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { Input } from '@web/shared/ui/input';
import { Select } from '@web/shared/ui/select';
import { useProto, type Priority, type ScreenDef } from '../proto';
import { SCREENS } from './index';
import ucB from '../uc/bundles.json';
import ucG from '../uc/gifts.json';
import ucX from '../uc/cross.json';
import './gd.css';

interface UseCase {
  id: string;
  name: string;
  priority: Priority;
}

const USE_CASES: UseCase[] = (() => {
  const m = new Map<string, UseCase>();
  for (const u of [...(ucB as UseCase[]), ...(ucG as UseCase[]), ...(ucX as UseCase[])]) m.set(u.id, { id: u.id, name: u.name.replace(/^NEW\s+/, '').replace(/`/g, ''), priority: u.priority });
  return [...m.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
})();

/** Left out of the prototype on purpose (plan: "Poza zakresem"), with the reason. */
const PROTO_OUT: Record<string, string> = {
  'B-06': 'Żaden kanał pilota nie wysyła samych składników bez rodzica (to kształt Shopify i IdoSell).',
  'B-09': 'Zestaw z wyborem wariantu przez kupującego to funkcja na później.',
  'B-13': 'Pilot ma jeden magazyn.',
  'B-21': 'W jednym magazynie zestaw nie dzieli się na paczki; paczka nie zamknie się bez składnika.',
  'B-25': 'Waga i wymiary zestawu nie zmieniają ekranów zestawów i gratisów.',
};

const PRIORITY_LABEL: Record<Priority, string> = { stage0: 'Etap 0', pilot: 'Pilot', later: 'Później', out: 'Poza zakresem' };
const PRIORITY_TONE = { stage0: 'error', pilot: 'warning', later: 'neutral', out: 'neutral' } as const;

function Catalog({ onlyGaps }: { onlyGaps?: boolean }): ReactElement {
  const { go } = useProto();
  const [scr, setScr] = useState('all');
  const [prio, setPrio] = useState('all');
  const [q, setQ] = useState('');

  const rows = useMemo(
    () =>
      SCREENS.flatMap((s: ScreenDef) => s.states.filter((st) => !st.kind).map((st) => ({ screen: s, st })))
        .filter(({ screen }) => screen.id !== 'catalog'),
    [],
  );
  const covered = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const { screen, st } of rows) for (const u of st.useCases) m.set(u, [...(m.get(u) ?? []), `${screen.label}: ${st.label}`]);
    return m;
  }, [rows]);
  const inScope = USE_CASES.filter((u) => u.priority !== 'out' && !PROTO_OUT[u.id]);
  const gaps = inScope.filter((u) => !covered.has(u.id));
  const deliberate = USE_CASES.filter((u) => PROTO_OUT[u.id]);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    ({ screen, st }) =>
      (scr === 'all' || screen.id === scr) &&
      (prio === 'all' || st.priority === prio) &&
      (!needle || `${st.label} ${st.note} ${st.useCases.join(' ')} ${(st.channels ?? []).join(' ')}`.toLowerCase().includes(needle)),
  );

  return (
    <PageLayout
      eyebrow="Katalog"
      title="Wszystkie stany prototypu"
      description="Każdy ekran i każdy jego stan w jednym miejscu. Kliknij nazwę, żeby otworzyć stan. Na dole: które przypadki użycia ze spike'u mają swój stan."
    >
      <div className="spike-metrics proto-metrics">
        <MetricCard label="Stany" value={String(rows.length)} description={`na ${SCREENS.length - 1} ekranach, bez ładowania, błędu i pustego`} />
        <MetricCard label="Przypadki użycia z ekranem" value={`${inScope.length - gaps.length} z ${inScope.length}`} tone={gaps.length ? 'warning' : 'success'} description="bez przypadków poza zakresem" />
        <MetricCard label="Bez ekranu" value={String(gaps.length)} tone={gaps.length ? 'error' : 'success'} />
      </div>

      {!onlyGaps ? (
        <>
          <div className="gd-cat-filters">
            <label className="gd-cat-filter">
              <span>Ekran</span>
              <Select value={scr} onChange={(e) => setScr(e.target.value)}>
                <option value="all">Wszystkie</option>
                {SCREENS.filter((s) => s.id !== 'catalog').map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </Select>
            </label>
            <label className="gd-cat-filter">
              <span>Priorytet</span>
              <Select value={prio} onChange={(e) => setPrio(e.target.value)}>
                <option value="all">Wszystkie</option>
                {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </Select>
            </label>
            <label className="gd-cat-filter gd-cat-filter--grow">
              <span>Szukaj</span>
              <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="np. Allegro, G-10, paragon" />
            </label>
          </div>
          <p className="proto-inline-note" aria-live="polite">Pokazano {shown.length} z {rows.length}.</p>
          <div className="data-table__container" tabIndex={0} aria-label="Lista stanów">
            <table className="data-table gd-cat-table">
              <thead>
                <tr>
                  <th scope="col">Stan</th>
                  <th scope="col">Ekran</th>
                  <th scope="col">Priorytet</th>
                  <th scope="col">Przypadki użycia</th>
                  <th scope="col">Co pokazuje</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ screen, st }) => (
                  <tr key={`${screen.id}/${st.id}`}>
                    <th scope="row">
                      <button type="button" className="gd-cat-link" onClick={() => go(screen.id, st.id)}>{st.label}</button>
                    </th>
                    <td>{screen.label}</td>
                    <td><StatusBadge tone={PRIORITY_TONE[st.priority]} compact>{PRIORITY_LABEL[st.priority]}</StatusBadge></td>
                    <td>{st.useCases.map((u) => <span key={u} className="gd-uc">{u}</span>)}</td>
                    <td className="gd-cat-note">{st.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <DetailSection title={gaps.length ? `Przypadki użycia bez stanu (${gaps.length})` : 'Każdy przypadek użycia ma swój stan'}>
        {gaps.length ? (
          <ul className="proto-gaps">
            {gaps.map((u) => (
              <li key={u.id}><span className="gd-uc">{u.id}</span> {u.name} <StatusBadge tone={PRIORITY_TONE[u.priority]} compact>{PRIORITY_LABEL[u.priority]}</StatusBadge></li>
            ))}
          </ul>
        ) : (
          <p className="proto-inline-note">Wszystkie {inScope.length} przypadki w zakresie mają co najmniej jeden stan. Poza zakresem spike'u: {USE_CASES.filter((u) => u.priority === 'out').map((u) => u.id).join(', ')}.</p>
        )}
      </DetailSection>
      <DetailSection title={`Świadomie pominięte w prototypie (${deliberate.length})`}>
        <ul className="proto-gaps">
          {deliberate.map((u) => (
            <li key={u.id}><span className="gd-uc">{u.id}</span> {u.name}. <span className="proto-inline-note">{PROTO_OUT[u.id]}</span></li>
          ))}
        </ul>
      </DetailSection>
    </PageLayout>
  );
}

export const screen: ScreenDef = {
  id: 'catalog',
  group: 'Start',
  label: 'Katalog stanów',
  states: [
    { id: 'all', label: 'Wszystkie stany', note: 'Lista wszystkich stanów prototypu z filtrami. Każdy wiersz otwiera stan. Pokrycie przypadków użycia liczy się z danych, nie jest wpisane ręcznie.', useCases: [], priority: 'pilot' },
    { id: 'gaps', label: 'Pokrycie przypadków użycia', note: 'Które przypadki użycia ze spike\'u nie mają jeszcze żadnego stanu w prototypie.', useCases: [], priority: 'pilot' },
  ],
  render: (state) => <Catalog onlyGaps={state === 'gaps'} />,
};
