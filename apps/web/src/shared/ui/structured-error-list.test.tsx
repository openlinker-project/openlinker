/**
 * StructuredErrorList Tests (#486, generalised in #607)
 *
 * @module apps/web/src/shared/ui
 */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StructuredErrorList,
  type StructuredError,
  type StructuredErrorTranslation,
} from './structured-error-list';

// In-test translator that mimics the marketplace-translator contract. Lets the
// primitive's tests cover the translation pipeline without coupling to any
// real feature-layer translator (Allegro / PrestaShop / …).
function fakeTranslate(error: StructuredError): StructuredErrorTranslation | null {
  if (error.code === 'MAPPED_CODE') {
    return { message: 'Friendly translated message' };
  }
  return null;
}

describe('StructuredErrorList', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    writeText.mockClear();
  });

  it('returns null when errors are null', () => {
    const { container } = render(<StructuredErrorList errors={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('returns null when errors are an empty array', () => {
    const { container } = render(<StructuredErrorList errors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('exposes the list with a generic "Errors" aria-label (no platform name)', () => {
    render(
      <StructuredErrorList errors={[{ code: 'X', message: 'msg' }]} />,
    );
    expect(screen.getByRole('list', { name: /^errors$/i })).toBeInTheDocument();
  });

  describe('field-path breadcrumb', () => {
    it('splits dotted paths into trail + leaf, leaf is the visual anchor', () => {
      const errors: StructuredError[] = [
        {
          field: 'offer.modules.productSafety.data.productsData[0].responsibleProducer',
          code: 'RESPONSIBLE_PRODUCER_NOT_SPECIFIED',
          message: 'Responsible producer is required for every product in the offer',
        },
      ];
      render(<StructuredErrorList errors={errors} />);

      // The leaf segment uses the special "leaf" class; the trail uses
      // separate spans. We verify the leaf segment is present as text and
      // that the trail segments render too.
      expect(screen.getByText('responsibleProducer')).toBeInTheDocument();
      expect(screen.getByText('offer')).toBeInTheDocument();
      expect(screen.getByText('productSafety')).toBeInTheDocument();
    });

    it('copies the full dotted path on click and surfaces a confirmation', async () => {
      const errors: StructuredError[] = [
        { field: 'parameters.EAN', code: 'MISSING_EAN', message: 'EAN is required.' },
      ];
      render(<StructuredErrorList errors={errors} />);

      const button = screen.getByRole('button', { name: /Copy field path parameters\.EAN/i });
      fireEvent.click(button);

      expect(writeText).toHaveBeenCalledWith('parameters.EAN');
      await waitFor(() => {
        expect(screen.getByText(/copied/i)).toBeInTheDocument();
      });
    });

    it('treats a literal "null" sentinel field as no field', () => {
      const errors: StructuredError[] = [
        {
          field: 'null',
          code: 'MAPPED_CODE',
          message: 'Raw message',
        },
      ];
      render(<StructuredErrorList errors={errors} translate={fakeTranslate} />);

      // No copy button — the sentinel is filtered out.
      expect(screen.queryByRole('button', { name: /Copy field path/i })).not.toBeInTheDocument();
      // Translated message still renders.
      expect(screen.getByText('Friendly translated message')).toBeInTheDocument();
    });

    it('renders single-segment paths without breadcrumb separators', () => {
      const errors: StructuredError[] = [
        { field: 'name', code: 'TOO_LONG', message: 'Name is too long.' },
      ];
      render(<StructuredErrorList errors={errors} />);

      const button = screen.getByRole('button', { name: /Copy field path name/i });
      expect(button).toHaveTextContent('name');
      expect(button.querySelectorAll('.structured-error-list__field-sep')).toHaveLength(0);
    });
  });

  describe('translation pipeline', () => {
    it('renders the friendly translation for mapped codes and keeps the raw message in <details>', () => {
      const errors: StructuredError[] = [
        { code: 'MAPPED_CODE', message: 'Raw platform message.' },
      ];
      render(<StructuredErrorList errors={errors} translate={fakeTranslate} />);

      expect(screen.getByText('Friendly translated message')).toBeInTheDocument();
      const details = screen.getByText(/^original message$/i).closest('details');
      expect(details).not.toBeNull();
      expect(details).not.toHaveAttribute('open');
      expect(screen.getByText('Raw platform message.')).toBeInTheDocument();
    });

    it('renders raw message verbatim with no <details> when translator returns null', () => {
      const errors: StructuredError[] = [
        { code: 'UNMAPPED_CODE', message: 'Raw platform message.' },
      ];
      render(<StructuredErrorList errors={errors} translate={fakeTranslate} />);

      expect(screen.getByText('Raw platform message.')).toBeInTheDocument();
      expect(screen.queryByText(/^original message$/i)).toBeNull();
    });

    it('renders raw message verbatim with no <details> when translate prop is omitted', () => {
      const errors: StructuredError[] = [
        { code: 'ANYTHING', message: 'Raw platform message.' },
      ];
      render(<StructuredErrorList errors={errors} />);

      expect(screen.getByText('Raw platform message.')).toBeInTheDocument();
      expect(screen.queryByText(/^original message$/i)).toBeNull();
    });
  });

  it('renders the error code as a <code> chip with a full-text title', () => {
    const errors: StructuredError[] = [
      { code: 'RESPONSIBLE_PRODUCER_NOT_SPECIFIED', message: 'msg' },
    ];
    render(<StructuredErrorList errors={errors} />);

    // <code> not <kbd>: this is program-output, not keyboard input.
    const codeChip = screen.getByText('RESPONSIBLE_PRODUCER_NOT_SPECIFIED');
    expect(codeChip.tagName.toLowerCase()).toBe('code');
    expect(codeChip).toHaveAttribute('title', 'RESPONSIBLE_PRODUCER_NOT_SPECIFIED');
  });
});
