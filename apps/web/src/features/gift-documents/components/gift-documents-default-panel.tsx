/**
 * GiftDocumentsDefaultPanel
 *
 * The OpenLinker-wide gift form on documents, as the "Gifts on documents"
 * section of Settings > Sales documents: five cards with a live document each,
 * the note on what providers accept, the order of settings drawn as a diagram,
 * and a sticky bar that offers undo and save while there is something to save.
 * Saves through `PUT /sales-documents/settings`. A read-only role sees the same
 * cards, greyed, with a notice and no bar.
 *
 * @module apps/web/src/features/gift-documents/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { HelpHint } from '../../../shared/ui/help-hint';
import { SaveButton, type SaveButtonState } from '../../../shared/ui/save-button';
import { StickyActionBar } from '../../../shared/ui/sticky-action-bar';
import { useToast } from '../../../shared/ui/toast-provider';
import { useDemoMode } from '../../system';
import {
  useDocumentProvidersQuery,
  useGiftDocumentSettingsQuery,
} from '../hooks/use-gift-documents-queries';
import { useSaveGiftDocumentDefault } from '../hooks/use-save-gift-documents';
import type { DocumentProviderZeroSupport } from '../api/gift-documents.types';
import {
  isGiftUnitPriceAmount,
  parseGiftUnitPrice,
  type GiftDocumentFormChoice,
} from '../lib/gift-lines';
import { GiftDocumentFormCards, type GiftDocumentCardValue } from './gift-document-form-cards';
import { GiftPrecedence } from './gift-precedence';

const SAVED_HOLD_MS = 1600;

function ProviderNote({
  providers,
}: {
  providers: readonly DocumentProviderZeroSupport[];
}): ReactElement | null {
  const copy = useMessages('gift-documents').settings;
  const format = useFormat();
  const accepting = providers.filter((p) => p.acceptsZeroValueLine === true).map((p) => p.name);
  const refusing = providers.filter((p) => p.acceptsZeroValueLine === false);
  if (refusing.length === 0) return null;
  const kinds = new Set(refusing.map((p) => p.kind));
  const documents =
    kinds.size > 1
      ? copy.documentsMixed
      : kinds.has('fiscal-receipt')
        ? copy.documentsReceipts
        : copy.documentsInvoices;
  const refusingNames = refusing.map((p) => p.name);
  return (
    <div className="gift-note gift-note--warn" data-testid="gift-provider-note">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.2" />
        <path d="M8 7.2V11M8 5v.1" />
      </svg>
      <span>
        <b>{copy.providerNoteLead}</b>{' '}
        {accepting.length === 0
          ? null
          : accepting.length === 1
            ? interpolate(copy.acceptingOne, { provider: accepting[0] })
            : interpolate(copy.acceptingMany, { providers: format.list(accepting) })}{' '}
        {refusingNames.length === 1
          ? interpolate(copy.refusingOne, { provider: refusingNames[0], documents })
          : interpolate(copy.refusingMany, { providers: format.list(refusingNames), documents })}
      </span>
    </div>
  );
}

export function GiftDocumentsDefaultPanel(): ReactElement {
  const copy = useMessages('gift-documents');
  const format = useFormat();
  const settingsQuery = useGiftDocumentSettingsQuery();
  const providersQuery = useDocumentProvidersQuery();
  const save = useSaveGiftDocumentDefault();
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const canEdit = write.canWrite;
  const [draftForm, setDraftForm] = useState<GiftDocumentFormChoice | null>(null);
  const [draftAmount, setDraftAmount] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveButtonState>('idle');
  const [live, setLive] = useState('');
  const resetTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  if (settingsQuery.isLoading) {
    return (
      <div className="gift-settings__card" aria-busy="true">
        <LoadingState liveRegion="off" title={copy.default.loading} message="" />
      </div>
    );
  }
  if (settingsQuery.error || !settingsQuery.data) {
    return (
      <div className="gift-settings__card">
        <ErrorState title={copy.default.loadFailed} message={settingsQuery.error?.message ?? ''} />
      </div>
    );
  }

  const savedForm = settingsQuery.data.giftDocumentForm;
  const savedAmount = settingsQuery.data.giftDocumentUnitPrice ?? null;
  const two = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  const savedAmountText = savedAmount === null ? null : format.number(Number(savedAmount), two);
  const form = draftForm ?? savedForm;
  const amount = draftAmount ?? savedAmountText ?? format.number(2.5, two);
  const parsedAmount = parseGiftUnitPrice(amount);
  const amountInvalid = form === 'custom-price' && parsedAmount === null;
  const amountChanged =
    form === 'custom-price' &&
    parsedAmount !== null &&
    (savedAmount === null || Number(savedAmount) !== parsedAmount);
  const dirty = form !== savedForm || amountChanged;
  const providers = providersQuery.data?.providers;

  function discard(): void {
    setDraftForm(null);
    setDraftAmount(null);
  }

  async function handleSave(): Promise<void> {
    if (amountInvalid || !dirty) return;
    const unitPrice =
      form === 'custom-price' && parsedAmount !== null ? parsedAmount.toFixed(2) : undefined;
    if (unitPrice !== undefined && !isGiftUnitPriceAmount(unitPrice)) return;
    setSaveState('saving');
    setLive(copy.settings.saving);
    try {
      await save.mutateAsync({ form, unitPrice });
      setSaveState('saved');
      setLive(copy.settings.savedLive);
      discard();
      resetTimer.current = window.setTimeout(() => setSaveState('idle'), SAVED_HOLD_MS);
    } catch (error) {
      setSaveState('idle');
      setLive('');
      showToast({
        tone: 'error',
        title: copy.default.saveFailed,
        description: error instanceof Error ? error.message : '',
      });
    }
  }

  return (
    <section className="gift-settings" id="s-gifts" aria-labelledby="gift-settings-title">
      <div className="gift-section__head">
        <h2 id="gift-settings-title" data-testid="doc-gift-set-title">
          {copy.settings.sectionTitle}
        </h2>
        <p>{copy.settings.sectionLead}</p>
      </div>
      <div className="gift-settings__card" data-testid="doc-gift-set-card">
        {!canEdit ? (
          <Alert tone="info" data-testid="doc-gift-set-readonly-notice">
            {copy.default.readOnlyNotice}
          </Alert>
        ) : null}
        <div className="form-field" data-testid="doc-gift-set-default-field">
          <span className="gift-label-row">
            <span className="form-field__label">{copy.settings.fieldLabel}</span>
            <HelpHint guide="g-form" label={copy.settings.helpForm} />
          </span>
          <p className="form-field__description">{copy.settings.fieldHelp}</p>
          <GiftDocumentFormCards
            name="gift-form-default"
            aria-label={copy.settings.fieldLabel}
            value={form}
            onChange={(next: GiftDocumentCardValue) => {
              if (next !== 'inherit') setDraftForm(next);
            }}
            customPrice={amount}
            onCustomPriceChange={setDraftAmount}
            invalidPrice={amountInvalid}
            disabled={!canEdit}
          />
        </div>

        {providers === undefined ? null : <ProviderNote providers={providers} />}

        <GiftPrecedence />

        <div className="gift-card" data-testid="doc-gift-set-bundle-info">
          <h3>{copy.settings.bundleTitle}</h3>
          <p>{copy.settings.bundleText}</p>
        </div>
        <p className="form-field__description" data-testid="doc-gift-set-tax-note">
          {copy.settings.taxNote}
        </p>
      </div>

      {write.visible ? (
        <StickyActionBar
          visible={dirty || saveState !== 'idle'}
          message={copy.settings.barMessage}
          aria-label={copy.settings.barAria}
        >
          <Button
            tone="secondary"
            className="button--sm"
            disabled={saveState !== 'idle'}
            onClick={discard}
            data-testid="doc-gift-set-undo"
          >
            {copy.settings.undo}
          </Button>
          <SaveButton
            state={saveState}
            labels={{
              idle: copy.settings.save,
              saving: copy.settings.saving,
              saved: copy.settings.saved,
            }}
            disabled={!canEdit || amountInvalid || (!dirty && saveState === 'idle')}
            onClick={() => void handleSave()}
            data-testid="doc-gift-set-save"
          />
        </StickyActionBar>
      ) : null}
      <span className="sr-only" role="status">
        {live}
      </span>
    </section>
  );
}
