/**
 * RateLimitSection tests (#1810)
 *
 * @module features/connections/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateLimitSection } from './rate-limit-section';

interface HarnessProps {
  configIsParseable?: boolean;
  syncRateLimitToJson?: () => void;
  initialRateLimit?: { requestsPerMinute?: string; maxConcurrent?: string };
}

function Harness({
  configIsParseable = true,
  syncRateLimitToJson = (): void => {},
  initialRateLimit,
}: HarnessProps): ReactElement {
  const form = useForm<any>({
    defaultValues: { rateLimit: initialRateLimit ?? {} },
  });
  return (
    <RateLimitSection
      form={form as any}
      configIsParseable={configIsParseable}
      syncRateLimitToJson={syncRateLimitToJson}
    />
  );
}

describe('RateLimitSection', () => {
  afterEach(cleanup);

  it('renders both knobs empty by default — matches "unlimited"', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Requests per minute')).toHaveValue('');
    expect(screen.getByLabelText('Max concurrent requests')).toHaveValue('');
  });

  it('hydrates from existing form values', () => {
    render(<Harness initialRateLimit={{ requestsPerMinute: '60', maxConcurrent: '4' }} />);
    expect(screen.getByLabelText('Requests per minute')).toHaveValue('60');
    expect(screen.getByLabelText('Max concurrent requests')).toHaveValue('4');
  });

  it('disables both inputs when configIsParseable is false (divergence gate)', () => {
    render(<Harness configIsParseable={false} />);
    expect(screen.getByLabelText('Requests per minute')).toBeDisabled();
    expect(screen.getByLabelText('Max concurrent requests')).toBeDisabled();
  });

  it('on change: writes the form field FIRST, THEN calls syncRateLimitToJson (ordering trap)', () => {
    const calls: string[] = [];
    const syncRateLimitToJson = vi.fn(() => calls.push('sync'));

    function OrderingHarness(): ReactElement {
      const form = useForm<any>({ defaultValues: { rateLimit: {} } });
      const realSetValue = form.setValue.bind(form);
      form.setValue = ((...args: Parameters<typeof realSetValue>) => {
        calls.push('setValue');
        return realSetValue(...args);
      }) as typeof form.setValue;
      return (
        <RateLimitSection
          form={form as any}
          configIsParseable={true}
          syncRateLimitToJson={syncRateLimitToJson}
        />
      );
    }

    render(<OrderingHarness />);
    fireEvent.change(screen.getByLabelText('Requests per minute'), { target: { value: '60' } });

    expect(syncRateLimitToJson).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('setValue')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('setValue')).toBeLessThan(calls.indexOf('sync'));
  });

  it('reads the just-written value via getValues at sync time (both knobs independently editable)', () => {
    let captured: unknown;
    function CaptureHarness(): ReactElement {
      const form = useForm<any>({ defaultValues: { rateLimit: {} } });
      return (
        <RateLimitSection
          form={form as any}
          configIsParseable={true}
          syncRateLimitToJson={() => {
            captured = form.getValues('rateLimit');
          }}
        />
      );
    }
    render(<CaptureHarness />);
    fireEvent.change(screen.getByLabelText('Max concurrent requests'), { target: { value: '4' } });
    expect(captured).toEqual({ maxConcurrent: '4' });
  });
});
