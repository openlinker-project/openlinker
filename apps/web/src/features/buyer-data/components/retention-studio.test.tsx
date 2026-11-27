/**
 * RetentionStudio wiring tests (#4289)
 *
 * The strip's example marker, the example card's slider and the stage presets are ONE value,
 * and a handle drag puts the card behind a skeleton until it is let go.
 */
import { useState, type ReactElement } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { BuyerDataRules } from '../api/buyer-data.types';
import { RetentionStudio } from './retention-studio';

const RULES: BuyerDataRules = {
  enabled: false,
  hideAfterDays: 90,
  eraseAfterDays: 365,
  mode: 'personal-data',
};

function Harness(): ReactElement {
  const [rules, setRules] = useState(RULES);
  return <RetentionStudio rules={rules} onChange={setRules} plan={null} name="t" />;
}

async function mountStudio(): Promise<HTMLElement> {
  renderWithProviders(<Harness />, { apiClient: createMockApiClient() });
  const track = await screen.findByTestId('age-strip-track');
  track.getBoundingClientRect = (): DOMRect =>
    ({ left: 0, width: 1000, top: 0, height: 10, right: 1000, bottom: 10, x: 0, y: 0 }) as DOMRect;
  return track;
}

afterEach(cleanup);

describe('RetentionStudio example order (#4289)', () => {
  it('should move the slider, the card and the stage when the strip is clicked', async () => {
    const track = await mountStudio();
    fireEvent.click(track, { clientX: 100 });
    // 10% of the strip = ~405 days, the nearest month is 14 = 420 days: past the erase cut.
    const sliders = screen.getAllByTestId('record-age');
    expect(sliders[0]).toHaveAttribute('value', '14');
    expect(screen.getAllByTestId('record-card')[0]).toHaveAttribute('data-state', 'hidden-erased');
    expect(screen.getAllByTestId('record-stage-afterErase')[0]).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByTestId('age-strip-example')).toHaveStyle({ left: `${(420 / 3650) * 90}%` });
  });

  it('should move the strip marker when the footer slider moves', async () => {
    await mountStudio();
    const before = screen.getByTestId('age-strip-example').getAttribute('style');
    fireEvent.change(screen.getAllByTestId('record-age')[0], {
      target: { value: '30' },
    });
    expect(screen.getByTestId('age-strip-example').getAttribute('style')).not.toBe(before);
  });

  it('should show a skeleton on the card while a cut is dragged and reveal it after', async () => {
    await mountStudio();
    const handle = screen.getByTestId('age-strip-handle-hide');
    const card = (): HTMLElement => screen.getAllByTestId('record-card')[0];
    fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'mouse', buttons: 1 });
    expect(card()).toHaveAttribute('aria-busy', 'true');
    fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'mouse' });
    expect(card()).toHaveAttribute('aria-busy', 'false');
  });
});
