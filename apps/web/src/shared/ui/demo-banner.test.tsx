import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DemoBanner } from './demo-banner';

describe('DemoBanner', () => {
  it('should render the demo notice text', () => {
    render(<DemoBanner />);
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(screen.getByText(/demo mode/i)).toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it('should apply the demo-banner class', () => {
    render(<DemoBanner />);
    expect(screen.getByRole('note')).toHaveClass('demo-banner');
  });

  it('should merge a custom className', () => {
    render(<DemoBanner className="custom" />);
    expect(screen.getByRole('note')).toHaveClass('demo-banner', 'custom');
  });

  it('should forward ref to the root div', () => {
    const ref = createRef<HTMLDivElement>();
    render(<DemoBanner ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('should not render the consent CTA when consentPending is false', () => {
    render(<DemoBanner consentPending={false} />);
    expect(screen.queryByText(/accept analytics/i)).not.toBeInTheDocument();
  });

  it('should render the consent CTA when consentPending is true', () => {
    render(<DemoBanner consentPending />);
    expect(screen.getByText(/accept analytics/i)).toBeInTheDocument();
    expect(screen.getByText(/decline/i)).toBeInTheDocument();
  });

  it('should call onConsentChange with "accepted" when Accept is clicked', async () => {
    const onConsentChange = vi.fn();
    render(<DemoBanner consentPending onConsentChange={onConsentChange} />);
    await userEvent.click(screen.getByRole('button', { name: /accept analytics/i }));
    expect(onConsentChange).toHaveBeenCalledWith('accepted');
  });

  it('should call onConsentChange with "declined" when Decline is clicked', async () => {
    const onConsentChange = vi.fn();
    render(<DemoBanner consentPending onConsentChange={onConsentChange} />);
    await userEvent.click(screen.getByRole('button', { name: /decline/i }));
    expect(onConsentChange).toHaveBeenCalledWith('declined');
  });

  it('should not render the revoke affordance when consentAccepted is false', () => {
    render(<DemoBanner consentAccepted={false} />);
    expect(screen.queryByText(/analytics on/i)).not.toBeInTheDocument();
  });

  it('should render the revoke affordance when consentAccepted is true', () => {
    render(<DemoBanner consentAccepted />);
    expect(screen.getByText(/analytics on/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disable/i })).toBeInTheDocument();
  });

  it('should call onConsentChange with "declined" when Disable is clicked', async () => {
    const onConsentChange = vi.fn();
    render(<DemoBanner consentAccepted onConsentChange={onConsentChange} />);
    await userEvent.click(screen.getByRole('button', { name: /disable/i }));
    expect(onConsentChange).toHaveBeenCalledWith('declined');
  });
});
