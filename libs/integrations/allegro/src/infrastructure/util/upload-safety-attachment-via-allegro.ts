/**
 * Upload Safety Attachment Via Allegro
 *
 * Per-file orchestrator: validates inbound bytes (MIME + size), uploads
 * them to Allegro's safety-attachment endpoint via `postMultipart`, and
 * parses the returned id. Designed to mirror `uploadImagesViaAllegro`
 * structurally so the two helpers stay diff-readable for whoever owns
 * the next platform-attachment surface.
 *
 * Errors:
 * - `SAFETY_ATTACHMENT_VALIDATION_FAILED` — pre-flight validation
 *   rejected the input (MIME or size). Thrown as `AllegroApiException`
 *   with no `statusCode` so callers can distinguish operator-input
 *   problems from network/API failures.
 * - `SAFETY_ATTACHMENT_UPLOAD_FAILED` — Allegro rejected the upload or
 *   the response shape didn't match the documented contract. Thrown as
 *   `AllegroApiException`; the original status code (if any) is
 *   preserved.
 *
 * @module libs/integrations/allegro/src/infrastructure/util
 * @see {@link AllegroOfferManagerAdapter.uploadSafetyAttachment} — sole consumer
 */
import { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import { AllegroApiException } from '../../domain/exceptions/allegro-api.exception';
import {
  ALLEGRO_SAFETY_ATTACHMENT_UPLOAD_PATH,
  ALLEGRO_SAFETY_ATTACHMENT_MAX_BYTES,
  ACCEPTED_SAFETY_ATTACHMENT_MIME_TYPES,
  SafetyAttachmentUploadInput,
  SafetyAttachmentUploadResult,
} from '../../domain/types/allegro-safety-attachments.types';

export async function uploadSafetyAttachmentViaAllegro(
  uploadHttpClient: IAllegroHttpClient,
  input: SafetyAttachmentUploadInput,
): Promise<SafetyAttachmentUploadResult> {
  validateInput(input);

  let response;
  try {
    response = await uploadHttpClient.postMultipart<{ id?: unknown }>(
      ALLEGRO_SAFETY_ATTACHMENT_UPLOAD_PATH,
      [
        {
          name: 'file',
          fileName: input.fileName,
          contentType: input.mimeType,
          bytes: input.bytes,
        },
      ],
    );
  } catch (error) {
    // Surface AllegroApiException untouched so callers see the original
    // status code; wrap anything else (network errors etc.) with a
    // typed code so the API layer can distinguish from operator-input
    // failures.
    if (error instanceof AllegroApiException) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new AllegroApiException(
      `Allegro safety-attachment upload failed: ${message}`,
      undefined,
      undefined,
      ALLEGRO_SAFETY_ATTACHMENT_UPLOAD_PATH,
    );
  }

  const id = response.data?.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new AllegroApiException(
      `Allegro safety-attachment upload response missing 'id' field`,
      response.status,
      JSON.stringify(response.data),
      ALLEGRO_SAFETY_ATTACHMENT_UPLOAD_PATH,
    );
  }

  return { id };
}

function validateInput(input: SafetyAttachmentUploadInput): void {
  if (!ACCEPTED_SAFETY_ATTACHMENT_MIME_TYPES.has(input.mimeType)) {
    throw new AllegroApiException(
      `Unsupported safety-attachment MIME type '${input.mimeType}'. Accepted: ${[
        ...ACCEPTED_SAFETY_ATTACHMENT_MIME_TYPES,
      ].join(', ')}`,
      undefined,
      undefined,
      ALLEGRO_SAFETY_ATTACHMENT_UPLOAD_PATH,
    );
  }
  if (input.bytes.byteLength === 0) {
    throw new AllegroApiException(
      'Safety-attachment payload is empty',
      undefined,
      undefined,
      ALLEGRO_SAFETY_ATTACHMENT_UPLOAD_PATH,
    );
  }
  if (input.bytes.byteLength > ALLEGRO_SAFETY_ATTACHMENT_MAX_BYTES) {
    throw new AllegroApiException(
      `Safety-attachment exceeds max size: ${input.bytes.byteLength} > ${ALLEGRO_SAFETY_ATTACHMENT_MAX_BYTES} bytes`,
      undefined,
      undefined,
      ALLEGRO_SAFETY_ATTACHMENT_UPLOAD_PATH,
    );
  }
  if (!input.fileName || input.fileName.trim().length === 0) {
    throw new AllegroApiException(
      'Safety-attachment fileName is required',
      undefined,
      undefined,
      ALLEGRO_SAFETY_ATTACHMENT_UPLOAD_PATH,
    );
  }
}
