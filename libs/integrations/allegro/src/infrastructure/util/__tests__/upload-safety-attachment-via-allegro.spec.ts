/**
 * Upload Safety Attachment Via Allegro Tests
 *
 * Unit tests for the per-file safety-attachment upload util. Exercises
 * pre-flight validation (MIME, size, fileName) and response handling
 * with a mocked `IAllegroHttpClient.postMultipart`.
 *
 * @module libs/integrations/allegro/src/infrastructure/util/__tests__
 */
import { IAllegroHttpClient } from '../../http/allegro-http-client.interface';
import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';
import {
  ALLEGRO_SAFETY_ATTACHMENT_UPLOAD_PATH,
  ALLEGRO_SAFETY_ATTACHMENT_MAX_BYTES,
} from '../../../domain/types/allegro-safety-attachments.types';
import { uploadSafetyAttachmentViaAllegro } from '../upload-safety-attachment-via-allegro';

describe('uploadSafetyAttachmentViaAllegro', () => {
  let uploadHttpClient: jest.Mocked<IAllegroHttpClient>;

  const validInput = {
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), // %PDF
    mimeType: 'application/pdf',
    fileName: 'safety-info.pdf',
  };

  beforeEach(() => {
    uploadHttpClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      postBinary: jest.fn(),
      postMultipart: jest.fn(),
    } as unknown as jest.Mocked<IAllegroHttpClient>;
  });

  it('should return id when Allegro accepts the upload', async () => {
    uploadHttpClient.postMultipart.mockResolvedValue({
      data: { id: 'attach-123' },
      status: 201,
      headers: {},
    });

    const result = await uploadSafetyAttachmentViaAllegro(uploadHttpClient, validInput);

    expect(result).toEqual({ id: 'attach-123' });
    expect(uploadHttpClient.postMultipart).toHaveBeenCalledWith(
      ALLEGRO_SAFETY_ATTACHMENT_UPLOAD_PATH,
      [
        {
          name: 'file',
          fileName: 'safety-info.pdf',
          contentType: 'application/pdf',
          bytes: validInput.bytes,
        },
      ],
    );
  });

  it('should throw when MIME type is not in the accepted set', async () => {
    await expect(
      uploadSafetyAttachmentViaAllegro(uploadHttpClient, {
        ...validInput,
        mimeType: 'image/jpeg',
      }),
    ).rejects.toThrow(AllegroApiException);
    expect(uploadHttpClient.postMultipart).not.toHaveBeenCalled();
  });

  it('should throw when payload is empty', async () => {
    await expect(
      uploadSafetyAttachmentViaAllegro(uploadHttpClient, {
        ...validInput,
        bytes: new Uint8Array(0),
      }),
    ).rejects.toThrow(/empty/);
    expect(uploadHttpClient.postMultipart).not.toHaveBeenCalled();
  });

  it('should throw when payload exceeds the size cap', async () => {
    await expect(
      uploadSafetyAttachmentViaAllegro(uploadHttpClient, {
        ...validInput,
        bytes: new Uint8Array(ALLEGRO_SAFETY_ATTACHMENT_MAX_BYTES + 1),
      }),
    ).rejects.toThrow(/exceeds max size/);
    expect(uploadHttpClient.postMultipart).not.toHaveBeenCalled();
  });

  it('should throw when fileName is empty or whitespace', async () => {
    await expect(
      uploadSafetyAttachmentViaAllegro(uploadHttpClient, { ...validInput, fileName: '   ' }),
    ).rejects.toThrow(/fileName is required/);
    expect(uploadHttpClient.postMultipart).not.toHaveBeenCalled();
  });

  it('should preserve the original AllegroApiException when Allegro rejects the upload', async () => {
    const apiError = new AllegroApiException(
      'Upload rejected',
      400,
      JSON.stringify({ errors: [{ message: 'invalid file' }] }),
      ALLEGRO_SAFETY_ATTACHMENT_UPLOAD_PATH,
    );
    uploadHttpClient.postMultipart.mockRejectedValue(apiError);

    await expect(uploadSafetyAttachmentViaAllegro(uploadHttpClient, validInput)).rejects.toBe(
      apiError,
    );
  });

  it('should wrap non-Allegro errors as AllegroApiException', async () => {
    uploadHttpClient.postMultipart.mockRejectedValue(new Error('socket timeout'));

    await expect(
      uploadSafetyAttachmentViaAllegro(uploadHttpClient, validInput),
    ).rejects.toThrow(AllegroApiException);
  });

  it("should throw when response is missing the 'id' field", async () => {
    uploadHttpClient.postMultipart.mockResolvedValue({
      data: { status: 'PROCESSING' } as { id?: unknown },
      status: 201,
      headers: {},
    });

    await expect(uploadSafetyAttachmentViaAllegro(uploadHttpClient, validInput)).rejects.toThrow(
      /missing 'id'/,
    );
  });

  it('should throw when id field is not a non-empty string', async () => {
    uploadHttpClient.postMultipart.mockResolvedValue({
      data: { id: '' } as { id?: unknown },
      status: 201,
      headers: {},
    });

    await expect(uploadSafetyAttachmentViaAllegro(uploadHttpClient, validInput)).rejects.toThrow(
      /missing 'id'/,
    );
  });
});
