/**
 * InfaktStructuredSection Tests
 *
 * Coverage for the baseUrl editor field and default-payment-method select
 * (#1303) shown in EditConnectionForm for inFakt connections. Tests
 * propagation to JSON config via syncStructuredToJson callback. Mirrors
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

  it('shows the effective payment method in the collapsed disclosure summary (#1303)', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: '', infaktPaymentMethod: 'transfer' },
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
    expect(screen.getByText('Payment method for invoice:')).toBeInTheDocument();
    expect(screen.getByText('Transfer', { selector: '.inline-disclosure__value' })).toBeInTheDocument();
    expect(screen.getByLabelText('Default payment method')).not.toBeVisible();
  });

  it('defaults the collapsed summary to Cash when no value is set', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: '', infaktPaymentMethod: '' },
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
    expect(screen.getByText('Cash', { selector: '.inline-disclosure__value' })).toBeInTheDocument();
  });

  it('renders the default payment method select once expanded (#1303)', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: '', infaktPaymentMethod: 'cash' },
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

    fireEvent.click(screen.getByText('Payment method for invoice:'));

    expect(screen.getByLabelText('Default payment method')).toHaveValue('cash');
  });

  it('calls syncStructuredToJson with the infaktPaymentMethod config key when the selection changes', () => {
    const syncStructuredToJson = vi.fn();
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: '', infaktPaymentMethod: 'cash' },
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

    fireEvent.click(screen.getByText('Payment method for invoice:'));
    fireEvent.change(screen.getByLabelText('Default payment method'), {
      target: { value: 'transfer' },
    });

    expect(syncStructuredToJson).toHaveBeenCalledWith('infaktPaymentMethod', 'transfer');
  });

  it('disables the payment method select when configIsParseable is false', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: '', infaktPaymentMethod: 'cash' },
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

    fireEvent.click(screen.getByText('Payment method for invoice:'));

    expect(screen.getByLabelText('Default payment method')).toBeDisabled();
  });
});
