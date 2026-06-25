/**
 * CapabilityTogglesSection tests (#759)
 *
 * @module features/connections/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilityTogglesSection } from './CapabilityTogglesSection';

// Adapter-provided descriptors (AC-8). The 'KSeF' wording lives ONLY here, in
// the provider-supplied map — never as a literal in the shared component.
const descriptors = {
  'regulatory-transmission-tracking': {
    label: 'Show KSeF status badge',
    help: 'Surface the bridge-reported regulatory transmission (KSeF) status.',
  },
};

interface HarnessProps {
  configIsParseable?: boolean;
  syncObjectToJson?: () => void;
  initialCapabilities?: Record<string, boolean>;
}

function Harness({
  configIsParseable = true,
  syncObjectToJson,
  initialCapabilities,
}: HarnessProps): ReactElement {
  const form = useForm<any>({
    defaultValues: { subiektCapabilities: initialCapabilities ?? {} },
  });
  return (
    <CapabilityTogglesSection
      descriptors={descriptors}
      form={form as any}
      configIsParseable={configIsParseable}
      syncObjectToJson={syncObjectToJson}
    />
  );
}

describe('CapabilityTogglesSection', () => {
  afterEach(cleanup);

  it('renders one labelled toggle per descriptor entry with the adapter-provided label', () => {
    render(<Harness />);
    expect(screen.getByText('Show KSeF status badge')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('contains NO capability-name literal (e.g. "KSeF") in the shared component source — labels come from props (AC-8)', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/connections/components/CapabilityTogglesSection.tsx'),
      'utf8',
    );
    expect(source).not.toContain('KSeF');
    expect(source).not.toContain('regulatory-transmission-tracking');
  });

  it('on change: calls form.setValue("subiektCapabilities", next) FIRST, THEN syncObjectToJson (ordering trap)', () => {
    const calls: string[] = [];
    const syncObjectToJson = vi.fn(() => calls.push('sync'));
    // Spy on setValue by wrapping the form via a custom harness.
    function OrderingHarness(): ReactElement {
      const form = useForm<any>({ defaultValues: { subiektCapabilities: {} } });
      const realSetValue = form.setValue.bind(form);
      form.setValue = ((...args: Parameters<typeof realSetValue>) => {
        calls.push('setValue');
        return realSetValue(...args);
      }) as typeof form.setValue;
      return (
        <CapabilityTogglesSection
          descriptors={descriptors}
          form={form as any}
          configIsParseable={true}
          syncObjectToJson={syncObjectToJson}
        />
      );
    }
    render(<OrderingHarness />);
    fireEvent.click(screen.getByRole('checkbox'));
    // The ordering trap: the form field MUST be written before the host
    // serializer runs. `sync` is called exactly once, after at least one
    // `setValue`, and never before any `setValue` (RHF may re-issue setValue
    // on re-render, hence we assert relative order rather than exact equality).
    expect(syncObjectToJson).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c === 'sync')).toEqual(['sync']);
    expect(calls.indexOf('setValue')).toBeLessThan(calls.indexOf('sync'));
    expect(calls.indexOf('setValue')).toBeGreaterThanOrEqual(0);
  });

  it('reads current toggle state from form.watch("subiektCapabilities")', () => {
    render(<Harness initialCapabilities={{ 'regulatory-transmission-tracking': true }} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('renders every toggle disabled when configIsParseable is false (divergence gate)', () => {
    render(<Harness configIsParseable={false} />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('flips the form field from undefined → true on first toggle', () => {
    let capturedValue: Record<string, boolean> | undefined;
    function CaptureHarness(): ReactElement {
      const form = useForm<any>({ defaultValues: { subiektCapabilities: {} } });
      capturedValue = form.watch('subiektCapabilities');
      return (
        <CapabilityTogglesSection
          descriptors={descriptors}
          form={form as any}
          configIsParseable={true}
          syncObjectToJson={() => {
            capturedValue = form.getValues('subiektCapabilities');
          }}
        />
      );
    }
    render(<CaptureHarness />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(capturedValue).toEqual({ 'regulatory-transmission-tracking': true });
  });
});
