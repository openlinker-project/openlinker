/**
 * GiftsOnDocumentsPanel
 *
 * The "Gifts on documents" tab of a connection: this channel's OVERRIDE of the
 * gift form on documents (`config.giftOnDocuments`), defaulting to "as in
 * settings". Two numbered cards (the choice, then who issues this channel's
 * documents, view only) and a side column saying what the gift ends up with and
 * what sits above this channel. The most specific level wins: the gift itself,
 * then this override, then the OpenLinker-wide default.
 *
 * Self-contained: it owns its queries and its save, and reports an unsaved
 * selection through `onDirtyChange` for the page's tab guard. A read-only role
 * sees the same cards with a notice.
 *
 * @module apps/web/src/features/gift-documents/components
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { HelpHint } from '../../../shared/ui/help-hint';
import { SaveButton, type SaveButtonState } from '../../../shared/ui/save-button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { StickyActionBar } from '../../../shared/ui/sticky-action-bar';
import { useToast } from '../../../shared/ui/toast-provider';
import { useConnectionQuery } from '../../connections';
import { useDemoMode } from '../../system';
import {
  useDocumentProvidersQuery,
  useGiftDocumentSettingsQuery,
} from '../hooks/use-gift-documents-queries';
import { useSaveGiftOnDocuments } from '../hooks/use-save-gift-documents';
import {
  readGiftConnectionOverride,
  readGiftConnectionUnitPrice,
} from '../lib/gift-on-documents-config';
import {
  DEFAULT_GIFT_LINE_FORM,
  parseGiftUnitPrice,
  type GiftDocumentFormChoice,
} from '../lib/gift-lines';
import { useGiftFormLabels } from '../lib/use-gift-form-labels';
import { GiftDocumentFormCards, type GiftDocumentCardValue } from './gift-document-form-cards';

/** A promotion that sets its own form for gifts of this channel. */
export interface OverridingGift {
  id: string;
  name: string;
  form: GiftDocumentFormChoice;
  /** Gross unit price, for `custom-price`. */
  unitPrice?: string;
}

interface GiftsOnDocumentsPanelProps {
  /** The order-source connection whose config this tab edits. */
  connectionId: string;
  onDirtyChange?: (dirty: boolean) => void;
  /** Promotions above this channel in the order of settings; the host page knows them. */
  overridingGifts?: readonly OverridingGift[];
}

const SAVED_HOLD_MS = 1600;

export function GiftsOnDocumentsPanel({
  connectionId,
  onDirtyChange,
  overridingGifts = [],
}: GiftsOnDocumentsPanelProps): ReactElement {
  const copy = useMessages('gift-documents');
  const tab = copy.connectionTab;
  const labels = useGiftFormLabels();
  const format = useFormat();
  const connectionQuery = useConnectionQuery(connectionId);
  const settingsQuery = useGiftDocumentSettingsQuery();
  const providersQuery = useDocumentProvidersQuery();
  const { save } = useSaveGiftOnDocuments();
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  const write = useWriteAccess('connections:write', demoMode);
  const canEdit = write.canWrite;

  const config = connectionQuery.data?.config;
  const savedValue: GiftDocumentCardValue = useMemo(
    () => readGiftConnectionOverride(config) ?? 'inherit',
    [config],
  );
  const savedAmount = useMemo(() => readGiftConnectionUnitPrice(config), [config]);
  const [draft, setDraft] = useState<GiftDocumentCardValue | null>(null);
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

  const two = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  const value = draft ?? savedValue;
  const amount =
    draftAmount ?? (savedAmount === null ? format.number(2.5, two) : format.number(Number(savedAmount), two));
  const parsed = parseGiftUnitPrice(amount);
  const amountInvalid = value === 'custom-price' && parsed === null;
  const amountChanged =
    value === 'custom-price' &&
    parsed !== null &&
    (savedAmount === null || Number(savedAmount) !== parsed);
  const dirty = value !== savedValue || amountChanged;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  if (connectionQuery.isLoading) {
    return (
      <div className="gift-conn" aria-busy="true">
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
      <div className="gift-conn">
        <ErrorState
          title={copy.connection.loadFailed}
          message={connectionQuery.error?.message ?? copy.connection.loadFailedMessage}
        />
      </div>
    );
  }

  // Until the OpenLinker-wide setting has been read, "as in settings" names no
  // form: claiming the built-in default would state a setting nobody read.
  const settingKnown = settingsQuery.data !== undefined;
  const inheritedForm: GiftDocumentFormChoice =
    settingsQuery.data?.giftDocumentForm ?? (DEFAULT_GIFT_LINE_FORM as GiftDocumentFormChoice);
  const inheritedAmount = settingsQuery.data?.giftDocumentUnitPrice ?? null;
  const providers = providersQuery.data?.providers ?? [];
  const effective: GiftDocumentFormChoice = value === 'inherit' ? inheritedForm : value;
  const effectiveText =
    effective === 'custom-price' && (value === 'inherit' ? inheritedAmount !== null : parsed !== null)
      ? `${labels.short(effective)} ${format.money(
          value === 'inherit' ? Number(inheritedAmount) : (parsed as number),
          'PLN',
        )}`
      : labels.short(effective);

  function discard(): void {
    setDraft(null);
    setDraftAmount(null);
  }

  async function handleSave(): Promise<void> {
    if (amountInvalid || !dirty) return;
    setSaveState('saving');
    setLive(tab.barMessage);
    try {
      await save(
        connectionId,
        value === 'inherit'
          ? null
          : {
              form: value,
              ...(value === 'custom-price' && parsed !== null ? { unitPrice: parsed.toFixed(2) } : {}),
            },
      );
      setSaveState('saved');
      setLive(tab.savedLive);
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
    <div className="gift-conn" data-testid="doc-gift-set-card">
      <div className="gift-conn__main">
        <section className="gift-conn__card" aria-labelledby="gift-conn-one">
          <div className="gift-conn__head">
            <span className="gift-conn__n">01</span>
            <h3 id="gift-conn-one" data-testid="doc-gift-set-title">
              {tab.sectionOneTitle}
            </h3>
            <span className="gift-conn__tag">{value === 'inherit' ? tab.tagInherit : tab.tagOwn}</span>
          </div>
          {!write.canWrite ? (
            <Alert tone="info" data-testid="doc-gift-set-readonly-notice">
              {copy.connection.readOnlyNotice}
            </Alert>
          ) : null}
          <div className="form-field" data-testid="doc-gift-set-connection-field">
            <span className="gift-label-row">
              <span className="form-field__label">{tab.fieldLabel}</span>
              <HelpHint guide="g-form" label={tab.helpForm} />
            </span>
            <p className="form-field__description">{tab.fieldHelp}</p>
            <GiftDocumentFormCards
              name="gift-form-connection"
              aria-label={tab.fieldLabel}
              value={value}
              onChange={(next) => {
                setLive('');
                setDraft(next);
              }}
              customPrice={amount}
              onCustomPriceChange={setDraftAmount}
              invalidPrice={amountInvalid}
              withInherit
              inheritedForm={settingKnown ? inheritedForm : null}
              inheritedCustomPrice={inheritedAmount}
              settingsHref="/settings/sales-documents"
              disabled={!canEdit}
            />
          </div>
        </section>

        <section className="gift-conn__card" aria-labelledby="gift-conn-two">
          <div className="gift-conn__head">
            <span className="gift-conn__n">02</span>
            <h3 id="gift-conn-two">{tab.sectionTwoTitle}</h3>
            <span className="gift-conn__tag">{tab.tagReadOnly}</span>
          </div>
          {providers.length === 0 ? (
            <p className="muted-text" data-testid="gift-conn-no-providers">
              {tab.noProviders}
            </p>
          ) : (
            <div className="gift-prov">
              {providers.map((provider) => (
                <div className="gift-prov__row" key={provider.connectionId}>
                  <span className="gift-prov__name">
                    {provider.name}
                    <small>{provider.kind === 'fiscal-receipt' ? tab.receipts : tab.invoices}</small>
                  </span>
                  <span className="gift-prov__text">
                    {provider.acceptsZeroValueLine === true
                      ? tab.providerAccepts
                      : provider.acceptsZeroValueLine === false
                        ? tab.providerRefuses
                        : tab.providerUnknown}
                  </span>
                  <StatusBadge
                    tone={
                      provider.acceptsZeroValueLine === true
                        ? 'success'
                        : provider.acceptsZeroValueLine === false
                          ? 'warning'
                          : 'neutral'
                    }
                    compact
                  >
                    {provider.acceptsZeroValueLine === true
                      ? tab.accepts
                      : provider.acceptsZeroValueLine === false
                        ? tab.refuses
                        : tab.unknown}
                  </StatusBadge>
                </div>
              ))}
            </div>
          )}
          <p className="form-field__description">
            {interpolate(tab.providersFooter, { link: '\u0000' })
              .split('\u0000')
              .flatMap((part, index) =>
                index === 0
                  ? [part]
                  : [
                      <Link key="l" className="link" to="/settings/sales-documents">
                        {tab.providersFooterLink}
                      </Link>,
                      part,
                    ],
              )}
          </p>
        </section>

        {write.visible ? (
          <StickyActionBar
            visible={dirty || saveState !== 'idle'}
            message={tab.barMessage}
            aria-label={tab.barMessage}
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
      </div>

      <aside className="gift-conn__aside">
        <div className="gift-card" data-testid="gift-conn-effective">
          <h3>{tab.asideForGiftTitle}</h3>
          <p>
            <b>{tab.asideForm}</b> {settingKnown || value !== 'inherit' ? effectiveText : '-'}
          </p>
          <span className="gift-card__source">
            {value === 'inherit' ? tab.asideSourceDefault : tab.asideSourceOwn}
          </span>
        </div>
        <div className="gift-card" data-testid="gift-conn-above">
          <h3>{tab.asideAboveTitle}</h3>
          <p>{tab.asideAboveText}</p>
          {overridingGifts.length === 0 ? (
            <p className="muted-text">{tab.asideAboveNone}</p>
          ) : (
            overridingGifts.map((gift) => (
              <p key={gift.id}>
                {interpolate(tab.asideAboveRule, {
                  promotion: gift.name,
                  form:
                    gift.form === 'custom-price' && gift.unitPrice !== undefined
                      ? `${labels.short(gift.form)} ${format.money(Number(gift.unitPrice), 'PLN')}`
                      : labels.short(gift.form),
                })}
              </p>
            ))
          )}
        </div>
        <div className="gift-note">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.2" />
            <path d="M8 7.2V11M8 5v.1" />
          </svg>
          <span>{tab.taxNote}</span>
        </div>
      </aside>
    </div>
  );
}
