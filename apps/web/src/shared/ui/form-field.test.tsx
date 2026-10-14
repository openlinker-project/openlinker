import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField, useFormFieldControl } from './form-field';
import { Input } from './input';
import { Select } from './select';

/** A control that takes its wiring from the field, as a composed row must. */
function WiredInput({ label }: { label: string }) {
  const control = useFormFieldControl();
  return <Input aria-label={label} {...control} />;
}

describe('FormField', () => {
  describe('a single control element (unchanged)', () => {
    it('should clone id and aria wiring onto the control and point the label at it', () => {
      render(
        <FormField name="amount" label="Amount" description="In PLN" error="Required">
          <Input />
        </FormField>,
      );

      const input = screen.getByRole('textbox', { name: 'Amount' });
      expect(input).toHaveAttribute('id');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input.getAttribute('aria-describedby')).toMatch(/-description/);
      expect(input.getAttribute('aria-describedby')).toMatch(/-error/);
    });

    it('should keep an id the control already carries', () => {
      render(
        <FormField name="amount" label="Amount">
          <Input id="my-amount" />
        </FormField>,
      );

      expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveAttribute('id', 'my-amount');
    });
  });

  describe('shapes that are not a single control (#2435)', () => {
    it('should render two controls on one row without throwing', () => {
      render(
        <FormField name="range" label="Range">
          <>
            <WiredInput label="from" />
            <Input aria-label="to" />
          </>
        </FormField>,
      );

      expect(screen.getByLabelText('from')).toBeInTheDocument();
      expect(screen.getByLabelText('to')).toBeInTheDocument();
    });

    it('should render a fragment child without throwing', () => {
      expect(() =>
        render(
          <FormField name="f" label="Field">
            <>
              <WiredInput label="inner" />
            </>
          </FormField>,
        ),
      ).not.toThrow();
    });

    it('should render an array child without throwing', () => {
      expect(() =>
        render(
          <FormField name="f" label="Field">
            {[<WiredInput key="a" label="a" />, <Input key="b" aria-label="b" />]}
          </FormField>,
        ),
      ).not.toThrow();
    });

    it.each([
      ['null', null],
      ['false', false],
    ])('should render without throwing when the child is %s', (_name, child) => {
      render(
        <FormField name="f" label="Field">
          {child}
        </FormField>,
      );

      expect(screen.getByText('Field')).toBeInTheDocument();
    });

    it('should wire the hook-using control with id and aria attributes and a working label', () => {
      render(
        <FormField name="reserve" label="Reserve" description="Units held back" error="Too high">
          <>
            <WiredInput label="reserve-input" />
            <button type="button">Remove</button>
          </>
        </FormField>,
      );

      const input = screen.getByLabelText('reserve-input');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input.getAttribute('aria-describedby')).toMatch(/reserve-.*-description/);
      expect(input.getAttribute('aria-describedby')).toMatch(/reserve-.*-error/);
      // The visible label targets the wired control, so clicking it focuses the input.
      expect(screen.getByText('Reserve')).toHaveAttribute('for', input.getAttribute('id'));
    });

    it('should leave a sibling that does not use the hook untouched', () => {
      render(
        <FormField name="reserve" label="Reserve" error="Too high">
          <>
            <WiredInput label="wired" />
            <Input aria-label="unwired" />
          </>
        </FormField>,
      );

      expect(screen.getByLabelText('unwired')).not.toHaveAttribute('aria-invalid');
      expect(screen.getByLabelText('unwired')).not.toHaveAttribute('aria-describedby');
    });

    it('should wire a Select used as the hook control next to an inline sibling', () => {
      function WiredSelect() {
        const control = useFormFieldControl();
        return (
          <Select aria-label="adapter" {...control}>
            <option value="a">a</option>
          </Select>
        );
      }

      render(
        <FormField name="adapter" label="Adapter" error="Pick one">
          <>
            <WiredSelect />
            <button type="button">Remove</button>
          </>
        </FormField>,
      );

      expect(screen.getByLabelText('adapter')).toHaveAttribute('aria-invalid', 'true');
    });
  });

  describe('useFormFieldControl outside a FormField', () => {
    it('should return no wiring so a control can use it unconditionally', () => {
      render(<WiredInput label="standalone" />);

      const input = screen.getByLabelText('standalone');
      expect(input).not.toHaveAttribute('aria-invalid', 'true');
      expect(input).not.toHaveAttribute('aria-describedby');
    });
  });

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
