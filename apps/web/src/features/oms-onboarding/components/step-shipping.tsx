/**
 * Step 4: Shipping (#3958)
 *
 * Two parts, in the order one depends on the other.
 *
 * 1. Which carrier ships each delivery method. One row per connection that
 *    sends orders, with how many of its delivery methods already have a
 *    carrier. Opening a row shows the mappings page's own routing editor
 *    (`FulfillmentRoutingSection`), so a change here IS the change there and
 *    this step never holds a second copy of the rules.
 * 2. Whether OpenLinker buys the label by itself when a parcel is accepted.
 *    Locked until some delivery method has a saved route that buys a label,
 *    because with none the setting would buy nothing and say nothing. "No" is
 *    preselected, matching the worker's default: this spends money per parcel.
 *
 * A row's editor stays mounted once opened, only hidden when collapsed, so
 * collapsing it does not quietly throw away an unsaved change; Continue asks
 * before it does.
 *
 * @module features/oms-onboarding/components
 */
import { useCallback, useState, type ReactElement, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { Connection } from '../../connections';
import {
  FulfillmentRoutingSection,
  ParcelProfileForm,
  draftToFields,
  summarizeParcelProfile,
  type ParcelProfileDraft,
} from '../../mappings';
import type { AutoDispatchSettings } from '../lib/config-merge';
import { useShippingStepCopy } from '../hooks/use-shipping-setup-copy';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { useOmsOnboardingCopy } from '../hooks/use-oms-onboarding-copy';
import { WIZARD_STEPS } from '../lib/onboarding-state';
import {
  coverageBadge,
  summariseShippingCoverage,
  type ShippingCoverageMap,
  type SourceShippingCoverage,
} from '../lib/shipping-coverage';
import {
  autoDispatchFromDraft,
  draftFromAutoDispatch,
  validateAutoDispatchDraft,
} from '../lib/shipping-step';
import { StepPanel } from './step-panel';

/** Where "Connect a carrier" goes; the connection pages read `from` to offer the way back. */
export const CONNECT_CARRIER_PATH = '/connections/new?from=oms-setup';

export interface StepShippingProps {
  /** Connections that send orders, in display order. */
  readonly sources: readonly Connection[];
  /** At least one active connection can buy labels. */
  readonly hasCarrier: boolean;
  readonly coverage: ShippingCoverageMap;
  /** `config.autoDispatch` as saved on the OMS connection, or `null` when never set. */
  readonly saved: AutoDispatchSettings | null;
  readonly canWrite: boolean;
  readonly demoReadOnly: boolean;
  readonly saving: boolean;
  readonly saveError: Error | null;
  readonly onBack: () => void;
  /** Move on without writing anything. */
  readonly onContinue: () => void;
  /** Save the defaults switched on; the host moves on once the write lands. */
  readonly onSave: (settings: AutoDispatchSettings) => void;
  /** Switch a saved "yes" off; the host moves on once the write lands. */
  readonly onTurnOff: () => void;
}

type Choice = 'no' | 'yes';

const BADGE_TONE = { todo: 'neutral', partly: 'info', all: 'success' } as const;

function Part({
  n,
  title,
  lead,
  done,
  locked,
  children,
}: {
  readonly n: number;
  readonly title: string;
  readonly lead: string;
  readonly done?: boolean;
  readonly locked?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const headingId = `oms-shipping-part-${String(n)}`;
  return (
    <section
      className={locked ? 'oms-onboarding__ship-part oms-onboarding__ship-part--locked' : 'oms-onboarding__ship-part'}
      aria-labelledby={headingId}
      data-testid={`shipping-part-${String(n)}`}
      data-locked={locked === true ? 'true' : undefined}
    >
      <div className="oms-onboarding__ship-part-head">
        <span
          className={
            done ? 'oms-onboarding__ship-part-n oms-onboarding__ship-part-n--done' : 'oms-onboarding__ship-part-n'
          }
          aria-hidden="true"
        >
          {done ? '✓' : n}
        </span>
        <div className="oms-onboarding__ship-part-titles">
          <h3 id={headingId}>{title}</h3>
          <p className="muted-text">{lead}</p>
        </div>
      </div>
      <div className="oms-onboarding__ship-part-body">{children}</div>
    </section>
  );
}

function SourceRow({
  source,
  coverage,
  open,
  mounted,
  onToggle,
  onDirtyChange,
}: {
  readonly source: Connection;
  readonly coverage: SourceShippingCoverage | undefined;
  readonly open: boolean;
  readonly mounted: boolean;
  readonly onToggle: () => void;
  readonly onDirtyChange: (sourceId: string, dirty: boolean) => void;
}): ReactElement {
  const step = useShippingStepCopy();
  const status = coverage?.status ?? 'loading';
  const queryClient = useQueryClient();

  if (status === 'load-failed') {
    return (
      <li className="oms-onboarding__ship-source" data-testid={`shipping-source-${source.id}`} data-coverage="load-failed">
        <div className="oms-onboarding__ship-source-row">
          <span className="oms-onboarding__ship-source-text">
            <span className="oms-onboarding__ship-source-name">{source.name}</span>
            <span className="oms-onboarding__ship-source-detail">{step.loadFailed}</span>
          </span>
          <Button
            type="button"
            tone="secondary"
            className="button--sm"
            data-testid={`btn-shipping-source-retry-${source.id}`}
            // The mappings feature keys every read of a connection under ['mappings', id].
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['mappings', source.id] })}
          >
            {step.retry}
          </Button>
        </div>
      </li>
    );
  }

  if (status === 'cannot-list') {
    return (
      <li className="oms-onboarding__ship-source" data-testid={`shipping-source-${source.id}`} data-coverage="cannot-list">
        <div className="oms-onboarding__ship-source-row">
          <span className="oms-onboarding__ship-source-text">
            <span className="oms-onboarding__ship-source-name">{source.name}</span>
            <span className="oms-onboarding__ship-source-detail">{step.cannotList}</span>
          </span>
          <StatusBadge tone="neutral" compact>
            {step.badge.noLabels}
          </StatusBadge>
        </div>
      </li>
    );
  }

  const bodyId = `oms-shipping-source-${source.id}`;
  const badge = coverage !== undefined && status === 'ready' ? coverageBadge(coverage) : null;
  const detail =
    status === 'loading' || coverage === undefined
      ? step.checking
      : status === 'unknown'
        ? step.coverageUnknown
        : step.coverage(coverage.withCarrier, coverage.total);

  return (
    <li
      className={open ? 'oms-onboarding__ship-source oms-onboarding__ship-source--open' : 'oms-onboarding__ship-source'}
      data-testid={`shipping-source-${source.id}`}
      data-coverage={badge ?? status}
    >
      <button
        type="button"
        className="oms-onboarding__ship-source-row oms-onboarding__ship-source-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        aria-label={step.expand(source.name)}
        data-testid={`btn-shipping-source-${source.id}`}
        onClick={onToggle}
      >
        <span className="oms-onboarding__ship-source-text">
          <span className="oms-onboarding__ship-source-name">{source.name}</span>
          <span className="oms-onboarding__ship-source-detail">{detail}</span>
        </span>
        {badge === null ? <span /> : (
          <StatusBadge tone={BADGE_TONE[badge]} compact withDot={badge !== 'todo'}>
            {step.badge[badge]}
          </StatusBadge>
        )}
        <span className="oms-onboarding__ship-source-chev" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      {mounted ? (
        <div className="oms-onboarding__ship-source-body" id={bodyId} hidden={!open}>
          <FulfillmentRoutingSection
            sourceConnectionId={source.id}
            onDirtyChange={(dirty) => onDirtyChange(source.id, dirty)}
            embedded
          />
        </div>
      ) : null}
    </li>
  );
}

export function StepShipping(props: StepShippingProps): ReactElement {
  const COPY = useOmsOnboardingCopy();
  const { sources, coverage, saved } = props;
  const step = useShippingStepCopy();

  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set());
  const [dirty, setDirty] = useState<Readonly<Record<string, boolean>>>({});
  const [leaving, setLeaving] = useState(false);
  const [choice, setChoice] = useState<Choice>(saved?.enabled === true ? 'yes' : 'no');
  const [form, setForm] = useState(() => draftFromAutoDispatch(saved));
  const [error, setError] = useState<string | null>(null);

  const totals = summariseShippingCoverage(
    sources.map((source) => source.id),
    coverage
  );
  const unlocked = props.hasCarrier && totals.withCarrier > 0;
  const effectiveChoice: Choice = unlocked ? choice : 'no';
  const dirtySource = sources.find((source) => dirty[source.id] === true);
  const controlsDisabled = !props.canWrite || props.saving;
  const disabledTitle = props.demoReadOnly ? demoReadOnlyActionMessage() : !props.canWrite ? COPY.adminOnly : undefined;

  const onDirtyChange = useCallback((sourceId: string, next: boolean): void => {
    setDirty((previous) => (previous[sourceId] === next ? previous : { ...previous, [sourceId]: next }));
  }, []);

  const toggle = (sourceId: string): void => {
    setMounted((previous) => new Set(previous).add(sourceId));
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };

  const finish = (): void => {
    if (effectiveChoice === 'yes') {
      const problem = validateAutoDispatchDraft(form, step.weightRequired);
      if (problem !== null) {
        setError(problem);
        return;
      }
      setError(null);
      props.onSave(autoDispatchFromDraft(form.draft));
      return;
    }
    setError(null);
    // "No" writes nothing, except when it undoes a "yes" saved earlier: leaving
    // that on while the operator just answered no would buy labels against
    // their answer. Only a choice they could actually make counts, so a part
    // that is locked never writes.
    if (unlocked && saved?.enabled === true) {
      props.onTurnOff();
      return;
    }
    props.onContinue();
  };

  const discardDirtyRows = (): void => {
    const discarded = sources.filter((source) => dirty[source.id] === true).map((source) => source.id);
    // Unmounting the editor is what throws its unsaved draft away.
    setMounted((previous) => new Set([...previous].filter((id) => !discarded.includes(id))));
    setOpen((previous) => new Set([...previous].filter((id) => !discarded.includes(id))));
    setDirty((previous) => {
      const next = { ...previous };
      for (const id of discarded) delete next[id];
      return next;
    });
  };

  const fields = draftToFields(form.draft);
  // The weight is per product, so it does not describe the parcel the sentence
  // talks about; leaving it in would read as the parcel's own weight.
  const parcelSummary = summarizeParcelProfile({ ...fields, defaultWeightGrams: null });
  const continueBusy = props.saving;
  // Waiting on the counts only matters to someone who can change the answer; a
  // read-only role never gets them, because the routing rules are admin-only.
  const continueDisabled =
    continueBusy || (props.canWrite && !totals.settled) || (effectiveChoice === 'yes' && !props.canWrite);

  return (
    <StepPanel
      step={WIZARD_STEPS.shipping}
      why={step.why}
      onBack={props.onBack}
      next={
        <Button
          type="button"
          tone="primary"
          data-testid="btn-continue-shipping"
          disabled={continueDisabled}
          title={effectiveChoice === 'yes' ? disabledTitle : undefined}
          onClick={() => (dirtySource === undefined ? finish() : setLeaving(true))}
        >
          {continueBusy
            ? step.saving
            : effectiveChoice === 'yes'
              ? step.saveAndContinue
              : COPY.continue}
        </Button>
      }
    >
      <Part
        n={1}
        title={step.routesTitle}
        lead={step.routesLead}
        done={totals.settled && totals.total > 0 && totals.withCarrier >= totals.total}
      >
        {props.hasCarrier ? null : (
          <Alert
            tone="info"
            title={step.noCarrierTitle}
            data-testid="shipping-no-carrier"
            action={
              <Link className="button button--secondary button--sm" to={CONNECT_CARRIER_PATH}>
                {step.connectCarrier}
              </Link>
            }
          >
            {step.noCarrierBody}
          </Alert>
        )}
        {sources.length === 0 ? (
          <p className="muted-text" data-testid="shipping-no-sources">
            {step.noSourcesBody}
          </p>
        ) : (
          <ul className="oms-onboarding__ship-sources">
            {sources.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                coverage={coverage[source.id]}
                open={open.has(source.id)}
                mounted={mounted.has(source.id)}
                onToggle={() => toggle(source.id)}
                onDirtyChange={onDirtyChange}
              />
            ))}
          </ul>
        )}
      </Part>

      <Part
        n={2}
        title={step.autoTitle}
        locked={!unlocked}
        lead={
          !totals.settled
            ? step.checking
            : unlocked
              ? step.autoLead(totals.withCarrier, totals.total)
              : step.autoLocked
        }
      >
        <div className="dd-choices" role="radiogroup" aria-label={step.autoGroupLabel}>
          <label className={effectiveChoice === 'no' && unlocked ? 'dd-choice dd-choice--on' : 'dd-choice'}>
            <input
              type="radio"
              name="oms-shipping-auto"
              value="no"
              data-testid="radio-auto-dispatch-no"
              checked={effectiveChoice === 'no'}
              disabled={!unlocked || controlsDisabled}
              onChange={() => {
                setChoice('no');
                setError(null);
              }}
            />
            <span className="dd-choice__body">
              <span className="dd-choice__title">{step.noTitle}</span>
              <span className="dd-choice__text">{step.noBody}</span>
            </span>
          </label>
          <label className={effectiveChoice === 'yes' ? 'dd-choice dd-choice--on' : 'dd-choice'}>
            <input
              type="radio"
              name="oms-shipping-auto"
              value="yes"
              data-testid="radio-auto-dispatch-yes"
              checked={effectiveChoice === 'yes'}
              disabled={!unlocked || controlsDisabled}
              onChange={() => {
                setChoice('yes');
                setError(null);
              }}
            />
            <span className="dd-choice__body">
              <span className="dd-choice__title">{step.yesTitle}</span>
              <span className="dd-choice__text">{step.yesBody}</span>
            </span>
          </label>
        </div>

        {effectiveChoice === 'yes' ? (
          <div className="oms-onboarding__ship-defaults" data-testid="shipping-defaults">
            <div className="oms-onboarding__ship-defaults-head">
              <h4>{step.defaultsTitle}</h4>
              <p className="muted-text">{step.defaultsLead}</p>
            </div>
            <ParcelProfileForm
              draft={form.draft}
              customTemplate={form.customTemplate}
              namePrefix="autoDispatch"
              weightDescription={step.weightDescription}
              disabled={controlsDisabled}
              onChange={(draft: ParcelProfileDraft, customTemplate: boolean) => {
                setForm({ draft, customTemplate });
                setError(null);
              }}
            />
            {error === null ? null : (
              <p className="error-message" role="alert" data-testid="shipping-defaults-error">
                {error}
              </p>
            )}
            <p className="oms-onboarding__ship-summary">
              {step.fromNow(totals.withCarrier, parcelSummary === null ? null : parcelSummary.toLowerCase())}
            </p>
          </div>
        ) : null}
      </Part>

      {props.saveError === null ? null : (
        <Alert tone="error" title={step.saveFailedTitle}>
          {describeApiError(props.saveError, 'oms-onboarding')}
        </Alert>
      )}

      <ConfirmDialog
        open={leaving}
        onOpenChange={(next) => {
          setLeaving(next);
          // "Go back and save" closes the dialog with the unsaved editor open,
          // so the Save routing button it asks for is in view.
          if (!next && dirtySource !== undefined) {
            const id = dirtySource.id;
            setOpen((previous) => new Set(previous).add(id));
          }
        }}
        title={step.unsavedTitle(dirtySource?.name ?? '')}
        description={step.unsavedBody}
        cancelLabel={step.goBackAndSave}
        confirmLabel={step.continueWithoutSaving}
        initialFocus="cancel"
        onConfirm={() => {
          setLeaving(false);
          discardDirtyRows();
          finish();
        }}
      />
    </StepPanel>
  );
}
