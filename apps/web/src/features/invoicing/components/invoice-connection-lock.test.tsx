/**
 * InvoiceConnectionLock — structure and stylesheet contract (#3484)
 *
 * jsdom does no layout, so a test cannot MEASURE the one-word-per-line defect.
 * What it can pin is the two halves the fix rests on: the DOM gives the name and
 * the tag separate elements to style, and the stylesheet carries the rules that
 * keep column 2 from being sized by its content. The rules are asserted against
 * `index.css` itself — the `*-styles.test.ts` precedent — because a rule that is
 * silently dropped is exactly how this regressed: #2047 shipped
 * `.invoice-connection-lock__hint { grid-column: 2 }` and #2809 removed it.
 *
 * @module apps/web/src/features/invoicing/components
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../../test/test-utils';
import { InvoiceConnectionLock } from './invoice-connection-lock';

const LONG_NAME = 'Subiekt GT (DEMO) - Invoicing - warehouse two';

const css = readFileSync(join(__dirname, '..', '..', '..', 'index.css'), 'utf8');

/** The declaration block of the first rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  if (start === -1) throw new Error(`no rule for ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

describe('InvoiceConnectionLock', () => {
  describe('rendering', () => {
    it('should render the full connection name in its own element, never truncated', () => {
      renderWithProviders(
        <InvoiceConnectionLock status="in-doubt" connectionName={LONG_NAME} tag="subiekt-gt" isStale={false} />,
      );

      const name = screen.getByText(LONG_NAME);
      expect(name).toHaveClass('invoice-connection-lock__name');
      expect(name).toHaveTextContent(LONG_NAME);
    });

    it('should render the tag as a sibling of the name inside the value row', () => {
      renderWithProviders(
        <InvoiceConnectionLock status="in-doubt" connectionName={LONG_NAME} tag="subiekt-gt" isStale={false} />,
      );

      const tag = screen.getByText('subiekt-gt');
      expect(tag).toHaveClass('invoice-connection-lock__tag');
      expect(tag.parentElement).toBe(screen.getByText(LONG_NAME).parentElement);
    });

    it('should keep the eyebrow copy for the in-doubt status unchanged', () => {
      renderWithProviders(
        <InvoiceConnectionLock status="in-doubt" connectionName="Main" tag="ksef" isStale={false} />,
      );

      expect(screen.getByText('Still assigned to')).toBeInTheDocument();
    });

    it('should render an operational hint as a direct grid item, with no disclosure', () => {
      renderWithProviders(
        <InvoiceConnectionLock status="in-doubt" connectionName="Main" tag="ksef" isStale={false} />,
      );

      const hint = screen.getByText(/No provider change and no one-click retry/);
      expect(hint).toHaveClass('invoice-connection-lock__hint');
      expect(hint.closest('details')).toBeNull();
    });

    // #3766 — a settled document renders no box: the headline already names
    // the connection, so only the "Why this document?" disclosure remains.
    it('should render only the "Why this document?" disclosure when the document is settled', () => {
      const { container } = renderWithProviders(
        <InvoiceConnectionLock status="issued" connectionName="Main" tag="ksef" isStale={false} />,
      );

      expect(screen.getByText('Why this document?').closest('details')).not.toBeNull();
      expect(container.querySelector('.invoice-connection-lock')).toBeNull();
      expect(screen.queryByText('Issued by')).not.toBeInTheDocument();
    });

    it('should name the connection and the one-document rule inside the settled disclosure', () => {
      renderWithProviders(
        <InvoiceConnectionLock status="issued" connectionName="Main" tag="ksef" isStale={false} />,
      );

      const hint = screen.getByText(/Issued by Main\./);
      expect(hint).toHaveTextContent(/One sale gets one document/);
      expect(hint.closest('details')).not.toBeNull();
    });

    it('should keep the box for a settled document whose connection is no longer active', () => {
      const { container } = renderWithProviders(
        <InvoiceConnectionLock status="issued" connectionName="Main" tag="disconnected" isStale />,
      );

      expect(container.querySelector('.invoice-connection-lock')).not.toBeNull();
      expect(screen.getByText('Issued by')).toBeInTheDocument();
      expect(screen.queryByText('Why this document?')).not.toBeInTheDocument();
    });
  });

  describe('stylesheet', () => {
    it('should give column 2 a zero floor so its content cannot size it', () => {
      expect(ruleBody('.invoice-connection-lock')).toMatch(
        /grid-template-columns:\s*auto minmax\(0,\s*1fr\)/,
      );
    });

    // The root cause: without it a bare hint is auto-placed into the glyph's
    // `auto` column, which grows to the hint's width.
    it('should place the bare hint in column 2', () => {
      expect(ruleBody('.invoice-connection-lock__hint')).toMatch(/grid-column:\s*2/);
    });

    it('should place the eyebrow and the value row in column 2', () => {
      expect(ruleBody('.invoice-connection-lock__eyebrow')).toMatch(/grid-column:\s*2/);
      expect(ruleBody('.invoice-connection-lock__value')).toMatch(/grid-column:\s*2/);
    });

    it('should let the name shrink and break anywhere instead of being truncated', () => {
      const name = ruleBody('.invoice-connection-lock__name');
      expect(name).toMatch(/min-width:\s*0/);
      expect(name).toMatch(/overflow-wrap:\s*anywhere/);
      expect(name).not.toMatch(/text-overflow|ellipsis/);
    });

    it('should keep the tag beside the name rather than wrapping onto its own line', () => {
      expect(ruleBody('.invoice-connection-lock__value')).toMatch(/flex-wrap:\s*nowrap/);
      const tag = ruleBody('.invoice-connection-lock__tag');
      expect(tag).toMatch(/flex:\s*none/);
      expect(tag).toMatch(/white-space:\s*nowrap/);
    });

    it('should wrap the eyebrow and the hint at word boundaries', () => {
      expect(ruleBody('.invoice-connection-lock__eyebrow')).toMatch(/overflow-wrap:\s*break-word/);
      expect(ruleBody('.invoice-connection-lock__hint')).toMatch(/overflow-wrap:\s*break-word/);
    });
  });
});
