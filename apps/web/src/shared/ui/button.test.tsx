import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { Button } from './button';

describe('Button', () => {
  afterEach(cleanup);

  it('renders with primary tone by default', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toHaveClass('button', 'button--primary');
  });

  it('applies the requested tone modifier', () => {
    render(<Button tone="danger">Delete</Button>);
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('button--danger');
  });

  it('forwards ref to the native button element', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>Hi</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('merges custom className with internal classes', () => {
    render(<Button className="custom-a custom-b">Hi</Button>);
    const btn = screen.getByRole('button', { name: 'Hi' });
    expect(btn).toHaveClass('button', 'button--primary', 'custom-a', 'custom-b');
  });

  it('defaults type to button to prevent accidental form submission', () => {
    render(<Button>Hi</Button>);
    expect(screen.getByRole('button', { name: 'Hi' })).toHaveAttribute('type', 'button');
  });

  it('honours an explicit type override', () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('type', 'submit');
  });
});
