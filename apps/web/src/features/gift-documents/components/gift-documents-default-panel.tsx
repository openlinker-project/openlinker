/**
 * GiftDocumentsDefaultPanel (#3941)
 *
 * The OpenLinker-wide gift form on documents, on Settings > Sales documents:
 * the lowest of three levels (the gift, the channel, this default). Saves
 * through `PUT /sales-documents/settings`. A read-only role sees the same card
 * with a notice and no save.
 *
 * @module apps/web/src/features/gift-documents/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useDemoMode } from '../../system';
import {
  useDocumentProvidersQuery,
  useGiftDocumentSettingsQuery,
} from '../hooks/use-gift-documents-queries';
import { useSaveGiftDocumentDefault } from '../hooks/use-save-gift-documents';
import type { GiftDocumentFormChoice } from '../lib/gift-lines';
import { zeroAvailability } from '../lib/zero-availability';
import { GiftFormExampleTable } from './gift-form-example-table';
import { GiftFormOptions, type GiftFormOptionValue } from './gift-form-options';
import { GiftFormPreview } from './gift-form-preview';

export function GiftDocumentsDefaultPanel(): ReactElement {
  const copy = useMessages('gift-documents');
  const settingsQuery = useGiftDocumentSettingsQuery();
  const providersQuery = useDocumentProvidersQuery();
  const save = useSaveGiftDocumentDefault();
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const canEdit = write.canWrite;
  const [draft, setDraft] = useState<GiftDocumentFormChoice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (draft === null && settingsQuery.data) setDraft(settingsQuery.data.giftDocumentForm);
  }, [draft, settingsQuery.data]);

  if (settingsQuery.isLoading) {
    return (
      <div className="panel panel--dense" aria-busy="true">
        <LoadingState liveRegion="off" title={copy.default.loading} message="" />
      </div>
    );
  }
  if (settingsQuery.error || !settingsQuery.data || draft === null) {
    return (
      <div className="panel panel--dense">
        <ErrorState
          title={copy.default.loadFailed}
          message={settingsQuery.error?.message ?? ''}
        />
      </div>
    );
  }

  const saved = settingsQuery.data.giftDocumentForm;
  const zero = zeroAvailability(providersQuery.data?.providers);
  const zeroReason = zero.available
    ? null
    : zero.refusingProviderName
      ? interpolate(copy.connection.zeroNotOffered, { provider: zero.refusingProviderName })
      : copy.connection.zeroNoProvider;

  async function handleSave(): Promise<void> {
    if (draft === null) return;
    setError(null);
    setNotice(null);
    try {
      await save.mutateAsync(draft);
      setNotice(copy.default.saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.default.saveFailed);
    }
  }

  return (
    <div className="panel panel--dense gift-form-panel" data-testid="doc-gift-set-card">
      <h3 className="section-title" data-testid="doc-gift-set-title">
        {copy.default.title}
      </h3>
      {!canEdit ? (
        <Alert tone="info" data-testid="doc-gift-set-readonly-notice">
          {copy.default.readOnlyNotice}
        </Alert>
      ) : null}
      <p className="muted-text" data-testid="doc-gift-set-bundle-info">
        {copy.default.bundleInfo}
      </p>
      <div className="form-field" data-testid="doc-gift-set-default-field">
        <span className="form-field__label">{copy.default.fieldLabel}</span>
        <GiftFormOptions
          name="gift-form-default"
          value={draft}
          onChange={(next: GiftFormOptionValue) => {
            if (next !== 'inherit') setDraft(next);
          }}
          zeroAvailable={zero.available}
          zeroReason={zeroReason}
          disabled={!canEdit}
        />
        <p className="form-field__description">{copy.default.fieldHelp}</p>
      </div>
      <p className="muted-text" data-testid="doc-gift-set-levels">
        {copy.default.levels}
      </p>
      <p className="muted-text">{copy.default.taxNote}</p>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? (
        <Alert tone="error" title={copy.default.saveFailed}>
          {error}
        </Alert>
      ) : null}
      <div>
        <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
          <Button
            disabled={!canEdit || save.isPending || draft === saved}
            onClick={() => void handleSave()}
            data-testid="doc-gift-set-save"
          >
            {copy.default.save}
          </Button>
        </ReadOnlyLock>
      </div>
      <GiftFormExampleTable />
      <GiftFormPreview form={draft} zeroAccepted={zero.available} />
    </div>
  );
}
