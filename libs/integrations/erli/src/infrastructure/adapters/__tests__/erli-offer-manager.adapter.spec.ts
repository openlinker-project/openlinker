/**
 * Erli Offer Manager Adapter — unit tests (#984, #985, #986, #988, #989)
 *
 * Mocks `IErliHttpClient` to verify: seller-keyed path build (validate+encode),
 * 202→'draft' create mapping (#989/#1063), sparse PATCH for field/quantity
 * updates, the safe 4xx→OfferCreateRejectedException mapping (no responseBody
 * leak), auth propagation, hostile-id rejection, imageUrl hygiene, the #985
 * Allegro category/parameter reuse, the #988 frozen-field exclusion, and the
 * #989 OfferStatusReader.getOfferStatus mapping (Erli status → neutral
 * OfferPublicationStatus; 404 → OfferNotFoundOnMarketplaceException).
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import {
  isOfferStatusReader,
  OfferCreateRejectedException,
  OfferNotFoundOnMarketplaceException,
  type CreateOfferCommand,
  type UpdateOfferFieldsCommand,
  type UpdateOfferQuantityCommand,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';
import type { CachePort } from '@openlinker/shared';
import { ErliApiException } from '../../../domain/exceptions/erli-api.exception';
import { ErliAuthenticationException } from '../../../domain/exceptions/erli-authentication.exception';
import { ErliConfigException } from '../../../domain/exceptions/erli-config.exception';
import { ErliNetworkException } from '../../../domain/exceptions/erli-network.exception';
import { ERLI_ADAPTER_KEY } from '../../../erli.constants';
import type { IErliHttpClient } from '../../http/erli-http-client.interface';
import {
  ErliOfferManagerAdapter,
  ERLI_FROZEN_STOCK_CACHE_TTL_SEC,
} from '../erli-offer-manager.adapter';

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
    // Default to a resolved Allegro category so unrelated tests exercise the
    // common path; a missing one now falls back to shop categories / none (#1096).
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
      put: jest.fn().mockResolvedValue({ status: 202, data: undefined }),
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
      // 'draft' (not 'validating'): avoids the Allegro-tuned creation poll that
      // would falsely fail valid offers during Erli's ~20-min cache lag (#1063);
      // the steady-state erli-offer-status-sync reconciles publication instead.
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

    it('should treat a 409 (already-exists) as an idempotent success, not a rejection', async () => {
      // POST /products/{id} is create-only and seller-keyed; a duplicate id 409s.
      // A retry / re-submit of an already-created offer must succeed idempotently.
      httpClient.post.mockRejectedValue(
        new ErliApiException('unique key duplication', 409, undefined, 'https://erli.pl/x'),
      );

      const result = await adapter.createOffer(createCmd());

      expect(result.status).toBe('draft');
      expect(result.externalOfferId).toBe(VALID_ID);
      // Flagged so the execution service records it as `reused`, not a fresh create.
      expect(result.alreadyExisted).toBe(true);
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
      it('should map overrides.categoryId into a source:"allegro" breadcrumb entry', async () => {
        await adapter.createOffer(createCmd({ overrides: { categoryId: '18654' } }));

        const body = httpClient.post.mock.calls[0][1] as {
          externalCategories?: unknown;
        };
        expect(body.externalCategories).toEqual([
          { source: 'allegro', breadcrumb: [{ id: '18654' }] },
        ]);
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

      it('should fall back to source:"shop" categories when no Allegro id is resolved (#1096)', async () => {
        await adapter.createOffer(
          createCmd({
            overrides: { categoryId: undefined },
            sourceCategories: [{ id: '12', name: 'Widgets' }, { id: '34' }],
          }),
        );

        expect(httpClient.post).toHaveBeenCalledTimes(1);
        const body = httpClient.post.mock.calls[0][1] as { externalCategories?: unknown };
        expect(body.externalCategories).toEqual([
          { source: 'shop', breadcrumb: [{ id: '12', name: 'Widgets' }, { id: '34' }] },
        ]);
      });

      it('should omit externalCategories and still POST when neither Allegro nor shop taxonomy is present (ADR-025 §3 relaxed)', async () => {
        await adapter.createOffer(createCmd({ overrides: { categoryId: undefined }, sourceCategories: [] }));

        expect(httpClient.post).toHaveBeenCalledTimes(1);
        const body = httpClient.post.mock.calls[0][1] as { externalCategories?: unknown };
        expect(body.externalCategories).toBeUndefined();
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

    describe('variant grouping (#986/#1065)', () => {
      const GROUP_ID = `ol_product_${'b'.repeat(32)}`;

      it('should map a distinguishing axis to an indexed shop externalAttribute + an externalVariantGroup referencing it (#986)', async () => {
        await adapter.createOffer(
          createCmd({
            variantGroup: {
              groupId: GROUP_ID,
              attributes: [{ name: 'Color', value: 'Red' }],
            },
          }),
        );

        const body = httpClient.post.mock.calls[0][1] as {
          externalVariantGroup?: unknown;
          externalAttributes?: unknown;
          attributes?: unknown;
        };
        // The axis becomes a shop-source externalAttribute carrying an explicit
        // index; the group references that index (Erli's verified wire shape).
        expect(body.externalAttributes).toEqual([
          { source: 'shop', id: 'Color', name: 'Color', type: 'string', values: ['Red'], index: 0 },
        ]);
        expect(body.externalVariantGroup).toEqual({
          id: GROUP_ID,
          source: 'integration',
          attributes: [0],
        });
        // The API rejects a top-level `attributes` field — it must not be sent.
        expect(body).not.toHaveProperty('attributes');
      });

      it('should list ungrouped (no externalVariantGroup/attributes) when no variantGroup is present', async () => {
        await adapter.createOffer(createCmd());

        const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
        expect(body).not.toHaveProperty('externalVariantGroup');
        expect(body).not.toHaveProperty('attributes');
      });

      it('should ignore an empty groupId (treats as ungrouped)', async () => {
        await adapter.createOffer(createCmd({ variantGroup: { groupId: '', attributes: [] } }));

        const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
        expect(body).not.toHaveProperty('externalVariantGroup');
        expect(body).not.toHaveProperty('attributes');
      });

      it('should give sibling variants the same group id while each posts to its own path', async () => {
        const variantA = `ol_variant_${'a'.repeat(32)}`;
        const variantB = `ol_variant_${'c'.repeat(32)}`;

        await adapter.createOffer(
          createCmd({
            internalVariantId: variantA,
            variantGroup: { groupId: GROUP_ID, attributes: [{ name: 'Color', value: 'Red' }] },
          }),
        );
        await adapter.createOffer(
          createCmd({
            internalVariantId: variantB,
            variantGroup: { groupId: GROUP_ID, attributes: [{ name: 'Color', value: 'Blue' }] },
          }),
        );

        const [pathA, bodyA] = httpClient.post.mock.calls[0] as [
          string,
          { externalVariantGroup?: { id?: string } },
        ];
        const [pathB, bodyB] = httpClient.post.mock.calls[1] as [
          string,
          { externalVariantGroup?: { id?: string } },
        ];
        expect(pathA).toBe(`products/${variantA}`);
        expect(pathB).toBe(`products/${variantB}`);
        expect(bodyA.externalVariantGroup?.id).toBe(GROUP_ID);
        expect(bodyB.externalVariantGroup?.id).toBe(GROUP_ID);
      });

      it('should NOT emit a group when the variant has no distinguishing axes (Erli requires ≥1)', async () => {
        await adapter.createOffer(createCmd({ variantGroup: { groupId: GROUP_ID, attributes: [] } }));

        const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
        expect(body).not.toHaveProperty('externalVariantGroup');
        expect(body).not.toHaveProperty('attributes');
      });

      it('should index multiple distinguishing axes and reference them all in the group', async () => {
        await adapter.createOffer(
          createCmd({
            variantGroup: {
              groupId: GROUP_ID,
              attributes: [
                { name: 'Color', value: 'Red' },
                { name: 'Size', value: 'M' },
              ],
            },
          }),
        );

        const body = httpClient.post.mock.calls[0][1] as {
          externalAttributes?: unknown;
          externalVariantGroup?: unknown;
        };
        expect(body.externalAttributes).toEqual([
          { source: 'shop', id: 'Color', name: 'Color', type: 'string', values: ['Red'], index: 0 },
          { source: 'shop', id: 'Size', name: 'Size', type: 'string', values: ['M'], index: 1 },
        ]);
        expect(body.externalVariantGroup).toEqual({
          id: GROUP_ID,
          source: 'integration',
          attributes: [0, 1],
        });
      });

      it('should never emit grouping on a field-update or quantity PATCH (create-only)', async () => {
        await adapter.updateOfferFields({ externalOfferId: VALID_ID, fields: { title: 'T' } });
        await adapter.updateOfferQuantity({ offerId: VALID_ID, quantity: 3 });

        for (const call of httpClient.patch.mock.calls) {
          const body = call[1] as Record<string, unknown>;
          expect(body).not.toHaveProperty('externalVariantGroup');
          expect(body).not.toHaveProperty('attributes');
        }
      });
    });

    describe('shop product features → externalAttributes (#1096 F2)', () => {
      const GROUP_ID = `ol_product_${'b'.repeat(32)}`;

      it('should emit each feature as a shop-source string externalAttribute with a positional index', async () => {
        await adapter.createOffer(
          createCmd({
            overrides: {}, // no Allegro category/params, so no param attributes precede
            sourceAttributes: [
              { id: 'material', name: 'Material', value: 'Ceramic' },
              { id: 'color', name: 'Color', value: 'Blue', unit: undefined },
            ],
          }),
        );

        const body = httpClient.post.mock.calls[0][1] as { externalAttributes?: unknown };
        expect(body.externalAttributes).toEqual([
          { source: 'shop', id: 'material', name: 'Material', type: 'string', values: ['Ceramic'], index: 0 },
          { source: 'shop', id: 'color', name: 'Color', type: 'string', values: ['Blue'], index: 1 },
        ]);
      });

      it('should carry the unit when a feature supplies one', async () => {
        await adapter.createOffer(
          createCmd({
            overrides: {},
            sourceAttributes: [{ id: 'weight', name: 'Weight', value: '500', unit: 'g' }],
          }),
        );

        const body = httpClient.post.mock.calls[0][1] as {
          externalAttributes?: Array<Record<string, unknown>>;
        };
        expect(body.externalAttributes?.[0]).toEqual({
          source: 'shop',
          id: 'weight',
          name: 'Weight',
          type: 'string',
          values: ['500'],
          index: 0,
          unit: 'g',
        });
      });

      it('should fall back to the feature name as id when the slug id is absent', async () => {
        await adapter.createOffer(
          createCmd({
            overrides: {},
            sourceAttributes: [{ name: 'Material', value: 'Ceramic' }],
          }),
        );

        const body = httpClient.post.mock.calls[0][1] as {
          externalAttributes?: Array<Record<string, unknown>>;
        };
        expect(body.externalAttributes?.[0]).toMatchObject({ id: 'Material', name: 'Material' });
      });

      it('should drop features with an empty name or value', async () => {
        await adapter.createOffer(
          createCmd({
            overrides: {},
            sourceAttributes: [
              { id: 'a', name: '', value: 'x' },
              { id: 'b', name: 'Material', value: '' },
              { id: 'c', name: 'Color', value: 'Red' },
            ],
          }),
        );

        const body = httpClient.post.mock.calls[0][1] as {
          externalAttributes?: Array<Record<string, unknown>>;
        };
        expect(body.externalAttributes).toEqual([
          { source: 'shop', id: 'c', name: 'Color', type: 'string', values: ['Red'], index: 0 },
        ]);
      });

      it('should append features AFTER Allegro param attributes (param indexes precede feature indexes)', async () => {
        await adapter.createOffer(
          createCmd({
            overrides: { categoryId: '18654' },
            parameters: [{ id: '11323', section: 'product', values: ['Acme'] }],
            sourceAttributes: [{ id: 'material', name: 'Material', value: 'Ceramic' }],
          }),
        );

        const body = httpClient.post.mock.calls[0][1] as {
          externalAttributes?: Array<Record<string, unknown>>;
        };
        // Param attribute first (no index on the #985 path), feature appended with
        // its absolute index = 1 (one preceding param attribute).
        expect(body.externalAttributes).toEqual([
          { source: 'allegro', id: '11323', type: 'string', values: ['Acme'] },
          { source: 'shop', id: 'material', name: 'Material', type: 'string', values: ['Ceramic'], index: 1 },
        ]);
      });

      it('should keep variant-group index refs valid when features are appended after the group axes', async () => {
        await adapter.createOffer(
          createCmd({
            overrides: {},
            variantGroup: { groupId: GROUP_ID, attributes: [{ name: 'Color', value: 'Red' }] },
            sourceAttributes: [{ id: 'material', name: 'Material', value: 'Ceramic' }],
          }),
        );

        const body = httpClient.post.mock.calls[0][1] as {
          externalAttributes?: Array<Record<string, unknown>>;
          externalVariantGroup?: { attributes?: number[] };
        };
        // Axis at index 0 (group references it), feature appended at index 1.
        expect(body.externalAttributes).toEqual([
          { source: 'shop', id: 'Color', name: 'Color', type: 'string', values: ['Red'], index: 0 },
          { source: 'shop', id: 'material', name: 'Material', type: 'string', values: ['Ceramic'], index: 1 },
        ]);
        // Group must reference ONLY the axis index (0), never the feature index (1).
        expect(body.externalVariantGroup?.attributes).toEqual([0]);
      });

      it('should omit externalAttributes entirely when there are no params, axes, or features', async () => {
        await adapter.createOffer(createCmd({ overrides: {} }));

        const body = httpClient.post.mock.calls[0][1] as Record<string, unknown>;
        expect(body).not.toHaveProperty('externalAttributes');
      });

      it('should never emit feature attributes on a field-update PATCH (create-only)', async () => {
        await adapter.updateOfferFields({ externalOfferId: VALID_ID, fields: { title: 'T' } });

        for (const call of httpClient.patch.mock.calls) {
          const body = call[1] as Record<string, unknown>;
          expect(body).not.toHaveProperty('externalAttributes');
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
          price: 500,
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
          price: 500,
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
          price: 500,
        });
      });

      it('should re-throw a transient network/5xx GET error rather than failing open', async () => {
        // The client surfaces a transient 5xx / connection failure as
        // ErliNetworkException (NOT ErliApiException — only deterministic 4xx
        // become ErliApiException). Only a 404 fails open; everything else,
        // including this realistic transient error, must re-throw so the
        // runner's retry classifier decides (#1061).
        httpClient.get.mockRejectedValue(new ErliNetworkException('connection reset'));

        await expect(
          adapter.updateOfferFields({ externalOfferId: VALID_ID, fields: { title: 'T' } }),
        ).rejects.toBeInstanceOf(ErliNetworkException);
        expect(httpClient.patch).not.toHaveBeenCalled();
      });

      it('should re-throw a non-404 ErliApiException (e.g. 403) rather than failing open', async () => {
        httpClient.get.mockRejectedValue(new ErliApiException('forbidden', 403));

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

  describe('getOfferStatus (#989)', () => {
    it('should be detectable as an OfferStatusReader', () => {
      expect(isOfferStatusReader(adapter)).toBe(true);
    });

    it.each([
      ['active', 'active'],
      ['accepted', 'activating'],
      ['inactive', 'inactive'],
      [undefined, 'inactive'],
    ])('should map Erli status %s → publicationStatus %s', async (erliStatus, expected) => {
      httpClient.get.mockResolvedValueOnce({ status: 200, data: { status: erliStatus } });

      const result = await adapter.getOfferStatus(VALID_ID);

      expect(result.publicationStatus).toBe(expected);
      expect(result.validationErrors).toEqual([]);
      expect(httpClient.get).toHaveBeenCalledWith(`products/${VALID_ID}`);
    });

    it('should map rejected → inactive carrying the reason in validationErrors', async () => {
      httpClient.get.mockResolvedValueOnce({
        status: 200,
        data: { status: 'rejected', statusReason: 'EAN already used' },
      });

      const result = await adapter.getOfferStatus(VALID_ID);

      expect(result.publicationStatus).toBe('inactive');
      expect(result.validationErrors).toEqual([
        { code: 'ERLI_REJECTED', message: 'EAN already used' },
      ]);
    });

    it('should throw OfferNotFoundOnMarketplaceException on a 404', async () => {
      httpClient.get.mockRejectedValueOnce(new ErliApiException('not found', 404));

      await expect(adapter.getOfferStatus(VALID_ID)).rejects.toBeInstanceOf(
        OfferNotFoundOnMarketplaceException,
      );
    });

    it('should propagate non-404 transport errors', async () => {
      httpClient.get.mockRejectedValueOnce(new ErliApiException('server error', 500));

      await expect(adapter.getOfferStatus(VALID_ID)).rejects.toBeInstanceOf(ErliApiException);
    });

    it('should reject a hostile externalOfferId before any GET', async () => {
      await expect(adapter.getOfferStatus('evil/../x')).rejects.toBeInstanceOf(ErliConfigException);
      expect(httpClient.get).not.toHaveBeenCalled();
    });
  });

  describe('frozen-stock cache flag (#1066)', () => {
    let cache: jest.Mocked<CachePort>;
    let cachedAdapter: ErliOfferManagerAdapter;
    const EXPECTED_KEY = `erli:frozen-stock:conn-1:${VALID_ID}`;
    // Imported from the adapter — single source of truth, no hand-synced copy.
    const EXPECTED_TTL = ERLI_FROZEN_STOCK_CACHE_TTL_SEC;

    beforeEach(() => {
      cache = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
      };
      cachedAdapter = new ErliOfferManagerAdapter('conn-1', ERLI_ADAPTER_KEY, httpClient, undefined, cache);
    });

    it('should skip the stock PATCH after reconciliation observed a frozen stock (write→read round-trip)', async () => {
      // Linchpin: writer (getOfferStatus) and reader (updateOfferQuantity) MUST
      // build the same key. Drive a real round-trip through one mocked cache.
      const store = new Map<string, unknown>();
      cache.set.mockImplementation((key, value) => {
        store.set(key, value);
        return Promise.resolve();
      });
      cache.get.mockImplementation((key) => Promise.resolve((store.get(key) ?? null) as never));
      httpClient.get.mockResolvedValueOnce({
        status: 200,
        data: { status: 'active', frozenFields: ['stock'] },
      });

      await cachedAdapter.getOfferStatus(VALID_ID);
      await cachedAdapter.updateOfferQuantity({ offerId: VALID_ID, quantity: 7 });

      expect(httpClient.patch).not.toHaveBeenCalled();
    });

    it('should NOT PATCH stock when the cached flag is true (frozen → skipped)', async () => {
      cache.get.mockResolvedValue(true);

      await cachedAdapter.updateOfferQuantity({ offerId: VALID_ID, quantity: 7 });

      expect(cache.get).toHaveBeenCalledWith(EXPECTED_KEY);
      expect(httpClient.patch).not.toHaveBeenCalled();
    });

    it('should PATCH stock when the cached flag is absent (not-frozen → pushed)', async () => {
      cache.get.mockResolvedValue(null);

      await cachedAdapter.updateOfferQuantity({ offerId: VALID_ID, quantity: 7 });

      expect(httpClient.patch).toHaveBeenCalledWith(`products/${VALID_ID}`, { stock: 7 });
    });

    it('should PATCH stock when the cache read errors (fail-open)', async () => {
      cache.get.mockRejectedValue(new Error('redis down'));

      await cachedAdapter.updateOfferQuantity({ offerId: VALID_ID, quantity: 7 });

      expect(httpClient.patch).toHaveBeenCalledWith(`products/${VALID_ID}`, { stock: 7 });
    });

    it('should not touch the cache and still run the push path for a hostile id', async () => {
      await expect(
        cachedAdapter.updateOfferQuantity({ offerId: 'not-a-valid-id', quantity: 1 }),
      ).rejects.toBeInstanceOf(ErliConfigException);

      expect(cache.get).not.toHaveBeenCalled();
    });

    it('should produce disjoint keys per connection for the same variant id', async () => {
      const adapterA = new ErliOfferManagerAdapter('conn-A', ERLI_ADAPTER_KEY, httpClient, undefined, cache);
      const adapterB = new ErliOfferManagerAdapter('conn-B', ERLI_ADAPTER_KEY, httpClient, undefined, cache);

      await adapterA.updateOfferQuantity({ offerId: VALID_ID, quantity: 1 });
      await adapterB.updateOfferQuantity({ offerId: VALID_ID, quantity: 1 });

      const keyA = cache.get.mock.calls[0][0];
      const keyB = cache.get.mock.calls[1][0];
      expect(keyA).toBe(`erli:frozen-stock:conn-A:${VALID_ID}`);
      expect(keyB).toBe(`erli:frozen-stock:conn-B:${VALID_ID}`);
      expect(keyA).not.toBe(keyB);
    });

    it('should set the flag with the TTL when reconciliation sees a frozen stock', async () => {
      httpClient.get.mockResolvedValueOnce({
        status: 200,
        data: { status: 'active', frozenFields: ['stock'] },
      });

      await cachedAdapter.getOfferStatus(VALID_ID);

      expect(cache.set).toHaveBeenCalledWith(EXPECTED_KEY, true, EXPECTED_TTL);
      expect(cache.delete).not.toHaveBeenCalled();
    });

    it('should delete the flag (not store false) when reconciliation sees stock not frozen', async () => {
      httpClient.get.mockResolvedValueOnce({
        status: 200,
        data: { status: 'active', frozenFields: [] },
      });

      await cachedAdapter.getOfferStatus(VALID_ID);

      expect(cache.delete).toHaveBeenCalledWith(EXPECTED_KEY);
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('should leave the cache untouched on a bodyless 2xx (frozenFields undefined)', async () => {
      httpClient.get.mockResolvedValueOnce({ status: 200, data: undefined });

      await cachedAdapter.getOfferStatus(VALID_ID);

      expect(cache.set).not.toHaveBeenCalled();
      expect(cache.delete).not.toHaveBeenCalled();
    });

    it('should not touch the cache when getOfferStatus 404s', async () => {
      httpClient.get.mockRejectedValueOnce(new ErliApiException('not found', 404));

      await expect(cachedAdapter.getOfferStatus(VALID_ID)).rejects.toBeInstanceOf(
        OfferNotFoundOnMarketplaceException,
      );
      expect(cache.set).not.toHaveBeenCalled();
      expect(cache.delete).not.toHaveBeenCalled();
    });

    it('should opportunistically set the flag from updateOfferFields (secondary writer)', async () => {
      httpClient.get.mockResolvedValue({ status: 200, data: { frozenFields: ['stock'] } });

      await cachedAdapter.updateOfferFields({ externalOfferId: VALID_ID, fields: { title: 'T' } });

      expect(cache.set).toHaveBeenCalledWith(EXPECTED_KEY, true, EXPECTED_TTL);
    });

    it('should issue NO GET on the hot quantity path whether frozen or not (#1066 AC)', async () => {
      cache.get.mockResolvedValueOnce(true);
      await cachedAdapter.updateOfferQuantity({ offerId: VALID_ID, quantity: 7 });
      cache.get.mockResolvedValueOnce(null);
      await cachedAdapter.updateOfferQuantity({ offerId: VALID_ID, quantity: 7 });

      expect(httpClient.get).not.toHaveBeenCalled();
    });
  });

  describe('restoreStockOnCancellation (#997 Half B / #1146 — OfferStockRestorer)', () => {
    const OFFER_A = `ol_variant_${'a'.repeat(32)}`;
    const OFFER_B = `ol_variant_${'b'.repeat(32)}`;

    it('sets the absolute target per offer (never reads back Erli stock)', async () => {
      await adapter.restoreStockOnCancellation([
        { externalOfferId: OFFER_A, quantity: 5 },
        { externalOfferId: OFFER_B, quantity: 12 },
      ]);

      // NO Erli read-back happens (no GET on the hot path).
      expect(httpClient.get).not.toHaveBeenCalled();
      // Absolute-set PATCH per offer with the core-resolved quantity.
      expect(httpClient.patch).toHaveBeenCalledTimes(2);
      expect(httpClient.patch).toHaveBeenCalledWith(`products/${OFFER_A}`, { stock: 5 });
      expect(httpClient.patch).toHaveBeenCalledWith(`products/${OFFER_B}`, { stock: 12 });
    });

    it('restores to 0 when the target quantity is 0 (master authoritative incl. 0)', async () => {
      await adapter.restoreStockOnCancellation([{ externalOfferId: OFFER_A, quantity: 0 }]);

      expect(httpClient.patch).toHaveBeenCalledWith(`products/${OFFER_A}`, { stock: 0 });
    });

    it('is a no-op when the cancelled order has no Erli offer mapping (empty targets)', async () => {
      await adapter.restoreStockOnCancellation([]);

      expect(httpClient.patch).not.toHaveBeenCalled();
    });
  });
});
