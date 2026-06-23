/**
 * SubiektStructuredSection tests (#759)
 *
 * Renders the plugin-owned structured section the way EditConnectionForm does
 * (via renderWithProviders, so usePlatform('subiekt') resolves the registered
 * plugin and its capabilityDescriptors).
 *
 * @module plugins/subiekt/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { Connection } from '../../../features/connections';
import { SubiektStructuredSection } from './subiekt-structured-section';

const subiektConnection: Connection = {
  ...sampleConnection,
  id: 'subiekt_1',
  name: 'Subiekt GT',
  platformType: 'subiekt',
  config: {},
  adapterKey: 'subiekt.bridge.v1',
};

interface HarnessProps {
  configIsParseable?: boolean;
  syncStructuredToJson?: (field: string, value: string) => void;
  defaultValues?: Record<string, unknown>;
}

function Harness({
  configIsParseable = true,
  syncStructuredToJson = vi.fn(),
  defaultValues = {},
}: HarnessProps): ReactElement {
  const form = useForm<any>({
    defaultValues: {
      subiektBridgeUrl: '',
      subiektTriggerModel: '',
      subiektCapabilities: {},
      ...defaultValues,
    },
  });
  return (
    <SubiektStructuredSection
      connection={subiektConnection}
      form={form as any}
      configIsParseable={configIsParseable}
      syncStructuredToJson={syncStructuredToJson}
      syncObjectToJson={vi.fn()}
    />
  );
}

describe('SubiektStructuredSection', () => {
  afterEach(cleanup);

  it('propagates Bridge URL changes via syncStructuredToJson under the subiektBridgeUrl key', () => {
    const syncStructuredToJson = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={syncStructuredToJson} />);

    const input = screen.getByPlaceholderText('https://localhost:5005');
    fireEvent.change(input, { target: { value: 'https://bridge.example.com' } });

    expect(syncStructuredToJson).toHaveBeenCalledWith(
      'subiektBridgeUrl',
      'https://bridge.example.com',
    );
  });

  it('renders the 4 trigger options with the AC-2 labels', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole('option', { name: 'Manual' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Auto on order paid' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Auto on order shipped' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Batched' })).toBeInTheDocument();
  });

  it('routes the trigger Select change to the subiektTriggerModel field', () => {
    const syncStructuredToJson = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={syncStructuredToJson} />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'auto-on-paid' } });

    expect(syncStructuredToJson).toHaveBeenCalledWith('subiektTriggerModel', 'auto-on-paid');
  });

  it('renders one capability toggle per adapter descriptor entry', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.getByText('Show KSeF status badge')).toBeInTheDocument();
  });

  it('capability label "Show KSeF status badge" comes from the descriptor module (AC-8) and is ABSENT from the shared CapabilityTogglesSection source', () => {
    // Rendered label is provider-supplied.
    renderWithProviders(<Harness />);
    expect(screen.getByText('Show KSeF status badge')).toBeInTheDocument();

    // ...and the shared component source carries no such literal.
    const sharedSource = readFileSync(
      resolve(process.cwd(), 'src/features/connections/components/CapabilityTogglesSection.tsx'),
      'utf8',
    );
    expect(sharedSource).not.toContain('KSeF');
  });

  it('disables Bridge URL, trigger Select, and toggles when configText is unparseable', () => {
    renderWithProviders(<Harness configIsParseable={false} />);
    expect(screen.getByPlaceholderText('https://localhost:5005')).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('pre-selects the trigger dropdown from the hydrated form value', () => {
    renderWithProviders(
      <Harness defaultValues={{ subiektTriggerModel: 'batched' }} />,
    );
    expect(screen.getByRole('combobox')).toHaveValue('batched');
  });
});
