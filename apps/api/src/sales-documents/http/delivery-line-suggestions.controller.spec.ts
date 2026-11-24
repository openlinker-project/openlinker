/**
 * Delivery-Line Suggestions Controller Specs (#3907)
 *
 * @module apps/api/src/sales-documents/http
 */
import { NotFoundException } from '@nestjs/common';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { DeliveryLineSuggestionsController } from './delivery-line-suggestions.controller';

describe('DeliveryLineSuggestionsController', () => {
  const listCapabilityAdapters = jest.fn();
  const controller = new DeliveryLineSuggestionsController({
    listCapabilityAdapters,
  } as unknown as IIntegrationsService);

  beforeEach(() => {
    listCapabilityAdapters.mockReset();
    listCapabilityAdapters.mockResolvedValue([]);
  });

  it('should list the curated suggestions when asked', async () => {
    const { suggestions } = await controller.listSuggestions();
    expect(suggestions.map((s) => s.country)).toEqual(['PL']);
    expect(suggestions[0].nameSuggestions).toContain('Paczkomat InPost');
  });

  it('should report the fallback budget as undeclared when no fiscalization adapter declares one', async () => {
    const { receiptLineName } = await controller.listSuggestions();
    expect(receiptLineName).toEqual({ maxLength: 40, declared: false });
  });

  it('should report the budget a connected fiscalization adapter declares', async () => {
    listCapabilityAdapters.mockResolvedValue([
      {
        connectionId: 'fiscal-1',
        adapter: Promise.resolve({
          registerTransaction: jest.fn(),
          getReceiptLineNameMaxLength: () => 32,
        }),
      },
    ]);
    const { receiptLineName } = await controller.listSuggestions();
    expect(receiptLineName).toEqual({ maxLength: 32, declared: true });
  });

  it('should return one suggestion when the country is known', () => {
    expect(controller.getSuggestion('pl').defaultName).toBe('Koszt dostawy');
  });

  it('should report 404 when the country has no suggestion', () => {
    expect(() => controller.getSuggestion('DE')).toThrow(NotFoundException);
  });

  it('should name the country in a coded 404 (#3865)', () => {
    let caught: unknown;
    try {
      controller.getSuggestion('DE');
    } catch (error) {
      caught = error;
    }

    expect((caught as NotFoundException).getResponse()).toEqual(
      expect.objectContaining({
        code: 'DELIVERY_LINE_SUGGESTION_NOT_FOUND',
        params: { country: 'DE' },
      })
    );
  });
});
