/**
 * Fake Exchange Rate Adapter Tests
 *
 * A minimal spec whose main purpose is wiring `FakeExchangeRateAdapter`
 * through the shared publication-day port-contract suite (#2800 review,
 * finding 2) - the fake is offline and identity-only, so it has nothing else
 * worth a bespoke test.
 *
 * @module libs/integrations/fx/infrastructure/adapters/__tests__
 */
import { PUBLICATION_DAY_CONTRACT_DATES, runPublicationDayContract } from '@openlinker/core/currency/testing';
import { FakeExchangeRateAdapter } from '../fake-exchange-rate.adapter';

describe('FakeExchangeRateAdapter', () => {
  it('should answer the candidate day verbatim, having no publication calendar', () => {
    const adapter = new FakeExchangeRateAdapter({ name: 'nbp' });

    expect(adapter.resolveExpectedPublicationDay('2026-08-15')).toBe('2026-08-15');
  });

  // The fake declares the method as a pure identity (see its own file
  // header, "#2777"), which is a CONFORMING answer under the port's
  // asymmetry rule: "when in doubt, return the candidate unchanged" is
  // always legal (the port docblock; see the shared suite's own file
  // header "Every case's EXPECTED answer is supplied by the caller"), and a
  // fake with no publication calendar is always in doubt. So every fixture
  // here is the candidate itself - this run proves the SAFETY invariant
  // (`resolved <= candidate`, synchronous, no I/O) holds for the maximally
  // conservative implementation, not that the fake performs the walk-back
  // optimization NBP/ECB do.
  runPublicationDayContract(
    () => new FakeExchangeRateAdapter({ name: 'ecb' }),
    {
      weekdayExpected: PUBLICATION_DAY_CONTRACT_DATES.weekday,
      saturdayExpected: PUBLICATION_DAY_CONTRACT_DATES.saturday,
      sundayExpected: PUBLICATION_DAY_CONTRACT_DATES.sunday,
      corpusChristi2026Expected: PUBLICATION_DAY_CONTRACT_DATES.corpusChristi2026,
    },
    { subject: 'FakeExchangeRateAdapter', expectDeclared: true }
  );
});
