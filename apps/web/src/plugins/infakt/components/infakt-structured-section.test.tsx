/**
 * InfaktStructuredSection Tests
 *
 * Coverage for the baseUrl editor field shown in EditConnectionForm for
 * inFakt connections. Tests propagation to JSON config via
 * syncStructuredToJson callback. Mirrors
 * `woocommerce-structured-section.test.tsx`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test component mocking requires flexible types */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { InfaktStructuredSection } from './infakt-structured-section';

describe('InfaktStructuredSection', () => {
  afterEach(cleanup);

  it('renders the baseUrl field for editing', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: 'https://api.infakt.pl' },
      });
      return (
        <InfaktStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={true}
          syncStructuredToJson={vi.fn()}
        />
      );
    };
    renderWithProviders(<TestComponent />);
    expect(screen.getByDisplayValue('https://api.infakt.pl')).toBeInTheDocument();
  });

  it('calls syncStructuredToJson with the baseUrl config key when the value changes', () => {
    const syncStructuredToJson = vi.fn();
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: 'https://api.infakt.pl' },
      });
      return (
        <InfaktStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={true}
          syncStructuredToJson={syncStructuredToJson}
        />
      );
    };
    renderWithProviders(<TestComponent />);

    const input = screen.getByDisplayValue('https://api.infakt.pl');
    fireEvent.change(input, { target: { value: 'https://sandbox.infakt.pl' } });

    expect(syncStructuredToJson).toHaveBeenCalledWith('baseUrl', 'https://sandbox.infakt.pl');
  });

  it('disables input when configIsParseable is false', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: 'https://api.infakt.pl' },
      });
      return (
        <InfaktStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={false}
          syncStructuredToJson={vi.fn()}
        />
      );
    };
    renderWithProviders(<TestComponent />);

    const input = screen.getByDisplayValue('https://api.infakt.pl');
    expect(input).toBeDisabled();
  });

  it('shows form error message when baseUrl has a validation error', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: '' },
      });
      form.formState.errors.baseUrl = {
        message: 'Base URL must use HTTPS',
        type: 'manual',
      };
      return (
        <InfaktStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={true}
          syncStructuredToJson={vi.fn()}
        />
      );
    };
    renderWithProviders(<TestComponent />);

    expect(screen.getByText('Base URL must use HTTPS')).toBeInTheDocument();
  });
});
