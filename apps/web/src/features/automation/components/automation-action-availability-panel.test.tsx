/**
 * Availability panel tests (#2364)
 *
 * The panel's whole job is to be complete and honest, so both properties are
 * asserted rather than assumed.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { AutomationActionAvailabilityPanel } from './automation-action-availability-panel';
import type { AutomationActionVocabulary } from '../api/automation.types';

const EMAIL_REASON = 'Automation emails currently require the API process.';
const HOLD_REASON = 'Order holds are not built yet, so an automation cannot place one.';

const ACTIONS: AutomationActionVocabulary[] = [
  { action: 'relay-status-to-source', availability: 'available', reason: null, irreversible: false },
  { action: 'send-email', availability: 'partial', reason: EMAIL_REASON, irreversible: false },
  { action: 'place-hold', availability: 'unavailable', reason: HOLD_REASON, irreversible: false },
  {
    action: 'dispatch-shipment',
    availability: 'unavailable',
    reason: 'Buying a shipping label is not built yet.',
    irreversible: true,
  },
];

describe('AutomationActionAvailabilityPanel', () => {
  it('should list every action, including the ones that cannot run', () => {
    renderWithProviders(<AutomationActionAvailabilityPanel actions={ACTIONS} />);

    // Hiding an unavailable action leaves the operator unable to understand
    // why nothing fires; showing it as ready is worse.
    for (const action of ACTIONS) {
      expect(screen.getByText(action.action)).toBeInTheDocument();
    }
  });

  it('should distinguish ready, sometimes and not-built', () => {
    renderWithProviders(<AutomationActionAvailabilityPanel actions={ACTIONS} />);

    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Works in some cases')).toBeInTheDocument();
    expect(screen.getAllByText('Not built yet')).toHaveLength(2);
  });

  it("should render the backend's reason verbatim", () => {
    renderWithProviders(<AutomationActionAvailabilityPanel actions={ACTIONS} />);

    expect(screen.getByText(EMAIL_REASON)).toBeInTheDocument();
    expect(screen.getByText(HOLD_REASON)).toBeInTheDocument();
  });

  it('should flag an irreversible action', () => {
    renderWithProviders(<AutomationActionAvailabilityPanel actions={ACTIONS} />);
    expect(screen.getByText('Cannot be undone')).toBeInTheDocument();
  });
});
