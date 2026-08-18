/**
 * Sales-Document Country Selector (#2170, mockup tab 02)
 *
 * Country-agnostic by construction: the mechanism is usable by hand for ANY
 * country, so this is a free-text ISO 3166-1 alpha-2 input rather than a
 * closed dropdown — plus two fixed quick-picks, `★ Rest of world` (the
 * fallback tier every install eventually needs) and `PL` (the one country
 * with a curated starter template today). There is no backend "list every
 * configured country" endpoint in this slice, so this control cannot show
 * "Germany — not configured" the way the mockup's illustrative `<select>`
 * does; an operator instead types the code and the page below renders the
 * per-country empty state honestly when nothing exists yet.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import { useState, type ReactElement } from 'react';
import { Input } from '../../../shared/ui/input';
import { Button } from '../../../shared/ui/button';
import { SALES_DOCUMENT_REST_OF_WORLD_COUNTRY } from '../api/sales-document-rules.types';

interface SalesDocumentCountrySelectorProps {
  country: string;
  onChange: (country: string) => void;
}

const QUICK_PICKS: readonly { code: string; label: string }[] = [
  { code: 'PL', label: 'Poland' },
  { code: SALES_DOCUMENT_REST_OF_WORLD_COUNTRY, label: '★ Rest of world' },
];

export function SalesDocumentCountrySelector({
  country,
  onChange,
}: SalesDocumentCountrySelectorProps): ReactElement {
  const [draft, setDraft] = useState(country);

  function submitDraft(): void {
    const normalized = draft.trim().toUpperCase();
    if (normalized.length === 0) return;
    onChange(normalized === '*'.toUpperCase() ? SALES_DOCUMENT_REST_OF_WORLD_COUNTRY : normalized);
  }

  return (
    <div className="page-section sales-document-country-selector">
      <label className="eyebrow" htmlFor="sales-document-country-input">
        Country
      </label>
      <div className="sales-document-country-selector__row">
        {QUICK_PICKS.map((pick) => (
          <button
            key={pick.code}
            type="button"
            className={[
              'chip',
              country === pick.code ? 'chip--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => {
              setDraft(pick.code);
              onChange(pick.code);
            }}
          >
            {pick.label}
          </button>
        ))}
      </div>
      <div className="sales-document-country-selector__row">
        <Input
          id="sales-document-country-input"
          value={draft}
          placeholder="e.g. DE"
          maxLength={8}
          aria-label="Country ISO code"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitDraft();
          }}
        />
        <Button tone="secondary" className="button--sm" onClick={submitDraft}>
          Go
        </Button>
      </div>
      <p className="muted-text">
        Type any ISO 3166-1 alpha-2 country code — the rule-building mechanism is fully
        country-agnostic. <span className="mono-text">★ Rest of world</span> is a real
        pseudo-country an operator configures explicitly, not an automatic mapping.
      </p>
    </div>
  );
}
