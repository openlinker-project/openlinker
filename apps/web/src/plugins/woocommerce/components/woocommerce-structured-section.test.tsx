/**
 * WoocommerceStructuredSection Tests
 *
 * Coverage for the Site URL editor field shown in EditConnectionForm
 * for WooCommerce connections. Tests propagation to JSON config via
 * syncStructuredToJson callback. The bound config key is `siteUrl` —
 * the key the WooCommerce backend config DTO expects.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test component mocking requires flexible types */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { WoocommerceStructuredSection } from './woocommerce-structured-section';

describe('WoocommerceStructuredSection', () => {
  afterEach(cleanup);

  it('renders the siteUrl field for editing', () => {
    const TestComponent = () => {
      const form = useForm<any>({
        defaultValues: { siteUrl: 'https://shop.example.com' },
      });
      return (
        <WoocommerceStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={true}
          syncStructuredToJson={vi.fn()}
        />
      );
    };
    renderWithProviders(<TestComponent />);
    expect(screen.getByDisplayValue('https://shop.example.com')).toBeInTheDocument();
  });

  it('calls syncStructuredToJson with the siteUrl config key when the value changes', () => {
    const syncStructuredToJson = vi.fn();
    const TestComponent = () => {
      const form = useForm<any>({
        defaultValues: { siteUrl: 'https://shop.example.com' },
      });
      return (
        <WoocommerceStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={true}
          syncStructuredToJson={syncStructuredToJson}
        />
      );
    };
    renderWithProviders(<TestComponent />);

    const input = screen.getByDisplayValue('https://shop.example.com');
    fireEvent.change(input, { target: { value: 'https://newshop.example.com' } });

    expect(syncStructuredToJson).toHaveBeenCalledWith(
      'siteUrl',
      'https://newshop.example.com'
    );
  });

  it('disables input when configIsParseable is false', () => {
    const TestComponent = () => {
      const form = useForm<any>({
        defaultValues: { siteUrl: 'https://shop.example.com' },
      });
      return (
        <WoocommerceStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={false}
          syncStructuredToJson={vi.fn()}
        />
      );
    };
    renderWithProviders(<TestComponent />);

    const input = screen.getByDisplayValue('https://shop.example.com');
    expect(input).toBeDisabled();
  });

  it('shows form error message when siteUrl has validation error', () => {
    const TestComponent = () => {
      const form = useForm<any>({
        defaultValues: { siteUrl: '' },
      });
      form.formState.errors.siteUrl = {
        message: 'Site URL must use HTTPS',
        type: 'manual',
      };
      return (
        <WoocommerceStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={true}
          syncStructuredToJson={vi.fn()}
        />
      );
    };
    renderWithProviders(<TestComponent />);

    expect(screen.getByText('Site URL must use HTTPS')).toBeInTheDocument();
  });
});
