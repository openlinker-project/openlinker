/**
 * ContentController unit tests (#486)
 *
 * Focused on `mapExceptions` — particularly the new `AllegroApiException`
 * branch that surfaces structured 422 errors to the FE.
 *
 * @module apps/api/src/content/http/__tests__
 */
import { BadGatewayException, UnprocessableEntityException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import {
  CONTENT_DRAFT_SERVICE_TOKEN,
  CONTENT_STATE_READER_SERVICE_TOKEN,
  CONTENT_SUGGESTION_SERVICE_TOKEN,
  type IContentDraftService,
  type IContentStateReaderService,
  type IContentSuggestionService,
} from '@openlinker/core/content';
import { AllegroApiException } from '@openlinker/integrations-allegro';

import { ContentController } from '../content.controller';

describe('ContentController', () => {
  let controller: ContentController;
  let drafts: jest.Mocked<IContentDraftService>;

  beforeEach(async () => {
    drafts = {
      saveDraft: jest.fn(),
      discardDraft: jest.fn(),
      publishDraft: jest.fn(),
    } as unknown as jest.Mocked<IContentDraftService>;

    const stateReader = { readState: jest.fn() } as unknown as IContentStateReaderService;
    const suggestions = { suggestDescription: jest.fn() } as unknown as IContentSuggestionService;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContentController],
      providers: [
        { provide: CONTENT_DRAFT_SERVICE_TOKEN, useValue: drafts },
        { provide: CONTENT_STATE_READER_SERVICE_TOKEN, useValue: stateReader },
        { provide: CONTENT_SUGGESTION_SERVICE_TOKEN, useValue: suggestions },
      ],
    }).compile();

    controller = module.get(ContentController);
  });

  describe('publish — AllegroApiException mapping (#486)', () => {
    it('surfaces 422 with structured errors as UnprocessableEntityException carrying { code, errors[] }', async () => {
      drafts.publishDraft.mockRejectedValueOnce(
        new AllegroApiException(
          'Allegro API error (422): https://api.allegro.pl/sale/product-offers/7781493452',
          422,
          '{"errors":[...]}',
          'https://api.allegro.pl/sale/product-offers/7781493452',
          [
            {
              code: 'RESPONSIBLE_PRODUCER_NOT_SPECIFIED',
              message: 'Responsible producer is required for every product in the offer',
              userMessage:
                'Producent odpowiedzialny jest obowiązkowy dla każdego produktu w ofercie',
              path: 'offer.modules.productSafety.data.productsData[0].responsibleProducer',
            },
            {
              code: 'ConstraintViolationException.AfterSalesServiceConditionsRequiredByCompany',
              message:
                'Offer Terms (for returns and complaints) are required for Business Accounts.',
              userMessage: 'Warunki oferty (zwroty, reklamacje) są wymagane dla kont firma.',
              path: 'null',
            },
          ]
        )
      );

      const captured = await controller
        .publish('product-1', { connectionId: 'conn-1', fieldKey: 'description' })
        .catch((err: unknown) => err);

      expect(captured).toBeInstanceOf(UnprocessableEntityException);
      const response = (captured as UnprocessableEntityException).getResponse() as {
        message: string;
        code: string;
        errors: Array<{ field?: string; code: string; message: string }>;
      };
      expect(response.code).toBe('CHANNEL_PUBLISH_FAILED');
      expect(response.errors).toEqual([
        {
          field: 'offer.modules.productSafety.data.productsData[0].responsibleProducer',
          code: 'RESPONSIBLE_PRODUCER_NOT_SPECIFIED',
          // userMessage preferred over message
          message: 'Producent odpowiedzialny jest obowiązkowy dla każdego produktu w ofercie',
        },
        {
          // path: 'null' is collapsed to undefined
          field: undefined,
          code: 'ConstraintViolationException.AfterSalesServiceConditionsRequiredByCompany',
          message: 'Warunki oferty (zwroty, reklamacje) są wymagane dla kont firma.',
        },
      ]);
    });

    it('falls back to message when userMessage is absent', async () => {
      drafts.publishDraft.mockRejectedValueOnce(
        new AllegroApiException('Allegro API error (422)', 422, '', undefined, [
          {
            code: 'SOME_CODE',
            message: 'English message only',
          },
        ])
      );

      const captured = await controller
        .publish('product-1', { connectionId: 'conn-1', fieldKey: 'description' })
        .catch((err: unknown) => err);

      expect(captured).toBeInstanceOf(UnprocessableEntityException);
      const response = (captured as UnprocessableEntityException).getResponse() as {
        errors: Array<{ message: string }>;
      };
      expect(response.errors[0].message).toBe('English message only');
    });

    it("surfaces 5xx as BadGatewayException (not the operator's problem)", async () => {
      drafts.publishDraft.mockRejectedValueOnce(
        new AllegroApiException(
          'Allegro API server error (502)',
          502,
          '<html>upstream proxy error</html>',
          undefined,
          undefined
        )
      );

      await expect(
        controller.publish('product-1', { connectionId: 'conn-1', fieldKey: 'description' })
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('surfaces 422 without structured errors as BadGatewayException', async () => {
      // No `allegroErrors` (e.g. malformed body that the parser couldn't read).
      // FE rendering an empty error list under a 422 header is misleading —
      // surface as bad gateway instead.
      drafts.publishDraft.mockRejectedValueOnce(
        new AllegroApiException(
          'Allegro API error (422)',
          422,
          '<html>not-json</html>',
          undefined,
          undefined
        )
      );

      await expect(
        controller.publish('product-1', { connectionId: 'conn-1', fieldKey: 'description' })
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('passes non-Allegro errors through unchanged', async () => {
      const original = new Error('generic boom');
      drafts.publishDraft.mockRejectedValueOnce(original);

      await expect(
        controller.publish('product-1', { connectionId: 'conn-1', fieldKey: 'description' })
      ).rejects.toBe(original);
    });
  });
});
