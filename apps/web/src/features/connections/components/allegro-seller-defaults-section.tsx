import { useState, type ReactElement } from 'react';
import {
  interpolate,
  renderRich,
  useFormat,
  useMessages,
  type Formatters,
  type Messages,
  type ResolvedCopy,
} from '../../../shared/i18n';
import type { UseFormReturn } from 'react-hook-form';
import { useResponsibleProducersQuery } from '../../allegro';
import { useUploadSafetyAttachmentMutation } from '../../allegro';
import {
  POLISH_VOIVODESHIP_LABELS,
  POLISH_VOIVODESHIP_VALUES,
} from '../types/polish-voivodeship.types';
import type { EditConnectionFormValues } from './edit-connection.schema';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FileUpload } from '../../../shared/ui/file-upload';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { Textarea } from '../../../shared/ui/textarea';

/** Allegro hard cap — max 20 attachments per product (#449). */
const MAX_SAFETY_ATTACHMENTS = 20;
/**
 * Mirrors the BE constant `ALLEGRO_SAFETY_ATTACHMENT_MAX_BYTES`. Kept as
 * a literal here (not imported from `@openlinker/integrations-allegro`) to
 * avoid pulling a backend package into the FE bundle. Verify both values
 * stay in sync if either changes.
 */
const MAX_SAFETY_ATTACHMENT_BYTES = 25 * 1024 * 1024;

interface AllegroSellerDefaultsSectionProps {
  connectionId: string;
  form: UseFormReturn<EditConnectionFormValues>;
  /**
   * Called whenever any seller-defaults sub-field changes — the parent form
   * uses this to re-serialize the whole `sellerDefaults` object into
   * `configText` JSON via `mergeStructuredIntoConfig`. Keeping the merge
   * logic in the parent (where `configText` lives) avoids duplicating the
   * empty-string-pruning rules here.
   */
  onChange: () => void;
  disabled?: boolean;
}

/**
 * Connection-edit section for Allegro seller defaults (#430). Three field
 * groups — ship-from location, EU GPSR responsible producer, and safety
 * information — required by `POST /sale/product-offers` since the GPSR
 * rollout on 2024-12-13.
 *
 * Rendered by the Allegro platform plugin's `EditConnectionExtraSection`
 * slot in `apps/web/src/plugins/allegro/`. The parent `EditConnectionForm`
 * already syncs the structured fields into a single `configText` JSON via
 * the merge helper — this section follows that pattern (every input change
 * calls `onChange`, the parent re-serializes).
 */
export function AllegroSellerDefaultsSection({
  connectionId,
  form,
  onChange,
  disabled = false,
}: AllegroSellerDefaultsSectionProps): ReactElement {
  const copy = useMessages('connections').allegroSellerDefaultsSection;
  const producersQuery = useResponsibleProducersQuery(connectionId);

  // The default safety-information type is seeded by the parent's
  // `readSellerDefaults` helper at form-construction time (always one of
  // the two enum values, never `undefined`), so `safetyType` is guaranteed
  // truthy on first render — no mount-only effect needed here.
  const safetyType = form.watch('sellerDefaults.safetyInformation.type');

  const errors = form.formState.errors.sellerDefaults;

  return (
    <section className="seller-defaults" aria-labelledby="seller-defaults-heading">
      <header className="seller-defaults__header">
        <p className="seller-defaults__eyebrow">{copy.eyebrow}</p>
        <h3 id="seller-defaults-heading" className="seller-defaults__title">
          {copy.title}
        </h3>
        <p className="seller-defaults__description">
          {copy.description}
        </p>
      </header>

      <div className="seller-defaults__group">
        <h4 className="seller-defaults__group-title">{copy.location.title}</h4>
        <p className="seller-defaults__group-description">
          {copy.location.description}
        </p>

        <FormField
          label={copy.location.province}
          name="sellerDefaults.location.province"
          error={errors?.location?.province?.message}
        >
          <Select
            {...form.register('sellerDefaults.location.province')}
            onChange={(event) => {
              const next = event.target.value;
              const province = (POLISH_VOIVODESHIP_VALUES as readonly string[]).includes(next)
                ? (next as (typeof POLISH_VOIVODESHIP_VALUES)[number])
                : '';
              form.setValue('sellerDefaults.location.province', province, {
                shouldDirty: true,
              });
              form.setValue('sellerDefaults.location.countryCode', 'PL', {
                shouldDirty: true,
              });
              onChange();
            }}
            disabled={disabled}
          >
            <option value="">{copy.location.provincePlaceholder}</option>
            {POLISH_VOIVODESHIP_VALUES.map((value) => (
              <option key={value} value={value}>
                {POLISH_VOIVODESHIP_LABELS[value]}
              </option>
            ))}
          </Select>
        </FormField>

        <div className="seller-defaults__row">
          <FormField
            label={copy.location.city}
            name="sellerDefaults.location.city"
            error={errors?.location?.city?.message}
          >
            <Input
              {...form.register('sellerDefaults.location.city')}
              onChange={(event) => {
                form.setValue('sellerDefaults.location.city', event.target.value, {
                  shouldDirty: true,
                });
                onChange();
              }}
              maxLength={200}
              autoComplete="address-level2"
              disabled={disabled}
              invalid={Boolean(errors?.location?.city)}
            />
          </FormField>

          <FormField
            label={copy.location.postCode}
            name="sellerDefaults.location.postCode"
            error={errors?.location?.postCode?.message}
            description={copy.location.postCodeHint}
          >
            <Input
              {...form.register('sellerDefaults.location.postCode')}
              onChange={(event) => {
                form.setValue('sellerDefaults.location.postCode', event.target.value, {
                  shouldDirty: true,
                });
                onChange();
              }}
              placeholder="00-001"
              inputMode="numeric"
              autoComplete="postal-code"
              disabled={disabled}
              invalid={Boolean(errors?.location?.postCode)}
            />
          </FormField>
        </div>
      </div>

      <div className="seller-defaults__group">
        <div className="seller-defaults__group-head">
          <div>
            <h4 className="seller-defaults__group-title">{copy.producer.title}</h4>
            <p className="seller-defaults__group-description">
              {copy.producer.description}
            </p>
          </div>
          <Button
            tone="secondary"
            type="button"
            onClick={() => void producersQuery.refetch()}
            disabled={disabled || producersQuery.isFetching}
          >
            {producersQuery.isFetching ? copy.producer.refreshing : copy.producer.refresh}
          </Button>
        </div>

        {producersQuery.error ? (
          <Alert tone="error" title={copy.producer.errorTitle}>
            {producersQuery.error.message}
          </Alert>
        ) : null}

        {!producersQuery.isLoading &&
        !producersQuery.error &&
        (producersQuery.data ?? []).length === 0 ? (
          <Alert tone="info" title={copy.producer.emptyTitle}>
            {copy.producer.emptyBody}
          </Alert>
        ) : null}

        <FormField
          label={copy.producer.title}
          name="sellerDefaults.responsibleProducerId"
          error={errors?.responsibleProducerId?.message}
        >
          <Select
            {...form.register('sellerDefaults.responsibleProducerId')}
            onChange={(event) => {
              form.setValue(
                'sellerDefaults.responsibleProducerId',
                event.target.value,
                { shouldDirty: true },
              );
              onChange();
            }}
            disabled={
              disabled ||
              producersQuery.isLoading ||
              Boolean(producersQuery.error) ||
              (producersQuery.data ?? []).length === 0
            }
          >
            <option value="">
              {producersQuery.isLoading
                ? copy.producer.loading
                : (producersQuery.data ?? []).length === 0
                  ? copy.producer.noEntries
                  : copy.producer.selectEntry}
            </option>
            {(producersQuery.data ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <div className="seller-defaults__group">
        <h4 className="seller-defaults__group-title">{copy.safety.title}</h4>
        <p className="seller-defaults__group-description">
          {renderRich(copy.safety.description, { strong: (text) => <strong>{text}</strong> })}
        </p>

        <FormField
          label={copy.safety.type}
          name="sellerDefaults.safetyInformation.type"
          error={errors?.safetyInformation?.type?.message}
        >
          <Select
            {...form.register('sellerDefaults.safetyInformation.type')}
            onChange={(event) => {
              form.setValue(
                'sellerDefaults.safetyInformation.type',
                event.target.value as 'NO_SAFETY_INFORMATION' | 'TEXT' | 'ATTACHMENTS',
                { shouldDirty: true },
              );
              onChange();
            }}
            disabled={disabled}
          >
            <option value="NO_SAFETY_INFORMATION">{copy.safety.options.none}</option>
            <option value="TEXT">{copy.safety.options.text}</option>
            <option value="ATTACHMENTS">{copy.safety.options.attachments}</option>
          </Select>
        </FormField>

        {safetyType === 'TEXT' ? (
          <FormField
            label={copy.safety.descriptionLabel}
            name="sellerDefaults.safetyInformation.description"
            error={errors?.safetyInformation?.description?.message}
            description={copy.safety.descriptionHint}
          >
            <Textarea
              {...form.register('sellerDefaults.safetyInformation.description')}
              onChange={(event) => {
                form.setValue(
                  'sellerDefaults.safetyInformation.description',
                  event.target.value,
                  { shouldDirty: true },
                );
                onChange();
              }}
              rows={4}
              maxLength={5000}
              disabled={disabled}
              invalid={Boolean(errors?.safetyInformation?.description)}
            />
          </FormField>
        ) : null}

        {safetyType === 'ATTACHMENTS' ? (
          <SafetyAttachmentsField
            connectionId={connectionId}
            form={form}
            onChange={onChange}
            disabled={disabled}
            errorMessage={
              // RHF surfaces superRefine errors at the path they were
              // attached to ('attachments') as `_errors`/'message' on the
              // intermediate node; pull the nested message defensively.
              (errors?.safetyInformation?.attachments as { message?: string } | undefined)
                ?.message ??
              (errors?.safetyInformation as unknown as { message?: string } | undefined)?.message
            }
          />
        ) : null}
      </div>
    </section>
  );
}

/**
 * The ATTACHMENTS branch of the safety-information field. Renders a
 * file-upload zone plus a list of currently-attached files. Uploaded
 * file metadata is held in form state only — Allegro is the system of
 * record for the binary, OL persists only the `id` (the existing
 * serializer at `edit-connection.schema.ts` strips the extra fields
 * before saving).
 *
 * Note on form-state shape: the existing schema persists `attachments`
 * as `Array<{ id: string }>`. We extend the in-memory form value with
 * client-only metadata (`fileName`, `mimeType`, `sizeBytes`) so the
 * list renders nice labels — those fields are dropped on serialize.
 */
interface SafetyAttachment {
  id: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
}

function SafetyAttachmentsField({
  connectionId,
  form,
  onChange,
  disabled,
  errorMessage,
}: {
  connectionId: string;
  form: UseFormReturn<EditConnectionFormValues>;
  onChange: () => void;
  disabled: boolean;
  errorMessage?: string;
}): ReactElement {
  const copy = useMessages('connections').allegroSellerDefaultsSection.attachments;
  const format = useFormat();
  const uploadMutation = useUploadSafetyAttachmentMutation();
  const [inlineError, setInlineError] = useState<string | null>(null);

  const attachments =
    (form.watch('sellerDefaults.safetyInformation.attachments') as SafetyAttachment[] | undefined) ??
    [];
  const atCap = attachments.length >= MAX_SAFETY_ATTACHMENTS;

  const handleUpload = async (file: File): Promise<void> => {
    setInlineError(null);
    try {
      const result = await uploadMutation.mutateAsync({ connectionId, file });
      const next: SafetyAttachment[] = [
        ...attachments,
        {
          id: result.id,
          fileName: result.fileName,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
        },
      ];
      form.setValue('sellerDefaults.safetyInformation.attachments', next, {
        shouldDirty: true,
        shouldValidate: true,
      });
      onChange();
    } catch (error) {
      const message = error instanceof Error ? error.message : copy.uploadFailed;
      setInlineError(message);
    }
  };

  const removeAt = (index: number): void => {
    const next = attachments.filter((_, i) => i !== index);
    form.setValue('sellerDefaults.safetyInformation.attachments', next, {
      shouldDirty: true,
      shouldValidate: true,
    });
    // Clear any lingering upload-error surfaces — TanStack Query holds
    // `mutation.error` until the next mutateAsync resolves, so without
    // this a failed upload's red Alert would persist while the operator
    // remediates by removing an unrelated attachment.
    setInlineError(null);
    uploadMutation.reset();
    onChange();
  };

  const apiError = uploadMutation.error;

  // Once anything is uploaded, surface the list above the dropzone so
  // the operator sees what they have before adding more. The single
  // alert below merges client-side validation and API errors — they're
  // the same concern from the operator's POV (this upload didn't land).
  const errorAlertMessage = inlineError ?? (apiError ? apiError.message : null);
  const fileLabel =
    attachments.length === 0
      ? copy.label
      : interpolate(copy.labelCount, {
          count: attachments.length,
          max: MAX_SAFETY_ATTACHMENTS,
        });

  return (
    <>
      {attachments.length > 0 ? (
        <ul className="file-upload__list" aria-label={copy.listLabel}>
          {attachments.map((att, index) => (
            <li key={att.id} className="file-upload__list-item">
              <span
                className="file-upload__list-item-name"
                title={att.fileName ?? att.id}
              >
                {att.fileName ?? att.id}
              </span>
              <span className="file-upload__list-item-meta">
                {att.sizeBytes !== undefined ? formatSize(copy, format, att.sizeBytes) : null}
              </span>
              <Button
                type="button"
                tone="ghost"
                className="button--sm file-upload__list-item-remove"
                onClick={() => removeAt(index)}
                disabled={disabled}
                aria-label={interpolate(copy.removeNamed, { name: att.fileName ?? att.id })}
              >
                {copy.remove}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <FormField
        label={fileLabel}
        name="sellerDefaults.safetyInformation.attachments"
        error={errorMessage}
        description={copy.hint}
      >
        <FileUpload
          accept="application/pdf"
          maxBytes={MAX_SAFETY_ATTACHMENT_BYTES}
          onFileSelected={handleUpload}
          onError={setInlineError}
          disabled={disabled || atCap}
          busy={uploadMutation.isPending}
          invalid={Boolean(errorMessage) || Boolean(errorAlertMessage)}
          label={atCap ? interpolate(copy.maxReached, { max: MAX_SAFETY_ATTACHMENTS }) : undefined}
          hint={atCap ? copy.removeToAdd : undefined}
        />
      </FormField>

      {errorAlertMessage ? <Alert tone="error">{errorAlertMessage}</Alert> : null}
    </>
  );
}

function formatSize(
  copy: ResolvedCopy<Messages['connections']>['allegroSellerDefaultsSection']['attachments'],
  format: Formatters,
  bytes: number,
): string {
  const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  if (bytes < 1024) return interpolate(copy.size.bytes, { n: format.number(bytes) });
  if (bytes < 1024 * 1024) {
    return interpolate(copy.size.kilobytes, { n: format.number(bytes / 1024, oneDecimal) });
  }
  return interpolate(copy.size.megabytes, {
    n: format.number(bytes / (1024 * 1024), oneDecimal),
  });
}
