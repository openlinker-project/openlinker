/**
 * GiftsOnDocumentsPanel (#3941)
 *
 * The "Gifts on documents" tab of the connection mappings page: this channel's
 * OVERRIDE of the gift form on documents (`config.giftOnDocuments`), defaulting
 * to "As in OpenLinker". The most specific level wins: the gift itself, then
 * this override, then the OpenLinker-wide default.
 *
 * Self-contained like `DeliveryOnDocumentsPanel`: it owns its queries and its
 * save, and reports an unsaved selection through `onDirtyChange` for the
 * page's tab guard. A read-only role sees the same card with a notice.
 *
 * @module apps/web/src/features/gift-documents/components
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useToast } from '../../../shared/ui/toast-provider';
import { useConnectionQuery } from '../../connections';
import { useDemoMode } from '../../system';
import {
  useDocumentProvidersQuery,
  useGiftDocumentSettingsQuery,
} from '../hooks/use-gift-documents-queries';
import { useSaveGiftOnDocuments } from '../hooks/use-save-gift-documents';
import { readGiftConnectionOverride } from '../lib/gift-on-documents-config';
import { DEFAULT_GIFT_LINE_FORM, type GiftDocumentFormChoice } from '../lib/gift-lines';
import { zeroAvailability } from '../lib/zero-availability';
import { GiftFormOptions, type GiftFormOptionValue } from './gift-form-options';
import { GiftFormPreview } from './gift-form-preview';

interface GiftsOnDocumentsPanelProps {
  /** The order-source connection whose config this tab edits. */
  connectionId: string;
  onDirtyChange?: (dirty: boolean) => void;
}

export function GiftsOnDocumentsPanel({
  connectionId,
  onDirtyChange,
}: GiftsOnDocumentsPanelProps): ReactElement {
  const copy = useMessages('gift-documents');
  const connectionQuery = useConnectionQuery(connectionId);
  const settingsQuery = useGiftDocumentSettingsQuery();
  const providersQuery = useDocumentProvidersQuery();
  const { save, isPending } = useSaveGiftOnDocuments();
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const canEdit = write.canWrite;

  const config = connectionQuery.data?.config;
  const saved: GiftFormOptionValue = useMemo(
    () => readGiftConnectionOverride(config) ?? 'inherit',
    [config],
  );
  const [draft, setDraft] = useState<GiftFormOptionValue | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const value = draft ?? saved;
  const dirty = value !== saved;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  if (connectionQuery.isLoading) {
    return (
      <div className="panel panel--dense gift-form-panel" aria-busy="true">
        <LoadingState
          liveRegion="off"
          title={copy.connection.loading}
          message={copy.connection.loadingMessage}
        />
      </div>
    );
  }
  if (connectionQuery.error || !connectionQuery.data) {
    return (
      <div className="panel panel--dense gift-form-panel">
        <ErrorState
          title={copy.connection.loadFailed}
          message={connectionQuery.error?.message ?? copy.connection.loadFailedMessage}
        />
      </div>
    );
  }

  // Until the OpenLinker-wide setting has been read, "as in OpenLinker" names no
  // form: claiming the built-in default would state a setting nobody read.
  const settingKnown = settingsQuery.data !== undefined;
  const inherited: GiftDocumentFormChoice =
    settingsQuery.data?.giftDocumentForm ?? (DEFAULT_GIFT_LINE_FORM as GiftDocumentFormChoice);
  const effective: GiftDocumentFormChoice = value === 'inherit' ? inherited : value;
  const zero = zeroAvailability(providersQuery.data?.providers);
  const zeroReason = zero.available
    ? null
    : zero.refusingProviderName
      ? interpolate(copy.connection.zeroNotOffered, { provider: zero.refusingProviderName })
      : copy.connection.zeroNoProvider;

  async function handleSave(): Promise<void> {
    try {
      await save(connectionId, value === 'inherit' ? null : value);
      setDraft(null);
      setNotice(copy.default.saved);
    } catch (error) {
      showToast({
        tone: 'error',
        title: copy.default.saveFailed,
        description: error instanceof Error ? error.message : '',
      });
    }
  }

  return (
    <div className="panel panel--dense gift-form-panel" data-testid="doc-gift-set-card">
      <h3 className="section-title" data-testid="doc-gift-set-title">
        {copy.connection.title}
      </h3>
      {!write.canWrite ? (
        <Alert tone="info" data-testid="doc-gift-set-readonly-notice">
          {copy.connection.readOnlyNotice}
        </Alert>
      ) : null}
      <div className="form-field" data-testid="doc-gift-set-connection-field">
        <span className="form-field__label">{copy.connection.fieldLabel}</span>
        <GiftFormOptions
          name="gift-form-connection"
          value={value}
          onChange={(next) => {
            setNotice(null);
            setDraft(next);
          }}
          inheritedForm={settingKnown ? inherited : undefined}
          inheritedUnknown={!settingKnown}
          zeroAvailable={zero.available}
          zeroReason={zeroReason}
          disabled={!canEdit}
        />
        <p className="form-field__description">{copy.connection.fieldHelp}</p>
      </div>
      {zeroReason ? (
        <p className="muted-text" data-testid="doc-gift-set-zero-note">
          {zeroReason}
        </p>
      ) : null}
      <p className="muted-text" data-testid="doc-gift-set-levels">
        {copy.default.levels}
      </p>
      <p className="muted-text">{copy.default.taxNote}</p>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {write.visible ? (
        <div>
          <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
            <Button
              disabled={!canEdit || isPending || !dirty}
              onClick={() => void handleSave()}
              data-testid="doc-gift-set-save"
            >
              {copy.default.save}
            </Button>
          </ReadOnlyLock>
        </div>
      ) : null}
      {value === 'inherit' && !settingKnown ? null : (
        <GiftFormPreview form={effective} zeroAccepted={zero.available} />
      )}
    </div>
  );
}
