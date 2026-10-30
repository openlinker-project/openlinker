/**
 * DeliveryOnDocumentsPanel (#3908, ADR-079)
 *
 * The "Delivery on documents" tab of the connection mappings page: how
 * delivery appears on receipts and invoices, per buyer country. Edits
 * `config.deliveryOnDocuments` of the order-source connection. Self-contained
 * like `RoutingRulesPanel`: it owns its queries and its save, and reports
 * unsaved dialog edits through `onDirtyChange` for the page's tab guard.
 *
 * Every Save / Remove / "Use them" persists immediately through
 * fetch-fresh-then-merge. The suggestions and country facts are enrichment:
 * when either fails the table still renders from config.
 *
 * Ported from the approved mockup (docs/plans/mockups/delivery-on-documents.html).
 *
 * @module apps/web/src/features/delivery-on-documents/components
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useToast } from '../../../shared/ui/toast-provider';
import { useConnectionQuery } from '../../connections';
import { useMappingOptions } from '../../mappings';
import { useDemoMode } from '../../system';
import {
  useDeliveryCountryFactsQuery,
  useDeliveryLineSuggestionsQuery,
} from '../hooks/use-delivery-on-documents-queries';
import { useSaveDeliveryOnDocuments } from '../hooks/use-save-delivery-on-documents';
import { readDeliveryOnDocuments } from '../lib/delivery-line';
import {
  configFromRules,
  countryName,
  neutralSettings,
  rulesFromConfig,
  settingsFromSuggestion,
  type DeliveryFormSettings,
  type DeliveryRule,
} from '../lib/delivery-line-ui';
import { ExampleDocs } from './delivery-documents-preview';
import { DeliveryLineEditorDialog, type EditorTarget } from './delivery-line-editor-dialog';
import { DeliveryRulesTable } from './delivery-rules-table';

interface DeliveryOnDocumentsPanelProps {
  /** The order-source connection whose config this tab edits. */
  connectionId: string;
  onDirtyChange?: (dirty: boolean) => void;
}

const NOTICE_MS = 2800;
const METHOD_OPTION_KEYS = new Set<'allegroDeliveryMethods'>(['allegroDeliveryMethods']);

export function DeliveryOnDocumentsPanel({
  connectionId,
  onDirtyChange,
}: DeliveryOnDocumentsPanelProps): ReactElement {
  const connectionQuery = useConnectionQuery(connectionId);
  const suggestionsQuery = useDeliveryLineSuggestionsQuery();
  const factsQuery = useDeliveryCountryFactsQuery(connectionId);
  const { options } = useMappingOptions(connectionId, METHOD_OPTION_KEYS);
  const { save, isPending } = useSaveDeliveryOnDocuments();
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const canEdit = write.visible && !write.demoReadOnly;

  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const config = connectionQuery.data?.config;
  const rules = useMemo(() => rulesFromConfig(readDeliveryOnDocuments(config)), [config]);
  const suggestions = useMemo(
    () => suggestionsQuery.data?.suggestions ?? [],
    [suggestionsQuery.data],
  );
  const facts = useMemo(() => factsQuery.data?.countries ?? [], [factsQuery.data]);
  const factByCountry = useMemo(() => new Map(facts.map((f) => [f.country, f])), [facts]);

  if (connectionQuery.isLoading) {
    return (
      <div className="panel panel--dense dd-panel" aria-busy="true">
        <LoadingState
          liveRegion="off"
          title="Loading delivery settings"
          message="Fetching this connection."
        />
      </div>
    );
  }
  if (connectionQuery.error || !connectionQuery.data) {
    return (
      <div className="panel panel--dense dd-panel">
        <ErrorState
          title="Unable to load delivery settings"
          message={connectionQuery.error?.message ?? 'The connection could not be loaded.'}
        />
      </div>
    );
  }

  const listed = rules.map((r) => r.country);
  const strip =
    suggestions.find(
      (x) => !listed.includes(x.country) && (factByCountry.get(x.country)?.orders30d ?? 0) > 0,
    ) ?? null;

  async function persist(next: readonly DeliveryRule[], message: string): Promise<boolean> {
    try {
      await save(connectionId, configFromRules(next));
      setNotice(message);
      return true;
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Changes not saved',
        description:
          error instanceof Error ? error.message : 'The delivery settings could not be saved.',
      });
      return false;
    }
  }

  async function handleSave(country: string | null, settings: DeliveryFormSettings): Promise<void> {
    const next = rules.some((r) => r.country === country)
      ? rules.map((r) => (r.country === country ? { country, settings } : r))
      : [{ country, settings }, ...rules];
    const saved = await persist(
      next,
      country ? `${countryName(country)} saved.` : 'All other countries saved.',
    );
    if (saved) setEditing(null);
  }

  async function handleRemove(country: string): Promise<void> {
    const saved = await persist(
      rules.filter((r) => r.country !== country),
      `${countryName(country)} removed. Its orders now use "All other countries".`,
    );
    if (saved) setEditing(null);
  }

  return (
    <div className="panel panel--dense dd-panel">
      <div className="dd-panel__head">
        <div>
          <h3 className="section-title">Delivery on documents</h3>
          <p className="muted-text">
            How delivery appears on receipts and invoices, per buyer country.
          </p>
        </div>
        {write.visible ? (
          <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
            <Button
              tone="secondary"
              className="button--sm"
              disabled={!canEdit}
              onClick={() =>
                setEditing({ mode: 'add', country: null, settings: neutralSettings() })
              }
            >
              + Add a country
            </Button>
          </ReadOnlyLock>
        ) : null}
      </div>

      {notice ? (
        <div role="status" aria-live="polite">
          <Alert tone="success">{notice}</Alert>
        </div>
      ) : null}

      {strip && canEdit ? (
        <div className="dd-suggest">
          <span>
            <strong>Most of your orders go to {countryName(strip.country)}.</strong>{' '}
            <span className="muted-text">There are suggested settings for it.</span>
          </span>
          <span className="dd-inline">
            <Button
              tone="secondary"
              className="button--sm"
              onClick={() =>
                setEditing({
                  mode: 'edit',
                  country: strip.country,
                  settings: settingsFromSuggestion(strip),
                })
              }
            >
              Review
            </Button>
            <Button
              className="button--sm"
              disabled={isPending}
              onClick={() =>
                void persist(
                  [{ country: strip.country, settings: settingsFromSuggestion(strip) }, ...rules],
                  `${countryName(strip.country)} saved.`,
                )
              }
            >
              Use them
            </Button>
          </span>
        </div>
      ) : null}

      <DeliveryRulesTable
        rules={rules}
        facts={factByCountry}
        canEdit={canEdit}
        onEdit={(rule) =>
          setEditing({ mode: 'edit', country: rule.country, settings: rule.settings })
        }
      />
      <ExampleDocs rules={rules} facts={facts} />

      <DeliveryLineEditorDialog
        target={editing}
        rules={rules}
        facts={facts}
        suggestions={suggestions}
        deliveryMethods={options.allegroDeliveryMethods}
        busy={isPending}
        onClose={() => setEditing(null)}
        onSave={(country, settings) => void handleSave(country, settings)}
        onRemove={(country) => void handleRemove(country)}
        onDirtyChange={onDirtyChange}
      />
    </div>
  );
}
