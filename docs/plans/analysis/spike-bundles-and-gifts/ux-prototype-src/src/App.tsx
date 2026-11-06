/**
 * Prototype frame: the real OpenLinker shell (shell-* classes), a sidebar of
 * prototype screens, the screen itself, and a guidance panel with the state
 * switcher. Hash: #screen/state.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button } from '@web/shared/ui/button';
import { Select } from '@web/shared/ui/select';
import { SegmentedControl } from '@web/shared/ui/segmented-control';
import { StatusBadge } from '@web/shared/ui/status-badge';
import { AccessDeniedState, EmptyState, ErrorState, LoadingState } from '@web/shared/ui/feedback-state';
import { DataTableSkeleton } from '@web/shared/ui/data-table-skeleton';
import { ProtoContext, type NavGroup, type ProtoGlobals, type Role, type ScreenDef } from './proto';
import { Switch } from './ui/marks';
import { SCREENS } from './views';

// Lets the verification crawler visit every state without parsing the source.
(window as unknown as { __PROTO_STATES__: string[] }).__PROTO_STATES__ = SCREENS.flatMap((s) => s.states.map((st) => `${s.id}/${st.id}`));

const GROUP_ORDER: NavGroup[] = ['Start', 'Sprzedaż', 'Katalog', 'Magazyn', 'Dokumenty', 'Analityka', 'Ustawienia'];
const PRIORITY_LABEL = { stage0: 'Etap 0', pilot: 'Pilot', later: 'Później', out: 'Poza zakresem' } as const;
const PRIORITY_TONE = { stage0: 'error', pilot: 'warning', later: 'neutral', out: 'neutral' } as const;

function parseHash(): { screen: string; state: string } {
  const raw = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
  const [screen, state] = raw.split('/');
  const def = SCREENS.find((s) => s.id === screen) ?? SCREENS[0];
  const st = def.states.find((s) => s.id === state) ?? def.states[0];
  return { screen: def.id, state: st?.id ?? '' };
}

function writeHash(screen: string, state: string): void {
  try {
    history.replaceState(null, '', `#${screen}/${state}`);
  } catch {
    /* hash is a convenience only */
  }
}

function setTheme(mode: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', mode);
  document.documentElement.dataset.themeExplicit = '1';
}

function FrameState({ screen, kind }: { screen: ScreenDef; kind: 'loading' | 'error' | 'empty' }): ReactElement {
  if (kind === 'loading') {
    return (
      <div className="proto-common">
        <LoadingState title={`Wczytywanie: ${screen.label}`} message="Pobieramy dane z OpenLinkera. Szkielet tabeli pokazuje, gdzie pojawią się wiersze, więc ekran nie skacze po wczytaniu." />
        <DataTableSkeleton columns={5} rows={6} />
      </div>
    );
  }
  if (kind === 'error') {
    return (
      <div className="proto-common">
        <ErrorState
          title="Nie udało się wczytać danych"
          message="Serwer nie odpowiedział w czasie. Sprawdź połączenie i spróbuj ponownie. Jeśli błąd wraca, zgłoś go z identyfikatorem żądania req_7f3a."
          action={<Button tone="secondary">Spróbuj ponownie</Button>}
        />
      </div>
    );
  }
  const st = screen.states.find((s) => s.kind === 'empty');
  return (
    <div className="proto-common">
      <EmptyState title={`${screen.label}: nic tu jeszcze nie ma`} message={st?.note ?? ''} action={<Button>Zacznij</Button>} />
    </div>
  );
}

export function App(): ReactElement {
  const [loc, setLoc] = useState(parseHash);
  const [globals, setGlobals] = useState<ProtoGlobals>({ oms: true, currency: 'PLN', role: 'admin' });
  const [notesOpen, setNotesOpen] = useState(true);
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark');

  useEffect(() => {
    const onHash = (): void => setLoc(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((screen: string, state?: string) => {
    const def = SCREENS.find((s) => s.id === screen) ?? SCREENS[0];
    const st = def.states.find((s) => s.id === state) ?? def.states[0];
    writeHash(def.id, st.id);
    setLoc({ screen: def.id, state: st.id });
    document.querySelector('.shell-content')?.scrollTo?.({ top: 0 });
    window.scrollTo?.({ top: 0 });
  }, []);

  const screen = SCREENS.find((s) => s.id === loc.screen) ?? SCREENS[0];
  const state = screen.states.find((s) => s.id === loc.state) ?? screen.states[0];
  const ctx = useMemo(
    () => ({ ...globals, set: (p: Partial<ProtoGlobals>) => setGlobals((g) => ({ ...g, ...p })), go, screen: screen.id, state: state.id }),
    [globals, go, screen.id, state.id],
  );

  const groups = GROUP_ORDER.map((g) => ({ g, items: SCREENS.filter((s) => s.group === g) })).filter((x) => x.items.length);
  const packerBlocked = globals.role === 'packer' && !['bench', 'guide', 'catalog'].includes(screen.id);

  return (
    <ProtoContext.Provider value={ctx}>
      <div className="proto-bar" role="region" aria-label="Ustawienia prototypu">
        <span className="proto-bar__title">Zestawy i gratisy · prototyp</span>
        <label className="proto-bar__screen">
          <span className="spike-sr">Ekran</span>
          <Select value={screen.id} onChange={(e) => go(e.target.value)}>
            {groups.map(({ g, items }) => (
              <optgroup key={g} label={g}>
                {items.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </label>
        <Switch checked={globals.oms} onChange={(v) => ctx.set({ oms: v })} label={globals.oms ? 'OMS włączony' : 'OMS wyłączony'} hint="OMS włączony: OpenLinker pakuje i zdejmuje stan. Wyłączony: zamówienie trafia do sklepu, który zdejmuje stan sam." />
        <SegmentedControl
          aria-label="Waluta zamówienia"
          options={[{ value: 'PLN', label: 'PLN' }, { value: 'EUR', label: 'EUR' }]}
          value={globals.currency}
          onChange={(v) => ctx.set({ currency: v as ProtoGlobals['currency'] })}
        />
        <label className="proto-bar__role">
          <span>Rola</span>
          <Select value={globals.role} onChange={(e) => ctx.set({ role: e.target.value as Role })}>
            <option value="admin">Administrator</option>
            <option value="viewer">Tylko odczyt</option>
            <option value="packer">Pakowacz</option>
          </Select>
        </label>
        <Switch
          checked={dark}
          onChange={(v) => {
            setDark(v);
            setTheme(v ? 'dark' : 'light');
          }}
          label="Ciemny motyw"
        />
      </div>

      <div className="shell proto-shell">
        <div className="shell-sidebar">
          <div className="shell-brand">
            <span className="shell-brand__mark proto-brand-mark" aria-hidden="true">OL</span>
            <span className="shell-brand__name">OpenLinker</span>
          </div>
          <nav className="shell-nav" aria-label="Ekrany prototypu">
            {groups.map(({ g, items }) => (
              <section key={g} className="shell-nav__group">
                <p className="shell-nav__label">{g}</p>
                <ul className="shell-nav__list">
                  {items.map((s) => (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}/${s.states[0].id}`}
                        className={s.id === screen.id ? 'shell-nav__link shell-nav__link--active' : 'shell-nav__link'}
                        aria-current={s.id === screen.id ? 'page' : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          go(s.id);
                        }}
                      >
                        <span className="shell-nav__link-label">{s.label}</span>
                        <span className="shell-nav__link-count mono-text">{s.states.filter((x) => !x.kind).length}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>
        </div>

        <div className="shell-main">
          <div className={`proto-stage${notesOpen ? '' : ' proto-stage--wide'}`}>
            <main className="shell-content proto-content" data-screen={screen.id} data-state={state.id}>
              {packerBlocked ? (
                <AccessDeniedState
                  title="Ten ekran nie jest dla pakowacza"
                  message="Pakowacz widzi tylko stanowisko pakowania. Koszty, promocje i ustawienia są ukryte."
                  action={<Button onClick={() => go('bench')}>Przejdź do stanowiska pakowania</Button>}
                />
              ) : state.kind && state.kind !== 'scenario' ? (
                <FrameState screen={screen} kind={state.kind} />
              ) : (
                screen.render(state.id)
              )}
            </main>

            <aside className={`proto-notes${notesOpen ? '' : ' proto-notes--closed'}`} aria-label="Co się tu dzieje">
              <button type="button" className="proto-notes__toggle" aria-expanded={notesOpen} onClick={() => setNotesOpen((o) => !o)}>
                {notesOpen ? 'Zwiń opis' : 'Co się tu dzieje'}
              </button>
              {notesOpen ? (
                <>
                  <h2 className="proto-notes__title">{state.label}</h2>
                  <p className="proto-notes__body">{state.note}</p>
                  <div className="proto-notes__meta">
                    <StatusBadge tone={PRIORITY_TONE[state.priority]} compact>{PRIORITY_LABEL[state.priority]}</StatusBadge>
                    {state.useCases.map((u) => (
                      <a key={u} className="proto-uc" href="#catalog/all" onClick={(e) => { e.preventDefault(); go('catalog', 'all'); }} title="Przypadek użycia ze spike'u">
                        {u}
                      </a>
                    ))}
                    {state.channels?.map((c) => (
                      <span key={c} className="proto-chan">{c}</span>
                    ))}
                  </div>
                  <h3 className="proto-notes__sub">Stany tego ekranu</h3>
                  <ul className="proto-states">
                    {screen.states.map((s) => (
                      <li key={s.id}>
                        <a
                          href={`#${screen.id}/${s.id}`}
                          className={`proto-states__item${s.id === state.id ? ' proto-states__item--active' : ''}${s.kind ? ' proto-states__item--common' : ''}`}
                          aria-current={s.id === state.id ? 'true' : undefined}
                          onClick={(e) => {
                            e.preventDefault();
                            go(screen.id, s.id);
                          }}
                        >
                          {s.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </aside>
          </div>
        </div>
      </div>
    </ProtoContext.Provider>
  );
}
