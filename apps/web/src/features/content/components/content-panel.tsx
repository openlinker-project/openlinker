/**
 * Content Panel
 *
 * Shared editor shell for a single content field (master or per-channel).
 * Renders a rich-text editor bound to a local draft buffer, a conflict banner when the
 * backend reports a divergent external version, a status line with last-edit
 * metadata, and an action cluster: Save / Discard / Publish / Suggest.
 *
 * The panel is purely presentational. All data fetching + mutation wiring
 * lives in `ContentEditor`, which passes the values and handlers through.
 *
 * @module apps/web/src/features/content/components
 */
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import {
  StructuredErrorList,
  type StructuredError,
} from '../../../shared/ui/structured-error-list';
import { Button } from '../../../shared/ui/button';
import { DesktopOnlyBanner } from '../../../shared/ui/desktop-only-banner';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { RichTextEditor } from '../../../shared/ui/rich-text-editor';
import { exceedsDescriptionCap } from '../../../shared/ui/rich-text-profiles';
import type { DescriptionFormat } from '../../../shared/ui/rich-text.types';
import { translateAllegroError } from '../../allegro';

const MAX_VALUE_LENGTH = 65_536;

export interface ContentPanelProps {
  title: string;
  subtitle?: ReactNode;
  statusSlot?: ReactNode;
  baseValue: string | null;
  draftValue: string | null;
  hasConflict: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  disabledReason?: string | null;
  isDesktop: boolean;
  /**
   * The destination's declared description contract (ADR-046). The master tab
   * passes `MASTER_DESCRIPTION_FORMAT`, since the catalogue of record is
   * deliberately outside the declared-format rule; a channel tab passes what its
   * connection declared.
   */
  /** `null` while the destination's contract is in flight (ADR-046). */
  format: DescriptionFormat | null;
  busy: boolean;
  error?: string | null;
  /**
   * Structured Allegro errors from a `CHANNEL_PUBLISH_FAILED` 422 (#486).
   * When present + non-empty, takes visual precedence over the bare-string
   * `error` Alert — the operator gets per-field, per-code rows instead of
   * a useless "Allegro API error (422):" headline.
   */
  errors?: StructuredError[] | null;
  suggestSlot?: ReactNode;
  onSave: (value: string) => void;
  onDiscard: () => void;
  onPublish: () => void;
}

function computeEffectiveValue(draft: string | null, base: string | null): string {
  if (draft !== null) return draft;
  if (base !== null) return base;
  return '';
}

export function ContentPanel({
  title,
  subtitle,
  statusSlot,
  baseValue,
  draftValue,
  hasConflict,
  updatedAt,
  updatedBy,
  disabledReason,
  isDesktop,
  format,
  busy,
  error,
  errors,
  suggestSlot,
  onSave,
  onDiscard,
  onPublish,
}: ContentPanelProps): ReactElement {
  const copy = useMessages('content').contentPanel;
  const {
    number: formatNumber,
    dateTime: formatDateTime,
    relativeTime: formatRelativeTime,
  } = useFormat();
  const hasStructuredErrors = errors !== null && errors !== undefined && errors.length > 0;
  const initialValue = computeEffectiveValue(draftValue, baseValue);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(computeEffectiveValue(draftValue, baseValue));
  }, [draftValue, baseValue]);

  const hasDraft = draftValue !== null;
  const isDirty = value !== (draftValue ?? baseValue ?? '');
  const readOnly = !isDesktop || Boolean(disabledReason);
  const overLimit = value.length > MAX_VALUE_LENGTH;
  // The DESTINATION's cap, not just the storage cap. The editor's byte counter
  // was decorative: nothing gated on it, so an operator could save and publish a
  // 45,000-byte Allegro description and learn about it from a platform 422 - the
  // exact class of failure ADR-046 exists to remove. Measured in UTF-8 bytes,
  // like the backend cap, and only when the destination declared one.
  const destinationCap = format?.maxBytes ?? null;
  const destinationCapLabel = destinationCap === null ? '' : formatNumber(destinationCap);
  const overDestinationCap = exceedsDescriptionCap(value, format);
  const canSave = !readOnly && !busy && isDirty && !overLimit && !overDestinationCap;
  const canDiscard = !readOnly && !busy && hasDraft;
  const canPublish = !readOnly && !busy && hasDraft && !isDirty && !hasConflict;

  const titleId = `content-panel-${title.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <section className="content-panel" aria-labelledby={titleId}>
      <header className="content-panel__header">
        <div>
          <h3 id={titleId} className="content-panel__title">
            {title}
          </h3>
          {subtitle && <p className="content-panel__subtitle">{subtitle}</p>}
        </div>
        <div className="content-panel__status">{statusSlot}</div>
      </header>

      {!isDesktop && (
        <DesktopOnlyBanner title={copy.desktopOnly.title}>
          {copy.desktopOnly.message}
        </DesktopOnlyBanner>
      )}

      {disabledReason && <Alert tone="info">{disabledReason}</Alert>}
      {overDestinationCap && (
        <Alert tone="warning">
          {interpolate(copy.overDestinationCap, { cap: destinationCapLabel })}
        </Alert>
      )}

      {hasConflict && (
        <Alert tone="warning">
          {copy.conflict}
        </Alert>
      )}

      {hasStructuredErrors ? (
        <Alert tone="error" title={copy.publishRejected}>
          <StructuredErrorList errors={errors} translate={translateAllegroError} />
        </Alert>
      ) : error ? (
        <Alert tone="error">{error}</Alert>
      ) : null}

      {/* ADR-046: a description is HTML, and this field held it as raw markup -
          with the AI suggestion prompt explicitly producing semantic HTML into a
          field whose helper text said "plain text". The editor derives its
          toolbar and schema from the destination's contract, so the operator
          cannot author a tag this channel would discard. */}
      <RichTextEditor
        className="content-panel__editor"
        format={format}
        value={value}
        onChange={setValue}
        disabled={readOnly}
        aria-label={interpolate(copy.editorAriaLabel, { title })}
        toolbarSlot={suggestSlot}
      />

      {/* #2200: the character counter that used to live here is gone. It measured
          `MAX_VALUE_LENGTH`, the storage cap on the draft DTO - not what the
          destination accepts - and the editor already renders a BYTE counter
          against the destination's own limit. Two counters in two units on one
          field, where the smaller one is the one that actually rejects a publish,
          told the operator less than one. The storage cap is still enforced: it
          gates Save below, and the backend validates it. */}
      {overLimit && (
        <div className="content-panel__meta">
          <span className="text-danger">
            {interpolate(copy.overStorageLimit, { limit: formatNumber(MAX_VALUE_LENGTH) })}
          </span>
        </div>
      )}

      <div className="content-panel__footer">
        <div className="content-panel__footer-status">
          {hasDraft ? (
            <StatusBadge tone="review">{copy.status.draftPending}</StatusBadge>
          ) : baseValue !== null ? (
            <StatusBadge tone="success">{copy.status.published}</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">{copy.status.empty}</StatusBadge>
          )}
          {updatedAt && (
            <span className="text-muted">
              <time dateTime={updatedAt} title={formatDateTime(updatedAt)}>
                {formatRelativeTime(updatedAt)}
              </time>
              {updatedBy && ` · ${updatedBy}`}
            </span>
          )}
        </div>

        <div className="content-panel__actions">
          <Button
            type="button"
            tone="ghost"
            disabled={!canDiscard}
            onClick={() => {
              onDiscard();
            }}
          >
            {copy.actions.discard}
          </Button>
          <Button
            type="button"
            tone="secondary"
            disabled={!canSave}
            onClick={() => {
              onSave(value);
            }}
          >
            {copy.actions.save}
          </Button>
          <Button
            type="button"
            tone="primary"
            disabled={!canPublish}
            onClick={() => {
              onPublish();
            }}
          >
            {copy.actions.publish}
          </Button>
        </div>
      </div>
    </section>
  );
}
