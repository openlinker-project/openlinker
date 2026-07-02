import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineDisclosure } from './inline-disclosure';

describe('InlineDisclosure', () => {
  it('renders the label, value, and Change affordance in the collapsed summary', () => {
    render(
      <InlineDisclosure label="Payment method for invoice:" value="Transfer">
        <p>panel content</p>
      </InlineDisclosure>,
    );
    expect(screen.getByText('Payment method for invoice:')).toBeInTheDocument();
    expect(screen.getByText('Transfer')).toBeInTheDocument();
    expect(screen.getByText('Change →')).toBeInTheDocument();
  });

  it('hides the panel content until expanded', () => {
    render(
      <InlineDisclosure label="Payment method for invoice:" value="Transfer">
        <p>panel content</p>
      </InlineDisclosure>,
    );
    expect(screen.getByText('panel content')).not.toBeVisible();
  });

  it('reveals the panel content when the summary is clicked', async () => {
    const user = userEvent.setup();
    render(
      <InlineDisclosure label="Payment method for invoice:" value="Transfer">
        <p>panel content</p>
      </InlineDisclosure>,
    );

    await user.click(screen.getByText('Payment method for invoice:'));

    expect(screen.getByText('panel content')).toBeVisible();
  });

  it('renders open by default when defaultOpen is true', () => {
    render(
      <InlineDisclosure label="Payment method for invoice:" value="Transfer" defaultOpen>
        <p>panel content</p>
      </InlineDisclosure>,
    );
    expect(screen.getByText('panel content')).toBeVisible();
  });

  it('uses a custom changeLabel when provided', () => {
    render(
      <InlineDisclosure label="Payment method for invoice:" value="Transfer" changeLabel="Edit">
        <p>panel content</p>
      </InlineDisclosure>,
    );
    expect(screen.getByText('Edit →')).toBeInTheDocument();
  });
});
