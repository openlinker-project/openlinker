/**
 * SettingsFactsBar (#4154)
 *
 * The installation facts an operator wants before touching anything (which
 * environment, which build, which API, who is signed in), set as one tidy bar
 * of labelled cells instead of loose lines. Quiet surface; the only emphasis is
 * the values themselves.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';

export interface SettingsFact {
  id: string;
  label: string;
  value: ReactNode;
  /** Set the value in a monospace face (addresses). */
  mono?: boolean;
  /** Gets two columns of the bar (a long address). */
  wide?: boolean;
  /** A quiet second line (an email under a username). */
  note?: ReactNode;
}

export function SettingsFactsBar({ facts }: { facts: readonly SettingsFact[] }): ReactElement {
  return (
    <dl className="settings-facts">
      {facts.map((fact) => (
        <div className="settings-facts__cell" key={fact.id} data-wide={fact.wide || undefined}>
          <dt>{fact.label}</dt>
          <dd data-mono={fact.mono || undefined}>{fact.value}</dd>
          {fact.note ? <dd className="settings-facts__note">{fact.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
