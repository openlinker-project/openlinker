/**
 * ErliStructuredSection Tests
 *
 * Coverage for the Callback URL editor field shown in EditConnectionForm
 * for Erli connections (#1454 follow-up). The bound config key is
 * `callbackBaseUrl` — the key `ErliWebhookProvisioningAdapter` expects.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test component mocking requires flexible types */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { ErliStructuredSection } from './erli-structured-section';

describe('ErliStructuredSection', () => {
  afterEach(cleanup);

  it('renders the callbackBaseUrl field for editing', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { callbackBaseUrl: 'https://api.example.com' },
      });
      return (
        <ErliStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={true}
          syncStructuredToJson={vi.fn()}
        />
      );
    };
    renderWithProviders(<TestComponent />);
    expect(screen.getByDisplayValue('https://api.example.com')).toBeInTheDocument();
  });

  it('calls syncStructuredToJson with the callbackBaseUrl config key when the value changes', () => {
    const syncStructuredToJson = vi.fn();
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { callbackBaseUrl: 'https://api.example.com' },
      });
      return (
        <ErliStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={true}
          syncStructuredToJson={syncStructuredToJson}
        />
      );
    };
    renderWithProviders(<TestComponent />);

    const input = screen.getByDisplayValue('https://api.example.com');
    fireEvent.change(input, { target: { value: 'https://newapi.example.com' } });

    expect(syncStructuredToJson).toHaveBeenCalledWith(
      'callbackBaseUrl',
      'https://newapi.example.com'
    );
  });

  it('disables input when configIsParseable is false', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { callbackBaseUrl: 'https://api.example.com' },
      });
      return (
        <ErliStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={false}
          syncStructuredToJson={vi.fn()}
        />
      );
    };
    renderWithProviders(<TestComponent />);

    const input = screen.getByDisplayValue('https://api.example.com');
    expect(input).toBeDisabled();
  });

  it('shows form error message when callbackBaseUrl has a validation error', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { callbackBaseUrl: '' },
      });
      form.formState.errors.callbackBaseUrl = {
        message: 'Callback URL must use http:// or https://',
        type: 'manual',
      };
      return (
        <ErliStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={true}
          syncStructuredToJson={vi.fn()}
        />
      );
    };
    renderWithProviders(<TestComponent />);

    expect(screen.getByText('Callback URL must use http:// or https://')).toBeInTheDocument();
  });
});
