/**
 * AttributeRulesPanel
 *
 * Operator editor for attribute mapping rules (#1841): author fixed /
 * copy-remap / place-value rules, scoped (source connection / category /
 * manufacturer / phrase) and sequenced by priority. Rules feed
 * `AttributeProjectionService` and fill destination attributes across products
 * on both offer and shop-publish paths.
 *
 * @module apps/web/src/features/mappings/components
 */

import { useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import {
  AttributeRuleKindValues,
  PlaceValueSourceValues,
  type AttributeRule,
  type AttributeRuleKind,
  type AttributeRuleValueRemap,
  type PlaceValueSource,
  type UpsertAttributeRulePayload,
} from '../api/mappings.types';
import {
  useAttributeRulesQuery,
  useUpsertAttributeRule,
  useDeleteAttributeRule,
} from '../hooks/use-attribute-rules';

const KIND_LABELS: Record<AttributeRuleKind, string> = {
  fixed: 'Fixed value',
  'copy-remap': 'Copy + value remap',
  'place-value': 'Place value',
};

const PLACE_VALUE_LABELS: Record<PlaceValueSource, string> = {
  name: 'Product name',
  variant: 'Variant name',
  manufacturer: 'Manufacturer',
  ean: 'EAN / barcode',
  sku: 'SKU',
  weight: 'Weight',
};

/** Parse "36S=36, S=Small" into value-remap pairs (best-effort, MVP). */
function parseValueRemap(raw: string): AttributeRuleValueRemap[] {
  return raw
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf('=');
      if (idx < 0) return null;
      return {
        sourceValue: line.slice(0, idx).trim(),
        destinationValue: line.slice(idx + 1).trim(),
      };
    })
    .filter((v): v is AttributeRuleValueRemap => v !== null && v.sourceValue !== '');
}

function summariseRule(rule: AttributeRule): string {
  switch (rule.kind) {
    case 'fixed':
      return `= "${rule.fixedValue ?? ''}"`;
    case 'copy-remap': {
      const count = rule.valueRemap?.length ?? 0;
      return `copy "${rule.sourceAttributeKey ?? ''}"${count > 0 ? ` (${count} remap${count === 1 ? '' : 's'})` : ''}`;
    }
    case 'place-value':
      return `from ${rule.placeValueSource ? PLACE_VALUE_LABELS[rule.placeValueSource] : '?'}`;
  }
}

function summariseScope(rule: AttributeRule): string {
  const parts: string[] = [];
  if (rule.destinationCategoryId) parts.push(`category ${rule.destinationCategoryId}`);
  if (rule.manufacturerMatch) parts.push(`mfr "${rule.manufacturerMatch}"`);
  if (rule.phraseMatch) parts.push(`name~"${rule.phraseMatch}"`);
  if (rule.sourceConnectionId) parts.push('source-scoped');
  return parts.length > 0 ? parts.join(', ') : 'all products';
}

interface AttributeRulesPanelProps {
  connectionId: string;
}

export function AttributeRulesPanel({ connectionId }: AttributeRulesPanelProps): ReactElement {
  const rulesQuery = useAttributeRulesQuery(connectionId);
  const upsert = useUpsertAttributeRule(connectionId);
  const del = useDeleteAttributeRule(connectionId);

  const [kind, setKind] = useState<AttributeRuleKind>('fixed');
  const [destinationParameterName, setDestinationParameterName] = useState('');
  const [priority, setPriority] = useState('0');
  const [fixedValue, setFixedValue] = useState('');
  const [sourceAttributeKey, setSourceAttributeKey] = useState('');
  const [valueRemapRaw, setValueRemapRaw] = useState('');
  const [placeValueSource, setPlaceValueSource] = useState<PlaceValueSource>('name');
  const [destinationCategoryId, setDestinationCategoryId] = useState('');
  const [manufacturerMatch, setManufacturerMatch] = useState('');
  const [phraseMatch, setPhraseMatch] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  function resetForm(): void {
    setDestinationParameterName('');
    setFixedValue('');
    setSourceAttributeKey('');
    setValueRemapRaw('');
    setDestinationCategoryId('');
    setManufacturerMatch('');
    setPhraseMatch('');
    setPriority('0');
  }

  function handleAdd(): void {
    setFormError(null);
    if (!destinationParameterName.trim()) {
      setFormError('Destination attribute name is required.');
      return;
    }
    const payload: UpsertAttributeRulePayload = {
      destinationParameterName: destinationParameterName.trim(),
      kind,
      priority: Number.parseInt(priority, 10) || 0,
      destinationCategoryId: destinationCategoryId.trim() || null,
      manufacturerMatch: manufacturerMatch.trim() || null,
      phraseMatch: phraseMatch.trim() || null,
    };
    if (kind === 'fixed') {
      payload.fixedValue = fixedValue;
    } else if (kind === 'copy-remap') {
      if (!sourceAttributeKey.trim()) {
        setFormError('Source attribute key is required for a copy + remap rule.');
        return;
      }
      payload.sourceAttributeKey = sourceAttributeKey.trim();
      payload.valueRemap = parseValueRemap(valueRemapRaw);
    } else {
      payload.placeValueSource = placeValueSource;
    }
    upsert.mutate(payload, { onSuccess: resetForm });
  }

  if (rulesQuery.isLoading) {
    return (
      <LoadingState liveRegion="off" title="Loading attribute rules" message="Fetching configured rules…" />
    );
  }
  if (rulesQuery.error) {
    return <ErrorState title="Unable to load attribute rules" message={rulesQuery.error.message} />;
  }

  const rules = rulesQuery.data ?? [];

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Configuration</p>
          <h3 className="section-title">Attribute Mapping Rules</h3>
        </div>
      </div>

      <p className="muted-text" style={{ marginBottom: '1rem' }}>
        Deterministic, operator-authored rules that fill destination attributes across products.
        Rules apply in priority order (lower first); a later rule wins for the same attribute and
        rules override the base attribute mapping.
      </p>

      {rules.length === 0 ? (
        <p className="muted-text" role="status" aria-live="polite">
          No rules configured yet. Add one below to auto-fill destination attributes.
        </p>
      ) : (
        <table className="data-table" aria-label="Attribute mapping rules">
          <thead>
            <tr>
              <th>Priority</th>
              <th>Attribute</th>
              <th>Kind</th>
              <th>Fills</th>
              <th>Scope</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td className="tabular">{rule.priority}</td>
                <td>{rule.destinationParameterName}</td>
                <td>{KIND_LABELS[rule.kind]}</td>
                <td>{summariseRule(rule)}</td>
                <td className="muted-text">{summariseScope(rule)}</td>
                <td>
                  <Button
                    tone="ghost"
                    aria-label={`Remove rule for ${rule.destinationParameterName}`}
                    disabled={del.isPending}
                    onClick={() => {
                      del.mutate(rule.id);
                    }}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add rule form */}
      <div className="toolbar" style={{ marginTop: '1rem', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span className="eyebrow">Kind</span>
          <select
            aria-label="Rule kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as AttributeRuleKind);
            }}
          >
            {AttributeRuleKindValues.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span className="eyebrow">Destination attribute</span>
          <input
            aria-label="Destination attribute name"
            value={destinationParameterName}
            onChange={(e) => {
              setDestinationParameterName(e.target.value);
            }}
            placeholder="e.g. Marka"
          />
        </label>

        {kind === 'fixed' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span className="eyebrow">Fixed value</span>
            <input
              aria-label="Fixed value"
              value={fixedValue}
              onChange={(e) => {
                setFixedValue(e.target.value);
              }}
            />
          </label>
        )}

        {kind === 'copy-remap' && (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span className="eyebrow">Source attribute</span>
              <input
                aria-label="Source attribute key"
                value={sourceAttributeKey}
                onChange={(e) => {
                  setSourceAttributeKey(e.target.value);
                }}
                placeholder="e.g. Size"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span className="eyebrow">Value remap (src=dest)</span>
              <input
                aria-label="Value remap"
                value={valueRemapRaw}
                onChange={(e) => {
                  setValueRemapRaw(e.target.value);
                }}
                placeholder="36S=36, 38S=38"
              />
            </label>
          </>
        )}

        {kind === 'place-value' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span className="eyebrow">Source metadata</span>
            <select
              aria-label="Place-value source"
              value={placeValueSource}
              onChange={(e) => {
                setPlaceValueSource(e.target.value as PlaceValueSource);
              }}
            >
              {PlaceValueSourceValues.map((s) => (
                <option key={s} value={s}>
                  {PLACE_VALUE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span className="eyebrow">Priority</span>
          <input
            aria-label="Priority"
            type="number"
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value);
            }}
            style={{ width: '5rem' }}
          />
        </label>
      </div>

      {/* Scope row */}
      <div className="toolbar" style={{ marginTop: '0.5rem', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span className="eyebrow">Category id (optional)</span>
          <input
            aria-label="Destination category id scope"
            value={destinationCategoryId}
            onChange={(e) => {
              setDestinationCategoryId(e.target.value);
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span className="eyebrow">Manufacturer (optional)</span>
          <input
            aria-label="Manufacturer scope"
            value={manufacturerMatch}
            onChange={(e) => {
              setManufacturerMatch(e.target.value);
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span className="eyebrow">Name contains (optional)</span>
          <input
            aria-label="Product name phrase scope"
            value={phraseMatch}
            onChange={(e) => {
              setPhraseMatch(e.target.value);
            }}
          />
        </label>

        <Button tone="secondary" disabled={upsert.isPending} onClick={handleAdd}>
          {upsert.isPending ? 'Adding…' : 'Add rule'}
        </Button>
      </div>

      {formError && (
        <p className="error-message" role="alert" style={{ marginTop: '0.5rem' }}>
          {formError}
        </p>
      )}
      {upsert.error && (
        <p className="error-message" role="alert" style={{ marginTop: '0.5rem' }}>
          {upsert.error.message}
        </p>
      )}
      {del.error && (
        <p className="error-message" role="alert" style={{ marginTop: '0.5rem' }}>
          {del.error.message}
        </p>
      )}
    </div>
  );
}
