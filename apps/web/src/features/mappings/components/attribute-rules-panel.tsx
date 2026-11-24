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
import { interpolate, usePlural, useMessages, type Messages, type PluralFn } from '../../../shared/i18n';
import { describeApiError } from '../../../shared/api/describe-api-error';

type AttributeRulesCopy = Messages['mappings']['attributeRulesPanel'];

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

function summariseRule(rule: AttributeRule, copy: AttributeRulesCopy, plural: PluralFn): string {
  switch (rule.kind) {
    case 'fixed':
      return interpolate(copy.summary.fixed, { value: rule.fixedValue ?? '' });
    case 'copy-remap': {
      const count = rule.valueRemap?.length ?? 0;
      const key = rule.sourceAttributeKey ?? '';
      return count > 0
        ? plural(count, copy.summary.copyWithRemaps, { key })
        : interpolate(copy.summary.copy, { key });
    }
    case 'place-value':
      return interpolate(copy.summary.placeValue, {
        source: rule.placeValueSource ? copy.placeValueSources[rule.placeValueSource] : '?',
      });
  }
}

function summariseScope(rule: AttributeRule, copy: AttributeRulesCopy['scope']): string {
  const parts: string[] = [];
  if (rule.destinationCategoryId) {
    parts.push(interpolate(copy.category, { id: rule.destinationCategoryId }));
  }
  if (rule.manufacturerMatch) parts.push(interpolate(copy.manufacturer, { value: rule.manufacturerMatch }));
  if (rule.phraseMatch) parts.push(interpolate(copy.phrase, { value: rule.phraseMatch }));
  if (rule.sourceConnectionId) parts.push(copy.sourceScoped);
  return parts.length > 0 ? parts.join(', ') : copy.allProducts;
}

interface AttributeRulesPanelProps {
  connectionId: string;
}

export function AttributeRulesPanel({ connectionId }: AttributeRulesPanelProps): ReactElement {
  const rulesQuery = useAttributeRulesQuery(connectionId);
  const upsert = useUpsertAttributeRule(connectionId);
  const del = useDeleteAttributeRule(connectionId);
  const copy = useMessages('mappings').attributeRulesPanel;
  const plural = usePlural();

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
      setFormError(copy.errors.destinationRequired);
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
        setFormError(copy.errors.sourceRequired);
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
      <LoadingState liveRegion="off" title={copy.loading.title} message={copy.loading.message} />
    );
  }
  if (rulesQuery.error) {
    return <ErrorState title={copy.errorTitle} message={describeApiError(rulesQuery.error, 'mappings')} />;
  }

  const rules = rulesQuery.data ?? [];

  return (
    <div className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
      </div>

      <p className="muted-text" style={{ marginBottom: '1rem' }}>
        {copy.description}
      </p>

      {rules.length === 0 ? (
        <p className="muted-text" role="status" aria-live="polite">
          {copy.empty}
        </p>
      ) : (
        <table className="data-table" aria-label={copy.table.label}>
          <thead>
            <tr>
              <th>{copy.table.priority}</th>
              <th>{copy.table.attribute}</th>
              <th>{copy.table.kind}</th>
              <th>{copy.table.fills}</th>
              <th>{copy.table.scope}</th>
              <th aria-label={copy.table.actions} />
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td className="tabular">{rule.priority}</td>
                <td>{rule.destinationParameterName}</td>
                <td>{copy.kinds[rule.kind]}</td>
                <td>{summariseRule(rule, copy, plural)}</td>
                <td className="muted-text">{summariseScope(rule, copy.scope)}</td>
                <td>
                  <Button
                    tone="ghost"
                    aria-label={interpolate(copy.removeLabel, { attribute: rule.destinationParameterName })}
                    disabled={del.isPending}
                    onClick={() => {
                      del.mutate(rule.id);
                    }}
                  >
                    {copy.remove}
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
          <span className="eyebrow">{copy.form.kind}</span>
          <select
            aria-label={copy.form.kindLabel}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as AttributeRuleKind);
            }}
          >
            {AttributeRuleKindValues.map((k) => (
              <option key={k} value={k}>
                {copy.kinds[k]}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span className="eyebrow">{copy.form.destination}</span>
          <input
            aria-label={copy.form.destinationLabel}
            value={destinationParameterName}
            onChange={(e) => {
              setDestinationParameterName(e.target.value);
            }}
            placeholder={copy.form.destinationPlaceholder}
          />
        </label>

        {kind === 'fixed' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span className="eyebrow">{copy.form.fixedValue}</span>
            <input
              aria-label={copy.form.fixedValue}
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
              <span className="eyebrow">{copy.form.source}</span>
              <input
                aria-label={copy.form.sourceLabel}
                value={sourceAttributeKey}
                onChange={(e) => {
                  setSourceAttributeKey(e.target.value);
                }}
                placeholder={copy.form.sourcePlaceholder}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span className="eyebrow">{copy.form.remap}</span>
              <input
                aria-label={copy.form.remapLabel}
                value={valueRemapRaw}
                onChange={(e) => {
                  setValueRemapRaw(e.target.value);
                }}
                placeholder={copy.form.remapPlaceholder}
              />
            </label>
          </>
        )}

        {kind === 'place-value' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span className="eyebrow">{copy.form.placeValue}</span>
            <select
              aria-label={copy.form.placeValueLabel}
              value={placeValueSource}
              onChange={(e) => {
                setPlaceValueSource(e.target.value as PlaceValueSource);
              }}
            >
              {PlaceValueSourceValues.map((s) => (
                <option key={s} value={s}>
                  {copy.placeValueSources[s]}
                </option>
              ))}
            </select>
          </label>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span className="eyebrow">{copy.form.priority}</span>
          <input
            aria-label={copy.form.priority}
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
          <span className="eyebrow">{copy.form.category}</span>
          <input
            aria-label={copy.form.categoryLabel}
            value={destinationCategoryId}
            onChange={(e) => {
              setDestinationCategoryId(e.target.value);
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span className="eyebrow">{copy.form.manufacturer}</span>
          <input
            aria-label={copy.form.manufacturerLabel}
            value={manufacturerMatch}
            onChange={(e) => {
              setManufacturerMatch(e.target.value);
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span className="eyebrow">{copy.form.phrase}</span>
          <input
            aria-label={copy.form.phraseLabel}
            value={phraseMatch}
            onChange={(e) => {
              setPhraseMatch(e.target.value);
            }}
          />
        </label>

        <Button tone="secondary" disabled={upsert.isPending} onClick={handleAdd}>
          {upsert.isPending ? copy.form.adding : copy.form.add}
        </Button>
      </div>

      {formError && (
        <p className="error-message" role="alert" style={{ marginTop: '0.5rem' }}>
          {formError}
        </p>
      )}
      {upsert.error && (
        <p className="error-message" role="alert" style={{ marginTop: '0.5rem' }}>
          {describeApiError(upsert.error, 'mappings')}
        </p>
      )}
      {del.error && (
        <p className="error-message" role="alert" style={{ marginTop: '0.5rem' }}>
          {describeApiError(del.error, 'mappings')}
        </p>
      )}
    </div>
  );
}
