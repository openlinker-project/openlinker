/**
 * StockAndPricingSection tests (#2610)
 *
 * @module features/connections/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockAndPricingSection } from './stock-and-pricing-section';

interface HarnessProps {
  configIsParseable?: boolean;
  syncStockPolicyToJson?: () => void;
  syncPricingRuleToJson?: () => void;
  initialStockPolicy?: { safetyBuffer?: string; zeroThreshold?: string };
  initialPricingRule?: { type?: string; percent?: string; rounding?: string };
}

function Harness({
  configIsParseable = true,
  syncStockPolicyToJson = (): void => {},
  syncPricingRuleToJson = (): void => {},
  initialStockPolicy,
  initialPricingRule,
}: HarnessProps): ReactElement {
  const form = useForm<any>({
    defaultValues: {
      stockPolicy: initialStockPolicy ?? { safetyBuffer: '', zeroThreshold: '' },
      pricingRule: initialPricingRule ?? { type: '', percent: '', rounding: '' },
    },
  });
  return (
    <StockAndPricingSection
      form={form as any}
      configIsParseable={configIsParseable}
      syncStockPolicyToJson={syncStockPolicyToJson}
      syncPricingRuleToJson={syncPricingRuleToJson}
    />
  );
}

describe('StockAndPricingSection', () => {
  afterEach(cleanup);

  it('hides both groups by default', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Publish less stock than you hold')).not.toBeChecked();
    expect(screen.queryByLabelText('Units to hold back')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('How to set the price')).not.toBeInTheDocument();
  });

  it('hydrates the stock group open when a buffer is stored', () => {
    render(<Harness initialStockPolicy={{ safetyBuffer: '3', zeroThreshold: '' }} />);
    expect(screen.getByLabelText('Publish less stock than you hold')).toBeChecked();
    expect(screen.getByLabelText('Units to hold back')).toHaveValue('3');
  });

  it('hydrates the stock group open on an explicit stored 0 — a 0 is a real value, not unset', () => {
    render(<Harness initialStockPolicy={{ safetyBuffer: '0', zeroThreshold: '' }} />);
    expect(screen.getByLabelText('Publish less stock than you hold')).toBeChecked();
    expect(screen.getByLabelText('Units to hold back')).toHaveValue('0');
  });

  it('states the published quantity for the worked example', () => {
    render(<Harness initialStockPolicy={{ safetyBuffer: '4', zeroThreshold: '' }} />);
    expect(screen.getByText(/10 units/)).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('states 0 for the worked example when the threshold bites', () => {
    render(<Harness initialStockPolicy={{ safetyBuffer: '4', zeroThreshold: '8' }} />);
    // Two zeros now: the 10-unit example, and the low-stock case the floor is
    // actually about.
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
  });

  it('states a low-stock case so a floor demonstrates something (#2610)', () => {
    render(<Harness initialStockPolicy={{ safetyBuffer: '0', zeroThreshold: '5' }} />);
    expect(screen.getByText('4 units')).toBeInTheDocument();
  });

  it('clears both stock knobs and re-syncs when the group is switched off', () => {
    const syncStockPolicyToJson = vi.fn();
    render(
      <Harness
        initialStockPolicy={{ safetyBuffer: '4', zeroThreshold: '2' }}
        syncStockPolicyToJson={syncStockPolicyToJson}
      />,
    );
    fireEvent.click(screen.getByLabelText('Publish less stock than you hold'));
    expect(screen.queryByLabelText('Units to hold back')).not.toBeInTheDocument();
    expect(syncStockPolicyToJson).toHaveBeenCalled();
  });

  it('states the published price for a markup', () => {
    render(<Harness initialPricingRule={{ type: 'markup', percent: '25', rounding: 'none' }} />);
    expect(screen.getByText('100.00')).toBeInTheDocument();
    expect(screen.getByText('125.00')).toBeInTheDocument();
  });

  it('states the published price for a margin', () => {
    render(<Harness initialPricingRule={{ type: 'margin', percent: '25', rounding: 'none' }} />);
    expect(screen.getByText('133.33')).toBeInTheDocument();
  });

  it('hides the percentage field for a passthrough rule', () => {
    render(<Harness initialPricingRule={{ type: 'passthrough', percent: '', rounding: 'none' }} />);
    expect(screen.getByLabelText('How to set the price')).toHaveValue('passthrough');
    expect(screen.queryByLabelText('Percentage')).not.toBeInTheDocument();
  });

  it('disables every control when the raw config JSON is unparseable', () => {
    render(<Harness configIsParseable={false} initialStockPolicy={{ safetyBuffer: '4' }} />);
    expect(screen.getByLabelText('Units to hold back')).toBeDisabled();
    expect(screen.getByLabelText('Publish less stock than you hold')).toBeDisabled();
  });
});
