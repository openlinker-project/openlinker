/**
 * DensityToggle — operator-cockpit row-height switch (#775).
 *
 * Persists to localStorage under `openlinker-density` and writes
 * `<html data-density="...">` so `.data-table` (and any future
 * density-aware primitive) inherits without per-page wiring. Two
 * options: `cozy` (default, matches existing row heights) and
 * `compact` (tighter rows for dense ops tables).
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';

export type Density = 'cozy' | 'compact';

const STORAGE_KEY = 'openlinker-density';

function readPersisted(): Density {
  if (typeof window === 'undefined') return 'cozy';
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === 'compact' ? 'compact' : 'cozy';
}

function applyDensity(density: Density): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.density = density;
}

export function useDensity(): [Density, (next: Density) => void] {
  const [density, setDensityState] = useState<Density>(() => readPersisted());

  useEffect(() => {
    applyDensity(density);
  }, [density]);

  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage unavailable — density still applies in-session.
    }
  }, []);

  return [density, setDensity];
}

export function DensityToggle(): ReactElement {
  const [density, setDensity] = useDensity();
  return (
    <div className="density-toggle" role="group" aria-label="Row density">
      <button
        type="button"
        className={`density-toggle__option ${density === 'cozy' ? 'is-active' : ''}`}
        onClick={() => setDensity('cozy')}
        aria-pressed={density === 'cozy'}
        aria-label="Cozy density"
        title="Cozy density"
      >
        <span className="density-toggle__icon" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
            <line x1="2" y1="3" x2="10" y2="3" />
            <line x1="2" y1="6" x2="10" y2="6" />
            <line x1="2" y1="9" x2="10" y2="9" />
          </svg>
        </span>
      </button>
      <button
        type="button"
        className={`density-toggle__option ${density === 'compact' ? 'is-active' : ''}`}
        onClick={() => setDensity('compact')}
        aria-pressed={density === 'compact'}
        aria-label="Compact density"
        title="Compact density"
      >
        <span className="density-toggle__icon" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
            <line x1="2" y1="2.5" x2="10" y2="2.5" />
            <line x1="2" y1="4.5" x2="10" y2="4.5" />
            <line x1="2" y1="6.5" x2="10" y2="6.5" />
            <line x1="2" y1="8.5" x2="10" y2="8.5" />
            <line x1="2" y1="10.5" x2="10" y2="10.5" />
          </svg>
        </span>
      </button>
    </div>
  );
}
