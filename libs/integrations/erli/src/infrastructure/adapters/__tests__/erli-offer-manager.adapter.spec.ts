/**
 * Erli Offer Manager Adapter — unit tests (#984)
 *
 * Mocks `IErliHttpClient` to verify: seller-keyed path build (validate+encode),
 * 202→'draft' create mapping, sparse PATCH for field/quantity updates, the
 * safe 4xx→OfferCreateRejectedException mapping (no responseBody leak), auth
 * propagation, hostile-id rejection, and imageUrl hygiene.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import {
  OfferCreateRejectedException,
  type CreateOfferCommand,
  type UpdateOfferFieldsCommand,
  type UpdateOfferQuantityCommand,
} from '@openlinker/core/listings';
import { ErliApiException } from '../../../domain/exceptions/erli-api.exception';
import { ErliAuthenticationException } from '../../../domain/exceptions/erli-authentication.exception';
import { ErliConfigException } from '../../../domain/exceptions/erli-config.exception';
import { ERLI_ADAPTER_KEY } from '../../../erli.constants';
import type { IErliHttpClient } from '../../http/erli-http-client.interface';
import { ErliOfferManagerAdapter } from '../erli-offer-manager.adapter';

const VALID_ID = `ol_variant_${'a'.repeat(32)}`;

// Erli create requires name + images (#984 fail-closed): every command needs a
// title + one image by default. `overrides` is DEEP-merged so a per-test
// `overrides` extends the defaults instead of replacing them — pass an explicit
// `title: undefined` / `imageUrls: []` to exercise the fail-closed guards.
function createCmd(overrides: Partial<CreateOfferCommand> = {}): CreateOfferCommand {
  const { overrides: ov, ...rest } = overrides;
  return {
    internalVariantId: VALID_ID,
    connectionId: 'conn-1',
    price: { amount: 49.99, currency: 'PLN' },
    stock: 10,
    publishImmediately: true,
    ...rest,
    overrides: {
      title: 'Default Widget',
      imageUrls: ['https://cdn.example.com/default.jpg'],
      ...ov,
    },
  };
}

describe('ErliOfferManagerAdapter', () => {
  let httpClient: jest.Mocked<IErliHttpClient>;
  let adapter: ErliOfferManagerAdapter;

  beforeEach(() => {
    httpClient = {
      get: jest.fn(),
      post: jest.fn().mockResolvedValue({ status: 202, data: undefined }),
      patch: jest.fn().mockResolvedValue({ status: 202, data: undefined }),
    };
    adapter = new ErliOfferManagerAdapter('conn-1', ERLI_ADAPTER_KEY, httpClient, {
      period: 2,
      unit: 'day',
    });
  });

  describe('createOffer', () => {
    it("should submit to the seller-keyed product path and return status 'draft' on 202", async () => {
      const result = await adapter.createOffer(createCmd());

      expect(httpClient.post).toHaveBeenCalledTimes(1);
      const [path, , options] = httpClient.post.mock.calls[0];
      expect(path).toBe(`products/${VALID_ID}`);
      expect(options).toEqual({ idempotent: true });
      expect(result).toEqual({ externalOfferId: VALID_ID, status: 'draft' });
    });

    it('should map the basic command fields into the create body', async () => {
      await adapter.createOffer(
        createCmd({
          overrides: { title: 'Widget', description: 'A nice widget', imageUrls: ['https://cdn.example.com/a.jpg'] },
          variantBarcode: '5901234123457',
        }),
      );

      const body = httpClient.post.mock.calls[0][1];
      expect(body).toEqual({
        price: 4999,
        stock: 10,
        images: [{ url: 'https://cdn.example.com/a.jpg' }],
        dispatchTime: { period: 2, unit: 'day' },
        name: 'Widget',
        description: 'A nice widget',
        ean: '5901234123457',
      });
    });

    it('should serialise price as integer minor units (grosze)', async () => {
      await adapter.createOffer(createCmd({ price: { amount: 19.99, currency: 'PLN' } }));
      const body = httpClient.post.mock.calls[0][1] as { price?: number };
      expect(body.price).toBe(1999);
    });

    it('should let a per-offer platformParams.dispatchTime override the connection default', async () => {
      await adapter.createOffer(
        createCmd({ overrides: { platformParams: { dispatchTime: { period: 5, unit: 'hour' } } } }),
      );
      const body = httpClient.post.mock.calls[0][1] as { dispatchTime?: unknown };
      expect(body.dispatchTime).toEqual({ period: 5, unit: 'hour' });
    });

    it('should fail closed when no per-offer nor connection-default dispatch time is present', async () => {
      const noDefault = new ErliOfferManagerAdapter('conn-1', ERLI_ADAPTER_KEY, httpClient);
      await expect(noDefault.createOffer(createCmd())).rejects.toBeInstanceOf(ErliConfigException);
      expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('should fail closed (no HTTP call) when the title (name) is absent or blank', async () => {
      await expect(
        adapter.createOffer(createCmd({ overrides: { title: undefined } })),
      ).rejects.toBeInstanceOf(ErliConfigException);
      await expect(
        adapter.createOffer(createCmd({ overrides: { title: '   ' } })),
      ).rejects.toBeInstanceOf(ErliConfigException);
      expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('should fail closed (no HTTP call) when no valid public image survives sanitisation', async () => {
      await expect(
        adapter.createOffer(createCmd({ overrides: { imageUrls: [] } })),
      ).rejects.toBeInstanceOf(ErliConfigException);
      // An only-unsafe set sanitises to empty → same fail-closed path.
      await expect(
        adapter.createOffer(createCmd({ overrides: { imageUrls: ['http://x/insecure.jpg'] } })),
      ).rejects.toBeInstanceOf(ErliConfigException);
      expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('should fail closed (no HTTP call) on a non-finite price amount', async () => {
      await expect(
        adapter.createOffer(createCmd({ price: { amount: Number.NaN, currency: 'PLN' } })),
      ).rejects.toBeInstanceOf(ErliConfigException);
      expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('should drop non-https / internal image URLs', async () => {
      await adapter.createOffer(
        createCmd({
          overrides: {
            imageUrls: ['https://cdn.example.com/ok.jpg', 'http://x/insecure.jpg', 'https://169.254.169.254/meta'],
          },
        }),
      );
      const body = httpClient.post.mock.calls[0][1] as { images?: { url: string }[] };
      expect(body.images).toEqual([{ url: 'https://cdn.example.com/ok.jpg' }]);
    });

    it('should map a 4xx ErliApiException to OfferCreateRejectedException without leaking responseBody', async () => {
      httpClient.post.mockRejectedValue(
        new ErliApiException('rejected', 422, 'SECRET submitted payload echo', 'https://erli.pl/x'),
      );

      const error: unknown = await adapter.createOffer(createCmd()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OfferCreateRejectedException);
      const rejection = error as OfferCreateRejectedException;
      expect(rejection.adapterKey).toBe(ERLI_ADAPTER_KEY);
      expect(rejection.statusCode).toBe(422);
      const messages = rejection.errors.map((e) => e.message).join(' ');
      expect(messages).not.toContain('SECRET submitted payload echo');
    });

    it('should propagate an authentication error (not wrap it)', async () => {
      httpClient.post.mockRejectedValueOnce(new ErliAuthenticationException('unauthorized', 401));
      await expect(adapter.createOffer(createCmd())).rejects.toBeInstanceOf(ErliAuthenticationException);
    });

    it('should reject a hostile internalVariantId before any HTTP call', async () => {
      await expect(
        adapter.createOffer(createCmd({ internalVariantId: 'ol_variant_../admin' })),
      ).rejects.toBeInstanceOf(ErliConfigException);
      expect(httpClient.post).not.toHaveBeenCalled();
    });
  });

  describe('updateOfferFields', () => {
    it('should issue a sparse PATCH touching only supplied fields', async () => {
      const cmd: UpdateOfferFieldsCommand = {
        externalOfferId: VALID_ID,
        fields: { title: 'New title' },
      };
      await adapter.updateOfferFields(cmd);

      expect(httpClient.patch).toHaveBeenCalledWith(`products/${VALID_ID}`, { name: 'New title' });
    });

    it('should map price + description when supplied', async () => {
      await adapter.updateOfferFields({
        externalOfferId: VALID_ID,
        fields: {
          price: { amount: '79.00', currency: 'PLN' },
          description: { sections: [{ items: [{ type: 'TEXT', content: 'Line 1' }] }] },
        },
      });
      expect(httpClient.patch).toHaveBeenCalledWith(`products/${VALID_ID}`, {
        price: 7900,
        description: 'Line 1',
      });
    });

    it('should flatten a multi-section / multi-item description with blank-line joins', async () => {
      await adapter.updateOfferFields({
        externalOfferId: VALID_ID,
        fields: {
          description: {
            sections: [
              { items: [{ type: 'TEXT', content: 'A' }, { type: 'TEXT', content: 'B' }] },
              { items: [{ type: 'TEXT', content: 'C' }] },
            ],
          },
        },
      });
      expect(httpClient.patch).toHaveBeenCalledWith(`products/${VALID_ID}`, {
        description: 'A\n\nB\n\nC',
      });
    });

    it('should reject a hostile externalOfferId', async () => {
      await expect(
        adapter.updateOfferFields({ externalOfferId: 'evil/../x', fields: { title: 'x' } }),
      ).rejects.toBeInstanceOf(ErliConfigException);
    });
  });

  describe('updateOfferQuantity', () => {
    it('should PATCH only the stock field', async () => {
      const cmd: UpdateOfferQuantityCommand = { offerId: VALID_ID, quantity: 7 };
      await adapter.updateOfferQuantity(cmd);

      expect(httpClient.patch).toHaveBeenCalledWith(`products/${VALID_ID}`, { stock: 7 });
    });

    it('should reject a hostile offerId', async () => {
      await expect(
        adapter.updateOfferQuantity({ offerId: 'evil/../x', quantity: 1 }),
      ).rejects.toBeInstanceOf(ErliConfigException);
    });
  });
});
