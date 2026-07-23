/**
 * MappingPairingBar (#1784)
 *
 * The pairing route strip shown under the Mapping Configuration page title.
 * Renders the resolved source -> destination pair as two platform nodes joined
 * by a directional connector. The source node becomes a picker only when the
 * pairing is ambiguous (opened from a master shop with several paired
 * marketplaces); otherwise both sides are read-only, since the pair is
 * config-stamped on the marketplace connection.
 *
 * Presentational only - resolution lives in `useMappingPairing`.
 *
 * @module apps/web/src/features/mappings/components
 */

import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Select } from '../../../shared/ui/select';
import { usePlatforms } from '../../../shared/plugins';
import type { Connection } from '../../connections';
import type { MappingPairing } from '../hooks/use-mapping-pairing.types';

interface MappingPairingBarProps {
  pairing: MappingPairing;
  /** Called with the chosen source connection id in the ambiguous (pick-source) case. */
  onPickSource: (connectionId: string) => void;
}

function initials(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length === 0) return '?';
  return trimmed.slice(0, 2).toUpperCase();
}

export function MappingPairingBar({ pairing, onPickSource }: MappingPairingBarProps): ReactElement | null {
  const platforms = usePlatforms();

  function labelFor(connection: Connection): string {
    return platforms.find((p) => p.platformType === connection.platformType)?.displayName ?? connection.platformType;
  }

  function chip(connection: Connection, variant: 'source' | 'dest'): ReactElement {
    const platformLabel = labelFor(connection);
    return (
      <span className={`mapping-pair__chip mapping-pair__chip--${variant}`}>
        <span className="mapping-pair__glyph" aria-hidden="true">
          {initials(platformLabel)}
        </span>
        <span className="mapping-pair__chip-text">
          <span className="mapping-pair__name">{connection.name}</span>
          <span className="mapping-pair__platform">{platformLabel}</span>
        </span>
      </span>
    );
  }

  function connector(): ReactElement {
    return (
      <div className="mapping-pair__connector" aria-hidden="true">
        <span className="mapping-pair__arrow">→</span>
      </div>
    );
  }

  function destNode(connection: Connection): ReactElement {
    return (
      <div className="mapping-pair__node mapping-pair__node--dest">
        <span className="mapping-pair__role">Destination</span>
        {chip(connection, 'dest')}
      </div>
    );
  }

  if (pairing.status === 'loading' || pairing.status === 'error') {
    return null;
  }

  if (pairing.status === 'pick-source') {
    return (
      <div className="mapping-pair" role="group" aria-label="Connection pairing">
        <div className="mapping-pair__row">
          <div className="mapping-pair__node">
            <span className="mapping-pair__role">Source</span>
            <Select
              aria-label="Choose marketplace to configure"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) onPickSource(e.target.value);
              }}
            >
              <option value="" disabled>
                Choose a marketplace…
              </option>
              {pairing.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({labelFor(c)})
                </option>
              ))}
            </Select>
          </div>
          {connector()}
          {destNode(pairing.master)}
        </div>
        <p className="mapping-pair__meta">
          {pairing.candidates.length} marketplaces are paired with {pairing.master.name}. Pick one to
          configure its mappings.
        </p>
      </div>
    );
  }

  if (pairing.status === 'no-source') {
    return (
      <div className="mapping-pair" role="group" aria-label="Connection pairing">
        <div className="mapping-pair__row">
          <div className="mapping-pair__node">
            <span className="mapping-pair__role">Source</span>
            <span className="mapping-pair__chip mapping-pair__chip--empty">No marketplace paired</span>
          </div>
          {connector()}
          {destNode(pairing.master)}
        </div>
        <p className="mapping-pair__meta">Pairing is set on the marketplace connection.</p>
      </div>
    );
  }

  // ready | unsupported - both render a fixed, read-only pair.
  const source = pairing.source;
  const destination = pairing.destination;

  return (
    <div className="mapping-pair" role="group" aria-label="Connection pairing">
      <div className="mapping-pair__row">
        <div className="mapping-pair__node">
          <span className="mapping-pair__role">Source</span>
          {chip(source, 'source')}
        </div>
        {connector()}
        {destination ? (
          destNode(destination)
        ) : (
          <div className="mapping-pair__node mapping-pair__node--dest">
            <span className="mapping-pair__role">Destination</span>
            <span className="mapping-pair__chip mapping-pair__chip--empty">Not linked</span>
          </div>
        )}
      </div>
      {pairing.status === 'ready' ? (
        <p className="mapping-pair__meta">
          <span className="mapping-pair__lock" aria-hidden="true">
            🔒
          </span>
          Determined by connection pairing.{' '}
          <Link to={`/connections/${source.id}/edit`}>Change pairing</Link>
        </p>
      ) : (
        <p className="mapping-pair__meta">
          <span className="mapping-pair__lock" aria-hidden="true">
            🔒
          </span>
          Pairing is set on the connection.
        </p>
      )}
    </div>
  );
}
