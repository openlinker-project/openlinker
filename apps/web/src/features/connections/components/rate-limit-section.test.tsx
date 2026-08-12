/**
 * RateLimitSection tests (#1810, #2016)
 *
 * @module features/connections/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateLimitSection } from './rate-limit-section';
import type { ConnectionRateLimit } from '../api/connections.types';

interface HarnessProps {
  configIsParseable?: boolean;
  syncRateLimitToJson?: () => void;
  initialRateLimit?: { requestsPerMinute?: string; maxConcurrent?: string };
  defaultRateLimit?: ConnectionRateLimit | null;
}

function Harness({
  configIsParseable = true,
  syncRateLimitToJson = (): void => {},
  initialRateLimit,
  defaultRateLimit = null,
}: HarnessProps): ReactElement {
  const form = useForm<any>({
    defaultValues: { rateLimit: initialRateLimit ?? {} },
  });
  return (
    <RateLimitSection
      form={form as any}
      configIsParseable={configIsParseable}
      syncRateLimitToJson={syncRateLimitToJson}
      defaultRateLimit={defaultRateLimit}
    />
  );
}

describe('RateLimitSection', () => {
  afterEach(cleanup);

  it('renders the toggle unchecked and hides the knobs by default — matches "unlimited"', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Enable rate limiting')).not.toBeChecked();
    expect(screen.queryByLabelText('Requests per minute')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Max concurrent requests')).not.toBeInTheDocument();
  });

  it('hydrates as checked and shows the knobs when the connection already has a rate limit', () => {
    render(<Harness initialRateLimit={{ requestsPerMinute: '60', maxConcurrent: '4' }} />);
    expect(screen.getByLabelText('Enable rate limiting')).toBeChecked();
    expect(screen.getByLabelText('Requests per minute')).toHaveValue('60');
    expect(screen.getByLabelText('Max concurrent requests')).toHaveValue('4');
  });

  it('reveals the knobs, blank, when the toggle is checked', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Enable rate limiting'));
    expect(screen.getByLabelText('Requests per minute')).toHaveValue('');
    expect(screen.getByLabelText('Max concurrent requests')).toHaveValue('');
  });

  it('clears both knobs and re-syncs when the toggle is unchecked (#2016 — revert to adapter default)', () => {
    const syncRateLimitToJson = vi.fn();
    render(
      <Harness
        initialRateLimit={{ requestsPerMinute: '60', maxConcurrent: '4' }}
        syncRateLimitToJson={syncRateLimitToJson}
      />,
    );

    fireEvent.click(screen.getByLabelText('Enable rate limiting'));

    expect(screen.queryByLabelText('Requests per minute')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Max concurrent requests')).not.toBeInTheDocument();
    // Both fields are cleared via setValue BEFORE this single sync call, so
    // syncRateLimitToJson reads the fully-cleared state in one re-serialization.
    expect(syncRateLimitToJson).toHaveBeenCalledTimes(1);
  });

  it('clears both knobs before re-syncing when unchecked (#2016) — asserts on captured form state, not just call count', () => {
    let capturedAtSync: unknown;
    function Harness2(): ReactElement {
      const form = useForm<any>({
        defaultValues: { rateLimit: { requestsPerMinute: '60', maxConcurrent: '4' } },
      });
      return (
        <RateLimitSection
          form={form as any}
          configIsParseable={true}
          syncRateLimitToJson={() => {
            capturedAtSync = form.getValues('rateLimit');
          }}
          defaultRateLimit={null}
        />
      );
    }
    render(<Harness2 />);
    fireEvent.click(screen.getByLabelText('Enable rate limiting'));
    expect(capturedAtSync).toEqual({ requestsPerMinute: '', maxConcurrent: '' });
  });

  it('re-syncs when the toggle is checked with both knobs still blank (no silent no-op on Save)', () => {
    const syncRateLimitToJson = vi.fn();
    render(<Harness syncRateLimitToJson={syncRateLimitToJson} />);

    fireEvent.click(screen.getByLabelText('Enable rate limiting'));

    expect(screen.getByLabelText('Requests per minute')).toHaveValue('');
    expect(screen.getByLabelText('Max concurrent requests')).toHaveValue('');
    expect(syncRateLimitToJson).toHaveBeenCalledTimes(1);
  });

  it('disables the toggle and both inputs when configIsParseable is false (divergence gate)', () => {
    render(
      <Harness
        configIsParseable={false}
        initialRateLimit={{ requestsPerMinute: '60', maxConcurrent: '4' }}
      />,
    );
    expect(screen.getByLabelText('Enable rate limiting')).toBeDisabled();
    expect(screen.getByLabelText('Requests per minute')).toBeDisabled();
    expect(screen.getByLabelText('Max concurrent requests')).toBeDisabled();
  });

  it('on change: writes the form field FIRST, THEN calls syncRateLimitToJson (ordering trap)', () => {
    const calls: string[] = [];
    const syncRateLimitToJson = vi.fn(() => calls.push('sync'));

    function OrderingHarness(): ReactElement {
      const form = useForm<any>({ defaultValues: { rateLimit: { requestsPerMinute: '10' } } });
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
          defaultRateLimit={null}
        />
      );
    }

    render(<OrderingHarness />);
    fireEvent.change(screen.getByLabelText('Requests per minute'), { target: { value: '60' } });

    expect(syncRateLimitToJson).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('setValue')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('setValue')).toBeLessThan(calls.indexOf('sync'));
  });

  it('says "unlimited" when the adapter declares no defaultRateLimit (#1810 FE honesty)', () => {
    render(<Harness defaultRateLimit={null} />);
    expect(screen.getByText(/Leave rate limiting off for unlimited/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Enable rate limiting'));
    expect(screen.getByLabelText('Requests per minute')).toHaveAttribute('placeholder', 'Unlimited');
  });

  it('surfaces the resolved adapter defaultRateLimit instead of claiming "unlimited" (#1810 FE honesty)', () => {
    render(<Harness defaultRateLimit={{ requestsPerMinute: 60, maxConcurrent: 4 }} />);
    expect(screen.getByText(/60 requests\/min, 4 concurrent/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Leave rate limiting off for unlimited/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Enable rate limiting'));
    expect(screen.getByLabelText('Requests per minute')).toHaveAttribute('placeholder', 'Default: 60');
    expect(screen.getByLabelText('Max concurrent requests')).toHaveAttribute(
      'placeholder',
      'Default: 4',
    );
  });

  it('reads the just-written value via getValues at sync time (both knobs independently editable)', () => {
    let captured: unknown;
    function CaptureHarness(): ReactElement {
      const form = useForm<any>({ defaultValues: { rateLimit: { requestsPerMinute: '1' } } });
      return (
        <RateLimitSection
          form={form as any}
          configIsParseable={true}
          syncRateLimitToJson={() => {
            captured = form.getValues('rateLimit');
          }}
          defaultRateLimit={null}
        />
      );
    }
    render(<CaptureHarness />);
    fireEvent.change(screen.getByLabelText('Max concurrent requests'), { target: { value: '4' } });
    expect(captured).toEqual({ requestsPerMinute: '1', maxConcurrent: '4' });
  });
});
