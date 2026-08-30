import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentHeadline } from './document-headline';

describe('DocumentHeadline', () => {
  afterEach(cleanup);

  it('should read as the kind and then the state', () => {
    render(<DocumentHeadline kind="invoice" state="Issued" tone="done" />);
    expect(screen.getByText(/Invoice/)).toBeInTheDocument();
    expect(screen.getByText(/Issued/)).toBeInTheDocument();
  });

  it('should say no document when routing named none', () => {
    render(<DocumentHeadline kind={null} state="No routing" tone="error" />);
    expect(screen.getByText(/No document/)).toBeInTheDocument();
  });

  it('should not announce the kind twice', () => {
    // The glyph sits beside the kind word, so it must be decorative here.
    render(<DocumentHeadline kind="fiscal-receipt" state="Registered" tone="done" />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('should carry a tick on a finished document, so colour is not the only signal', () => {
    const { container } = render(<DocumentHeadline kind="invoice" state="Issued" tone="done" />);
    expect(container.querySelector('.document-headline__tick')).not.toBeNull();
    expect(container.querySelector('.document-headline__live')).toBeNull();
  });

  it('should carry a live dot while a document is in flight', () => {
    const { container } = render(
      <DocumentHeadline kind="fiscal-receipt" state="Registering" tone="progress" />,
    );
    expect(container.querySelector('.document-headline__live')).not.toBeNull();
    expect(container.querySelector('.document-headline__tick')).toBeNull();
  });

  it('should leave a finished document plain, tinting only what needs attention', () => {
    const done = render(<DocumentHeadline kind="invoice" state="Issued" tone="done" />);
    expect(done.container.querySelector('.document-headline__main--done')).not.toBeNull();
    cleanup();

    const rejected = render(
      <DocumentHeadline kind="invoice" state="KSeF rejected" tone="error" />,
    );
    expect(rejected.container.querySelector('.document-headline__main--error')).not.toBeNull();
  });

  it('should default to the plain idle tone', () => {
    const { container } = render(<DocumentHeadline kind="invoice" state="Not issued" />);
    expect(container.querySelector('.document-headline__main--idle')).not.toBeNull();
  });

  it('should render the identity sub-line only when there is one', () => {
    const withIdentity = render(
      <DocumentHeadline kind="invoice" state="Issued" tone="done" identity="FA/2026/08/0144" />,
    );
    expect(screen.getByText('FA/2026/08/0144')).toBeInTheDocument();
    expect(withIdentity.container.querySelector('.document-headline__sub')).not.toBeNull();
    cleanup();

    const without = render(<DocumentHeadline kind="invoice" state="Issued" tone="done" />);
    expect(without.container.querySelector('.document-headline__sub')).toBeNull();
  });
});
