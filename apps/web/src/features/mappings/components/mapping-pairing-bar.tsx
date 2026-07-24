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

import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import { usePlatforms } from '../../../shared/plugins';
import type { Connection } from '../../connections';
import type { MappingPairing } from '../hooks/use-mapping-pairing.types';
import { resolvePlatformLabel } from '../lib/platform-label';

/** Id of the pick-source select, so the page can focus it from the empty state (#1784 I5). */
export const MAPPING_SOURCE_PICKER_ID = 'mapping-pairing-source-select';

interface MappingPairingBarProps {
  pairing: MappingPairing;
  /**
   * Called with the chosen source connection id in the ambiguous (pick-source)
   * case. Optional - the read-only states (`ready` / `unsupported` / `no-source`)
   * never invoke it, so those call sites can omit it (#1784 follow-up S18).
   */
  onPickSource?: (connectionId: string) => void;
}

function initials(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length === 0) return '?';
  return trimmed.slice(0, 2).toUpperCase();
}

/** Tokened lock glyph replacing the raw emoji (#1784 follow-up S12). */
function LockGlyph(): ReactElement {
  return (
    <svg
      className="mapping-pair__lock"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3 5.5V4a3 3 0 0 1 6 0v1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <rect x="2.5" y="5.5" width="7" height="4.5" rx="1" fill="currentColor" />
    </svg>
  );
}

export function MappingPairingBar({ pairing, onPickSource }: MappingPairingBarProps): ReactElement | null {
  const platforms = usePlatforms();
  const [selectedSourceId, setSelectedSourceId] = useState('');

  function labelFor(connection: Connection): string {
    return resolvePlatformLabel(platforms, connection);
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
            <div className="mapping-pair__picker">
              <Select
                id={MAPPING_SOURCE_PICKER_ID}
                aria-label="Choose marketplace to configure"
                value={selectedSourceId}
                onChange={(e) => {
                  setSelectedSourceId(e.target.value);
                }}
              >
                <option value="" disabled>
                  Choose a marketplace…
                </option>
                {pairing.candidates.map((c) => {
                  const isDisabled = c.status !== 'active';
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name} ({labelFor(c)}){isDisabled ? ' - disabled' : ''}
                    </option>
                  );
                })}
              </Select>
              <Button
                tone="primary"
                disabled={selectedSourceId.length === 0}
                onClick={() => {
                  if (selectedSourceId) onPickSource?.(selectedSourceId);
                }}
              >
                Configure
              </Button>
            </div>
          </div>
          {connector()}
          {destNode(pairing.master)}
        </div>
        <p className="mapping-pair__meta">
          {pairing.candidates.length} marketplaces are paired with {pairing.master.name}. Pick one and
          select Configure.
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
          <LockGlyph />
          Determined by connection pairing.{' '}
          <Link to={`/connections/${source.id}/edit`}>Change pairing</Link>
        </p>
      ) : (
        <p className="mapping-pair__meta">
          <LockGlyph />
          Pairing is set on the connection.
        </p>
      )}
    </div>
  );
}
