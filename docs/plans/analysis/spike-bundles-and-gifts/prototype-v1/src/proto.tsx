/**
 * Prototype frame contract: global switches (OMS, currency, role), the screen and
 * state registry types, and small helpers every view uses.
 */
import { createContext, useCallback, useContext, type ReactElement, type ReactNode } from 'react';
import { useFormat } from '@web/shared/i18n/use-format';

export type Role = 'admin' | 'viewer' | 'packer';
export type Currency = 'PLN' | 'EUR';

export interface ProtoGlobals {
  oms: boolean;
  currency: Currency;
  role: Role;
}

export interface ProtoContextValue extends ProtoGlobals {
  set: (patch: Partial<ProtoGlobals>) => void;
  /** Navigate to another screen/state, e.g. go('order', 'gift-ol-only'). */
  go: (screen: string, state?: string) => void;
  screen: string;
  state: string;
}

export const ProtoContext = createContext<ProtoContextValue | null>(null);

export function useProto(): ProtoContextValue {
  const ctx = useContext(ProtoContext);
  if (!ctx) throw new Error('useProto outside ProtoContext');
  return ctx;
}

/** Use-case priority from the spike, shown in the state catalogue. */
export type Priority = 'stage0' | 'pilot' | 'later' | 'out';

export interface StateDef {
  /** Stable id, used in the hash and as data-state. */
  id: string;
  /** Short Polish label for the state switcher. */
  label: string;
  /** Polish guidance: what is happening and why (1-4 sentences). */
  note: string;
  /** Spike use-case ids this state demonstrates, e.g. ['G-04', 'B-23']. */
  useCases: string[];
  priority: Priority;
  channels?: string[];
  /** Shared states rendered by the frame. */
  kind?: 'scenario' | 'loading' | 'error' | 'empty';
}

export type NavGroup = 'Start' | 'Sprzedaż' | 'Katalog' | 'Magazyn' | 'Dokumenty' | 'Analityka' | 'Ustawienia';

export interface ScreenDef {
  id: string;
  group: NavGroup;
  /** Sidebar label (Polish). */
  label: string;
  states: StateDef[];
  render: (state: string) => ReactElement;
}

/** Loading, error and empty states every data screen offers. The frame renders them. */
export function commonStates(what: string, emptyCta: string): StateDef[] {
  return [
    { id: 'loading', label: 'Ładowanie', note: `Dane ${what} się wczytują. Ekran pokazuje szkielet, a nie pustą listę.`, useCases: [], priority: 'pilot', kind: 'loading' },
    { id: 'error', label: 'Błąd wczytania', note: `Nie udało się wczytać ${what}. Komunikat mówi, co zrobić, i daje ponowienie.`, useCases: [], priority: 'pilot', kind: 'error' },
    { id: 'empty', label: 'Pusto', note: `Nie ma jeszcze ${what}. Pusty ekran zaprasza do pierwszego kroku: ${emptyCta}.`, useCases: [], priority: 'pilot', kind: 'empty' },
  ];
}

/** Grosze to formatted money in the active locale. */
export function useMoney(): (grosze: number | null | undefined, currency?: Currency) => string {
  const fmt = useFormat();
  const { currency: global } = useProto();
  return useCallback(
    (grosze, currency) => (grosze === null || grosze === undefined ? '-' : fmt.money(grosze / 100, currency ?? global)),
    [fmt, global],
  );
}

/** EUR prototype rate: 1 EUR = 4.2500 PLN (NBP table A, illustrative). */
export const EUR_RATE = 4.25;

/** Button disabled for viewers with the reason in its title. Use for every write action. */
export function useWriteGuard(): { canWrite: boolean; reason: string | undefined } {
  const { role } = useProto();
  return role === 'admin' ? { canWrite: true, reason: undefined } : { canWrite: false, reason: 'Masz dostęp tylko do odczytu. Zmiany wymagają roli administratora lub operatora.' };
}

export function Note({ children }: { children: ReactNode }): ReactElement {
  return <p className="proto-inline-note">{children}</p>;
}
