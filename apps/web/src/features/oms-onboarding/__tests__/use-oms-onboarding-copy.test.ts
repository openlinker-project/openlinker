import { beforeAll, describe, expect, it } from 'vitest';
import { loadMessages } from '../../../shared/i18n';
import { omsOnboardingCopyIn } from '../hooks/use-oms-onboarding-copy';

describe('omsOnboardingCopyIn', () => {
  beforeAll(async () => {
    await loadMessages('pl');
  });

  describe('English', () => {
    const copy = omsOnboardingCopyIn('en');

    it('should fill the step counter', () => {
      expect(copy.stepOf(2, 7)).toBe('Step 2 of 7');
    });

    it('should say nothing is on Fulfilment when the count is zero', () => {
      expect(copy.status.onBody(0, '5 min ago')).toBe('Nothing on Fulfilment yet.');
    });

    it('should add when the last parcel arrived only when it is known', () => {
      expect(copy.status.onBody(1, null)).toBe('1 parcel on Fulfilment');
      expect(copy.status.onBody(3, '5 min ago')).toBe('3 parcels on Fulfilment · last one arrived 5 min ago');
    });

    it('should pick the singular or plural for the steps left', () => {
      expect(copy.status.stepsLeft(1)).toBe('Packing works. 1 step is left.');
      expect(copy.status.stepsLeft(2)).toBe('Packing works. 2 steps are left.');
    });

    it('should name one or several product masters', () => {
      expect(copy.step4.masters(1)).toBe('Your product master');
      expect(copy.step4.masters(2)).toBe('Your product masters');
    });

    it('should list what stays the same with the store names filled in', () => {
      expect(copy.step3.sameBoxItems('PrestaShop')).toEqual([
        'Orders from your PrestaShop store. You pack them there.',
        'Orders the marketplace ships itself, for example Allegro One Fulfillment',
        'Orders already in PrestaShop before you turn it on',
      ]);
    });

    it('should list the four changes in order with the store names in the first one', () => {
      const changes = copy.step3.changes('PrestaShop');
      expect(changes).toHaveLength(4);
      expect(changes[0].body).toContain('PrestaShop');
      expect(changes.map((change) => change.title)).toEqual([
        'Marketplace orders stay in OpenLinker.',
        'You buy labels in OpenLinker.',
        'The pack bench prints the label and the invoice.',
        'It applies to all your marketplaces at once.',
      ]);
    });

    it('should say nothing is at the pack bench when stopping with no parcels', () => {
      expect(copy.stopDialog.bodyExisting(0)).toBe('Nothing is on Fulfilment right now.');
    });
  });

  describe('Polish', () => {
    const copy = (): ReturnType<typeof omsOnboardingCopyIn> => omsOnboardingCopyIn('pl');

    it('should pick the Polish form for the steps left', () => {
      expect(copy().status.stepsLeft(1)).toBe('Pakowanie działa. Został 1 krok.');
      expect(copy().status.stepsLeft(3)).toBe('Pakowanie działa. Zostały 3 kroki.');
      expect(copy().status.stepsLeft(5)).toBe('Pakowanie działa. Zostało 5 kroków.');
      expect(copy().status.stepsLeft(22)).toBe('Pakowanie działa. Zostały 22 kroki.');
    });

    it('should pick the Polish form for parcels on Fulfilment', () => {
      expect(copy().status.onBody(0, null)).toBe('W realizacji jeszcze nic nie ma.');
      expect(copy().status.onBody(1, null)).toBe('1 paczka w realizacji');
      expect(copy().status.onBody(2, '5 min temu')).toBe('2 paczki w realizacji · ostatnia przyszła 5 min temu');
      expect(copy().status.onBody(5, null)).toBe('5 paczek w realizacji');
    });

    it('should pick the Polish form for the products of the first order', () => {
      expect(copy().status.arrivedMeta(1, 'teraz')).toMatch(/^1 produkt · teraz · /);
      expect(copy().status.arrivedMeta(2, 'teraz')).toMatch(/^2 produkty · teraz · /);
      expect(copy().status.arrivedMeta(5, 'teraz')).toMatch(/^5 produktów · teraz · /);
    });

    it('should name one or several product masters', () => {
      expect(copy().step4.masters(1)).toBe('Twój główny sklep');
      expect(copy().step4.masters(2)).toBe('Twoje główne sklepy');
    });

    it('should fill the step counter', () => {
      expect(copy().stepOf(2, 7)).toBe('Krok 2 z 7');
    });
  });
});
