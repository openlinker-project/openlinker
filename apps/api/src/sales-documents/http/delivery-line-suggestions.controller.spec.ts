/**
 * Delivery-Line Suggestions Controller Specs (#3907)
 *
 * @module apps/api/src/sales-documents/http
 */
import { NotFoundException } from '@nestjs/common';
import { DeliveryLineSuggestionsController } from './delivery-line-suggestions.controller';

describe('DeliveryLineSuggestionsController', () => {
  const controller = new DeliveryLineSuggestionsController();

  it('should list the curated suggestions when asked', () => {
    const { suggestions } = controller.listSuggestions();
    expect(suggestions.map((s) => s.country)).toEqual(['PL']);
    expect(suggestions[0].nameSuggestions).toContain('Paczkomat InPost');
  });

  it('should return one suggestion when the country is known', () => {
    expect(controller.getSuggestion('pl').defaultName).toBe('Koszt dostawy');
  });

  it('should report 404 when the country has no suggestion', () => {
    expect(() => controller.getSuggestion('DE')).toThrow(NotFoundException);
  });
});
