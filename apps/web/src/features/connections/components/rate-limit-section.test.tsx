/**
 * RateLimitSection tests (#1810, #2016, #2229)
 *
 * @module features/connections/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { RateLimitSection } from './rate-limit-section';
import type {
  ConnectionRateLimit,
  RateLimitStatus,
  ResolveConcurrencyCeiling,
} from '../api/connections.types';

/**
 * The section reads the adapter-declared resolve ceiling (#2229), so every
 * render needs the query provider. No ceiling by default — most connections
 * declare none, and that is the branch the pre-existing specs exercise.
 */
function render(ui: ReactElement, resolveConcurrency?: ResolveConcurrencyCeiling): void {
  const status: RateLimitStatus = {
    enabled: false,
    ...(resolveConcurrency ? { resolveConcurrency } : {}),
  };
  const apiClient = createMockApiClient({
    connections: { getRateLimitStatus: vi.fn().mockResolvedValue(status) },
  });
  renderWithProviders(ui, { apiClient });
}

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
      connectionId="conn_1"
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
          connectionId="conn_1"
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
          connectionId="conn_1"
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

  it('scopes the no-default claim to this adapter rather than claiming nothing paces it (#1810/#2229)', () => {
    render(<Harness defaultRateLimit={null} />);
    // NOT "unlimited" (#2229): a resolve ceiling is applied below this
    // mechanism, so a blanket claim here is one the section cannot support.
    expect(
      screen.getByText(/applies no per-minute or concurrency cap of its own/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/off for unlimited/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Enable rate limiting'));
    expect(screen.getByLabelText('Requests per minute')).toHaveAttribute('placeholder', 'Unlimited');
  });

  it('surfaces the resolved adapter defaultRateLimit instead of claiming "unlimited" (#1810 FE honesty)', () => {
    render(<Harness defaultRateLimit={{ requestsPerMinute: 60, maxConcurrent: 4 }} />);
    expect(screen.getByText(/60 requests\/min, 4 concurrent/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/applies no per-minute or concurrency cap of its own/i),
    ).not.toBeInTheDocument();
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
          connectionId="conn_1"
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

  it('states the adapter-declared resolve ceiling and that it applies at every batch size (#2229)', async () => {
    render(<Harness defaultRateLimit={null} />, {
      maxInFlight: 9,
      source: 'adapter-default',
      adapterDefault: 9,
    });

    // "at every batch size" is load-bearing: before #2215 a 45-variant batch
    // ran 3 in flight and now runs 9, so an operator reading only the number
    // would assume small runs are gentler.
    await waitFor(() => {
      expect(screen.getByText(/9 requests in flight \(adapter default\)/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/at every batch size/i)).toBeInTheDocument();
  });

  it('names the operator setting that clamped the ceiling, and the default it clamped (#2229)', async () => {
    render(<Harness defaultRateLimit={null} />, {
      maxInFlight: 4,
      source: 'connection-config',
      adapterDefault: 9,
    });

    await waitFor(() => {
      expect(screen.getByText(/4 requests in flight/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/from your max-concurrent setting/i)).toBeInTheDocument();
    expect(screen.getByText(/default of 9/i)).toBeInTheDocument();
  });

  it('renders no ceiling line when no adapter reports one', async () => {
    render(<Harness defaultRateLimit={null} />);

    // Settle on copy that is always present first, so this asserts "never
    // rendered" rather than "not rendered yet".
    await screen.findByText(/applies no per-minute or concurrency cap of its own/i);
    expect(screen.queryByText(/requests in flight/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/at every batch size/i)).not.toBeInTheDocument();
  });
});
