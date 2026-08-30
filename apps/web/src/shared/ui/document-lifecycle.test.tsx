import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentLifecycle, type DocumentLifecycleStep } from './document-lifecycle';

const ISSUED: DocumentLifecycleStep = {
  id: 'issued',
  label: 'Issued',
  state: 'done',
  at: '2026-08-26T09:12:00.000Z',
};
const SENT: DocumentLifecycleStep = {
  id: 'submitted',
  label: 'Sent to the authority',
  state: 'done',
  at: '2026-08-26T09:12:00.000Z',
};
const ANSWER: DocumentLifecycleStep = {
  id: 'answer',
  label: 'Authority answer',
  state: 'active',
  at: null,
};

describe('DocumentLifecycle', () => {
  afterEach(cleanup);

  it('should render no trail for a fiscal receipt', () => {
    // A receipt has no authority axis (ADR-042, ADR-065). Refusing here is what
    // stops a caller padding one out of stages that do not exist.
    const { container } = render(
      <DocumentLifecycle kind="fiscal-receipt" steps={[ISSUED, SENT, ANSWER]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('should render no trail when routing named no document', () => {
    const { container } = render(<DocumentLifecycle kind={null} steps={[ISSUED]} />);
    expect(container.firstChild).toBeNull();
  });

  it('should render no trail when the caller has no persisted steps', () => {
    const { container } = render(<DocumentLifecycle kind="invoice" steps={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('should render one step per persisted stage, and no others', () => {
    render(<DocumentLifecycle kind="invoice" steps={[ISSUED, SENT, ANSWER]} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Issued')).toBeInTheDocument();
    expect(screen.getByText('Sent to the authority')).toBeInTheDocument();
    expect(screen.getByText('Authority answer')).toBeInTheDocument();
  });

  it('should announce each step state in words, not colour alone', () => {
    render(
      <DocumentLifecycle
        kind="invoice"
        steps={[ISSUED, { id: 'answer', label: 'Authority answer', state: 'error', at: null }]}
      />,
    );
    expect(screen.getByText(', done')).toBeInTheDocument();
    expect(screen.getByText(', failed')).toBeInTheDocument();
  });

  it('should give done, active and error markers different shapes', () => {
    const { container } = render(
      <DocumentLifecycle
        kind="invoice"
        steps={[
          ISSUED,
          ANSWER,
          { id: 'x', label: 'Rejected', state: 'error', at: null },
          { id: 'y', label: 'Later', state: 'todo', at: null },
        ]}
      />,
    );
    const markers = Array.from(container.querySelectorAll('.document-lifecycle__marker'));
    // done carries a tick, error a cross, active and todo carry neither - so the
    // four are separable with the tint removed.
    expect(markers[0]?.querySelector('svg')).not.toBeNull();
    expect(markers[1]?.querySelector('svg')).toBeNull();
    expect(markers[2]?.querySelector('svg')).not.toBeNull();
    expect(markers[0]?.innerHTML).not.toBe(markers[2]?.innerHTML);
    expect(markers[3]?.querySelector('svg')).toBeNull();
  });

  it('should mark the in-flight step as the current one', () => {
    render(<DocumentLifecycle kind="invoice" steps={[ISSUED, ANSWER]} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).not.toHaveAttribute('aria-current');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
  });

  it('should state a missing timestamp as missing rather than borrowing one', () => {
    render(<DocumentLifecycle kind="invoice" steps={[ISSUED, ANSWER]} />);
    expect(screen.getByText('No time recorded for Authority answer')).toBeInTheDocument();
    expect(screen.getAllByRole('time')).toHaveLength(1);
  });

  it('should name the trail for assistive technology', () => {
    render(<DocumentLifecycle kind="invoice" steps={[ISSUED]} label="Invoice lifecycle" />);
    expect(screen.getByRole('list', { name: 'Invoice lifecycle' })).toBeInTheDocument();
  });
});
