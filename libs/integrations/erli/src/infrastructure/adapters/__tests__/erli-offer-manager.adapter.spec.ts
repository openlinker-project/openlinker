/**
 * Erli Offer Manager Adapter — unit tests (#984, #985, #988)
 *
 * Mocks `IErliHttpClient` to verify: seller-keyed path build (validate+encode),
 * 202→'draft' create mapping, sparse PATCH for field/quantity updates, the
 * safe 4xx→OfferCreateRejectedException mapping (no responseBody leak), auth
 * propagation, hostile-id rejection, imageUrl hygiene, the #985 Allegro
 * category/parameter reuse (source:"allegro" externalCategories/Attributes),
 * and the #988 frozen-field exclusion (read-before-PATCH drops frozen fields;
 * all-frozen → no-op; hot quantity path stays single-call).
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import {
  OfferCreateRejectedException,
  type CreateOfferCommand,
  type UpdateOfferFieldsCommand,
  type UpdateOfferQuantityCommand,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';
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
    // Default to a resolvable Allegro category: ADR-025 §3 makes a missing one a
    // terminal rejection, so the happy-path/unrelated tests must carry one.
    overrides: {
      title: 'Default Widget',
      imageUrls: ['https://cdn.example.com/default.jpg'],
      categoryId: '18654',
      ...ov,
    },
  };
}

describe('ErliOfferManagerAdapter', () => {
  let httpClient: jest.Mocked<IErliHttpClient>;
  let adapter: ErliOfferManagerAdapter;

  beforeEach(() => {
    httpClient = {
      // Default read: no frozen fields, so field-updates PATCH everything supplied.
      get: jest.fn().mockResolvedValue({ status: 200, data: { frozenFields: [] } }),
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
          overrides: {
            categoryId: '18654',
            title: 'Widget',
            description: 'A nice widget',
            imageUrls: ['https://cdn.example.com/a.jpg'],
          },
          variantBarcode: '5901234123457',
        }),
      );

      const body = httpClient.post.mock.calls[0][1];
      // toMatchObject: this test covers basic-field mapping, not taxonomy
      // (externalCategories is asserted by the #985 reuse tests).
      expect(body).toMatchObject({
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
        createCmd({
          overrides: {
            categoryId: '18654',
            platformParams: { dispatchTime: { period: 5, unit: 'hour' } },
          },
        }),
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
            categoryId: '18654',
            imageUrls: ['https://cdn.example.com/ok.jpg', 'http://x/insecure.jpg', 'https://169.254.169.254/meta'],
          },
        }),
      );
      const body = httpClient.post.mock.calls[0][1] as { images?: { url: string }[] };
      expect(body.images).toEqual([{ url: 'https://cdn.example.com/ok.jpg' }]);
    });

    it('should drop IPv6 loopback/ULA/link-local and 0.0.0.0 image URLs', async () => {
      await adapter.createOffer(
        createCmd({
          overrides: {
            imageUrls: [
              'https://cdn.example.com/ok.jpg',
              'https://[::1]/meta', // IPv6 loopback
              'https://[::]/meta', // IPv6 unspecified
              'https://[fc00::1]/meta', // IPv6 ULA (fc00::/7)
              'https://[fd12:3456::1]/meta', // IPv6 ULA (fd prefix)
              'https://[fe80::1]/meta', // IPv6 link-local (fe80::/10)
              'https://0.0.0.0/meta', // IPv4 unspecified
            ],
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

    describe('category & parameter reuse (#985)', () => {
      it('should map overrides.categoryId into a source:"allegro" externalCategories entry', async () => {
        await adapter.createOffer(createCmd({ overrides: { categoryId: '18654' } }));

        const body = httpClient.post.mock.calls[0][1] as {
          externalCategories?: unknown;
        };
        expect(body.externalCategories).toEqual([{ source: 'allegro', id: '18654' }]);
      });

      it('should map a dictionary parameter (valuesIds → type:dictionary)', async () => {
        await adapter.createOffer(
          createCmd({
            parameters: [{ id: '11323', valuesIds: ['11323_1'], section: 'offer' }],
          }),
        );

        const body = httpClient.post.mock.calls[0][1] as { externalAttributes?: unknown };
        expect(body.externalAttributes).toEqual([
          { source: 'allegro', id: '11323', type: 'dictionary', values: ['11323_1'] },
        ]);
      });

      it('should map a free-text parameter (values → type:string)', async () => {
        await adapter.createOffer(
          createCmd({
            parameters: [{ id: '224017', values: ['Acme'], section: 'product' }],
          }),
        );

        const body = httpClient.post.mock.calls[0][1] as { externalAttributes?: unknown };
        expect(body.externalAttributes).toEqual([
          { source: 'allegro', id: '224017', type: 'string', values: ['Acme'] },
        ]);
      });

      it('should merge offer-section and product-section params into one flat list', async () => {
        await adapter.createOffer(
          createCmd({
            parameters: [
              { id: '11323', valuesIds: ['11323_1'], section: 'offer' },
              { id: '224017', values: ['Acme'], section: 'product' },
            ],
          }),
        );

        const body = httpClient.post.mock.calls[0][1] as { externalAttributes?: unknown };
        expect(body.externalAttributes).toEqual([
          { source: 'allegro', id: '11323', type: 'dictionary', values: ['11323_1'] },
          { source: 'allegro', id: '224017', type: 'string', values: ['Acme'] },
        ]);
      });

      it('should throw OfferCreateRejectedException and NOT POST when no Allegro taxonomy resolves (ADR-025 §3)', async () => {
        // Explicitly clear the helper's default categoryId so no Allegro taxonomy resolves.
        await expect(
          adapter.createOffer(createCmd({ overrides: { categoryId: undefined } })),
        ).rejects.toBeInstanceOf(OfferCreateRejectedException);
        expect(httpClient.post).not.toHaveBeenCalled();
      });

      it('should omit externalAttributes when the category is present but no params map', async () => {
        await adapter.createOffer(createCmd({ overrides: { categoryId: '18654' } }));

        const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
        expect(body).toHaveProperty('externalCategories');
        expect(body).not.toHaveProperty('externalAttributes');
      });

      it('should drop empty-id parameter entries', async () => {
        await adapter.createOffer(
          createCmd({
            parameters: [
              { id: '', values: ['x'], section: 'offer' },
              { id: '11323', valuesIds: ['11323_1'], section: 'offer' },
            ],
          }),
        );

        const body = httpClient.post.mock.calls[0][1] as { externalAttributes?: unknown };
        expect(body.externalAttributes).toEqual([
          { source: 'allegro', id: '11323', type: 'dictionary', values: ['11323_1'] },
        ]);
      });

      it('should drop a rangeValue-only parameter (no values/valuesIds) in v1 and debug-log it', async () => {
        const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
        try {
          await adapter.createOffer(
            createCmd({
              parameters: [{ id: '12345', rangeValue: { from: '1', to: '10' }, section: 'offer' }],
            }),
          );

          const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
          expect(body).not.toHaveProperty('externalAttributes');
          // The dropped param id is surfaced so it isn't silently lost (#985 R3).
          expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('12345'));
        } finally {
          debugSpy.mockRestore();
        }
      });
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

    describe('frozen-field exclusion (#988)', () => {
      it('should read the live product via GET before patching', async () => {
        await adapter.updateOfferFields({ externalOfferId: VALID_ID, fields: { title: 'New' } });

        expect(httpClient.get).toHaveBeenCalledWith(`products/${VALID_ID}`);
      });

      it('should drop a supplied field that is frozen and patch the rest', async () => {
        httpClient.get.mockResolvedValue({ status: 200, data: { frozenFields: ['price'] } });

        await adapter.updateOfferFields({
          externalOfferId: VALID_ID,
          fields: { title: 'Keep me', price: { amount: '79.00', currency: 'PLN' } },
        });

        // price frozen → dropped; name survives.
        expect(httpClient.patch).toHaveBeenCalledWith(`products/${VALID_ID}`, { name: 'Keep me' });
      });

      it('should patch the full body when the GET returns an empty body (no frozen info)', async () => {
        // The client yields `data: undefined` for a 204 / empty-body 2xx; the read
        // must degrade to "nothing frozen" rather than throwing on current.frozenFields (#1061).
        httpClient.get.mockResolvedValue({ status: 200, data: undefined });

        await adapter.updateOfferFields({
          externalOfferId: VALID_ID,
          fields: { title: 'T', price: { amount: '5.00', currency: 'PLN' } },
        });

        expect(httpClient.patch).toHaveBeenCalledWith(`products/${VALID_ID}`, {
          name: 'T',
          price: { amount: 5, currency: 'PLN' },
        });
      });

      it('should patch every supplied field when none are frozen', async () => {
        httpClient.get.mockResolvedValue({ status: 200, data: { frozenFields: [] } });

        await adapter.updateOfferFields({
          externalOfferId: VALID_ID,
          fields: { title: 'T', price: { amount: '5.00', currency: 'PLN' } },
        });

        expect(httpClient.patch).toHaveBeenCalledWith(`products/${VALID_ID}`, {
          name: 'T',
          price: { amount: 5, currency: 'PLN' },
        });
      });

      it('should issue NO patch when every supplied field is frozen', async () => {
        httpClient.get.mockResolvedValue({
          status: 200,
          data: { frozenFields: ['name', 'price'] },
        });

        await adapter.updateOfferFields({
          externalOfferId: VALID_ID,
          fields: { title: 'T', price: { amount: '5.00', currency: 'PLN' } },
        });

        expect(httpClient.patch).not.toHaveBeenCalled();
      });

      it('should fail open and PATCH the full body when the GET 404s in the cache-lag window', async () => {
        // ADR-025: a just-created offer GET-404s during Erli's ~20-min cache lag (#1061).
        httpClient.get.mockRejectedValue(new ErliApiException('not found', 404));

        await adapter.updateOfferFields({
          externalOfferId: VALID_ID,
          fields: { title: 'T', price: { amount: '5.00', currency: 'PLN' } },
        });

        expect(httpClient.patch).toHaveBeenCalledWith(`products/${VALID_ID}`, {
          name: 'T',
          price: { amount: 5, currency: 'PLN' },
        });
      });

      it('should re-throw a non-404 GET error rather than failing open', async () => {
        httpClient.get.mockRejectedValue(new ErliApiException('server error', 500));

        await expect(
          adapter.updateOfferFields({ externalOfferId: VALID_ID, fields: { title: 'T' } }),
        ).rejects.toBeInstanceOf(ErliApiException);
        expect(httpClient.patch).not.toHaveBeenCalled();
      });
    });
  });

  describe('updateOfferQuantity', () => {
    it('should PATCH only the stock field', async () => {
      const cmd: UpdateOfferQuantityCommand = { offerId: VALID_ID, quantity: 7 };
      await adapter.updateOfferQuantity(cmd);

      expect(httpClient.patch).toHaveBeenCalledWith(`products/${VALID_ID}`, { stock: 7 });
    });

    it('should NOT pre-fetch the product (hot inventory path stays single-call, #988 §3d)', async () => {
      await adapter.updateOfferQuantity({ offerId: VALID_ID, quantity: 7 });

      expect(httpClient.get).not.toHaveBeenCalled();
      expect(httpClient.patch).toHaveBeenCalledTimes(1);
    });

    it('should reject a hostile offerId', async () => {
      await expect(
        adapter.updateOfferQuantity({ offerId: 'evil/../x', quantity: 1 }),
      ).rejects.toBeInstanceOf(ErliConfigException);
    });
  });
});
