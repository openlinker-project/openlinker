import { useState, type ReactElement } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useResponsibleProducersQuery } from '../../allegro/hooks/use-responsible-producers-query';
import { useUploadSafetyAttachmentMutation } from '../../allegro/hooks/use-upload-safety-attachment-mutation';
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
 * Lives inside the existing `EditConnectionForm`; rendered only when
 * `connection.platformType === 'allegro'`. The form already syncs the
 * structured fields into a single `configText` JSON via the merge helper —
 * this section follows that pattern (every input change calls `onChange`,
 * the parent re-serializes).
 */
export function AllegroSellerDefaultsSection({
  connectionId,
  form,
  onChange,
  disabled = false,
}: AllegroSellerDefaultsSectionProps): ReactElement {
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
        <p className="seller-defaults__eyebrow">Allegro seller defaults</p>
        <h3 id="seller-defaults-heading" className="seller-defaults__title">
          Required by Allegro for offer creation
        </h3>
        <p className="seller-defaults__description">
          Allegro requires a ship-from location and EU GPSR data
          (Reg. 2023/988, mandatory since 13 Dec 2024) on every offer. These
          defaults are sent on the inline-product path and used as a fallback
          when smart-linking to an existing product card misses.
        </p>
      </header>

      <div className="seller-defaults__group">
        <h4 className="seller-defaults__group-title">Ship-from location</h4>
        <p className="seller-defaults__group-description">
          Used as <code className="mono-text">body.location</code> on every offer.
        </p>

        <FormField
          label="Voivodeship"
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
            <option value="">Select voivodeship…</option>
            {POLISH_VOIVODESHIP_VALUES.map((value) => (
              <option key={value} value={value}>
                {POLISH_VOIVODESHIP_LABELS[value]}
              </option>
            ))}
          </Select>
        </FormField>

        <div className="seller-defaults__row">
          <FormField
            label="City"
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
            label="Post code"
            name="sellerDefaults.location.postCode"
            error={errors?.location?.postCode?.message}
            description="Polish format NN-NNN."
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
            <h4 className="seller-defaults__group-title">Responsible producer</h4>
            <p className="seller-defaults__group-description">
              EU GPSR registry entry from your Allegro seller account.
            </p>
          </div>
          <Button
            tone="secondary"
            type="button"
            onClick={() => void producersQuery.refetch()}
            disabled={disabled || producersQuery.isFetching}
          >
            {producersQuery.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>

        {producersQuery.error ? (
          <Alert tone="error" title="Could not load responsible producers">
            {producersQuery.error.message}
          </Alert>
        ) : null}

        {!producersQuery.isLoading &&
        !producersQuery.error &&
        (producersQuery.data ?? []).length === 0 ? (
          <Alert tone="info" title="No responsible-producer entries yet">
            Create a Responsible Producer in your Allegro seller panel, then
            click Refresh.
          </Alert>
        ) : null}

        <FormField
          label="Responsible producer"
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
                ? 'Loading…'
                : (producersQuery.data ?? []).length === 0
                  ? 'No entries'
                  : 'Select an entry…'}
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
        <h4 className="seller-defaults__group-title">Safety information</h4>
        <p className="seller-defaults__group-description">
          Pick <strong>None applies</strong> for products without GPSR safety
          obligations, provide free-text safety details, or upload PDFs as
          attachments. Some categories (cameras, electronics with batteries,
          etc.) require <strong>TEXT</strong> or <strong>ATTACHMENTS</strong>
          and reject the &quot;None applies&quot; option.
        </p>

        <FormField
          label="Type"
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
            <option value="NO_SAFETY_INFORMATION">None applies</option>
            <option value="TEXT">Provide safety information (text)</option>
            <option value="ATTACHMENTS">Provide safety information (file)</option>
          </Select>
        </FormField>

        {safetyType === 'TEXT' ? (
          <FormField
            label="Safety information description"
            name="sellerDefaults.safetyInformation.description"
            error={errors?.safetyInformation?.description?.message}
            description="Free text shown to buyers. 1–5000 characters; no HTML, newlines allowed."
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
      const message = error instanceof Error ? error.message : 'Upload failed';
      setInlineError(message);
    }
  };

  const removeAt = (index: number): void => {
    const next = attachments.filter((_, i) => i !== index);
    form.setValue('sellerDefaults.safetyInformation.attachments', next, {
      shouldDirty: true,
      shouldValidate: true,
    });
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
      ? 'Safety information attachments'
      : `Safety information attachments (${attachments.length}/${MAX_SAFETY_ATTACHMENTS})`;

  return (
    <>
      {attachments.length > 0 ? (
        <ul className="file-upload__list" aria-label="Uploaded safety attachments">
          {attachments.map((att, index) => (
            <li key={att.id} className="file-upload__list-item">
              <span className="file-upload__list-item-name">
                {att.fileName ?? att.id}
              </span>
              <span className="file-upload__list-item-meta">
                {att.sizeBytes !== undefined ? formatSize(att.sizeBytes) : null}
              </span>
              <Button
                type="button"
                tone="ghost"
                className="button--sm file-upload__list-item-remove"
                onClick={() => removeAt(index)}
                disabled={disabled}
                aria-label={`Remove ${att.fileName ?? att.id}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <FormField
        label={fileLabel}
        name="sellerDefaults.safetyInformation.attachments"
        error={errorMessage}
        description="Upload one or more PDF files. Allegro stores the file; OL keeps only the returned id."
      >
        <FileUpload
          accept="application/pdf"
          maxBytes={MAX_SAFETY_ATTACHMENT_BYTES}
          onFileSelected={handleUpload}
          onError={setInlineError}
          disabled={disabled || atCap}
          busy={uploadMutation.isPending}
          invalid={Boolean(errorMessage) || Boolean(errorAlertMessage)}
          label={atCap ? `Maximum ${MAX_SAFETY_ATTACHMENTS} attachments reached` : undefined}
          hint={
            atCap
              ? 'Remove one to add another.'
              : undefined
          }
        />
      </FormField>

      {errorAlertMessage ? <Alert tone="error">{errorAlertMessage}</Alert> : null}
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
