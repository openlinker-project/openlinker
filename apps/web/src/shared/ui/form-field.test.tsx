import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField } from './form-field';
import { Input } from './input';

describe('FormField', () => {
  it('preserves existing aria-describedby values while adding field metadata', () => {
    render(
      <>
        <p id="external-help">External help text</p>
        <FormField
          name="connectionName"
          label="Connection name"
          description="Internal description"
          error="This field is required"
        >
          <Input aria-describedby="external-help" />
        </FormField>
      </>,
    );

    const input = screen.getByRole('textbox', { name: 'Connection name' });
    const describedBy = input.getAttribute('aria-describedby');

    expect(describedBy).toContain('external-help');
    expect(describedBy).toMatch(/connectionName-.*-description/);
    expect(describedBy).toMatch(/connectionName-.*-error/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
