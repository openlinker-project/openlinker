/**
 * OfferProductPickerModal tests (#1754)
 *
 * Covers the unified offer-creation entry point:
 *   - paginated product list + persisted selection across pages
 *   - whole-product tri-state ('all') vs single-variant ('some')
 *   - mixed selection across two products
 *   - Continue URL construction (whole-only / single-variant / mixed)
 *   - connection auto-resolve (1) vs picker (2+)
 *   - Continue disabled with no selection
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReactRouterDom from 'react-router-dom';
import type { ApiClient } from '../../../app/api/api-client';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { OfferProductPickerModal } from './offer-product-picker-modal';
import type { Connection } from '../../connections';
import type { Product } from '../../products';

interface PaginatedProductsShape {
  items: Product[];
  total: number;
  limit: number;
  offset: number;
}

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (): Promise<typeof ReactRouterDom> => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
  return { ...actual, useNavigate: (): typeof navigateMock => navigateMock };
});

function conn(id: string, name: string, platformType: string): Connection {
  return {
    id,
    name,
    platformType,
    status: 'active',
    config: {},
    credentialsBacked: true,
    adapterKey: `${platformType}.v1`,
    enabledCapabilities: ['OfferManager'],
    supportedCapabilities: ['OfferManager', 'OfferCreator'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Connection;
}

function makeProduct(id: string, variantIds: string[]): Product {
  return {
    id,
    name: `Product ${id}`,
    sku: `SKU-${id}`,
    price: null,
    currency: null,
    description: null,
    images: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    variants: variantIds.map((vid) => ({
      id: vid,
      productId: id,
      sku: vid,
      attributes: null,
      ean: null,
      gtin: null,
      price: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })),
  };
}

const P1 = makeProduct('p1', ['v1a', 'v1b']);
const P2 = makeProduct('p2', ['v2a']);
// A full first page (10) plus 2 on page 2 so the pager shows.
const FIRST_PAGE: Product[] = [
  P1,
  P2,
  ...Array.from({ length: 8 }, (_, i) => makeProduct(`f${i.toString()}`, [`fv${i.toString()}`])),
];
const SECOND_PAGE: Product[] = [makeProduct('p11', ['v11a']), makeProduct('p12', ['v12a'])];

function mocks(connections: Connection[]): ApiClient {
  const byId = new Map<string, Product>();
  for (const p of [...FIRST_PAGE, ...SECOND_PAGE]) byId.set(p.id, p);
  return createMockApiClient({
    connections: { list: vi.fn().mockResolvedValue(connections) },
    products: {
      list: vi
        .fn()
        .mockImplementation((_f, pagination): Promise<PaginatedProductsShape> => {
          const offset = (pagination?.offset as number | undefined) ?? 0;
          const items = offset === 0 ? FIRST_PAGE : SECOND_PAGE;
          return Promise.resolve({ items, total: 12, limit: 10, offset });
        }),
      getById: vi.fn().mockImplementation((id: string) => Promise.resolve(byId.get(id) ?? null)),
    },
  });
}

function continueUrlParams(): URLSearchParams {
  const arg = navigateMock.mock.calls.at(-1)?.[0] as string;
  return new URLSearchParams(arg.split('?')[1] ?? '');
}

describe('OfferProductPickerModal', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('renders nothing when closed', () => {
    renderWithProviders(<OfferProductPickerModal isOpen={false} onClose={vi.fn()} />, {
      apiClient: mocks([conn('conn_a', 'Allegro', 'allegro')]),
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lists paginated products and shows the pager', async () => {
    renderWithProviders(<OfferProductPickerModal isOpen onClose={vi.fn()} />, {
      apiClient: mocks([conn('conn_a', 'Allegro', 'allegro')]),
    });
    expect(await screen.findByText('Product p1')).toBeInTheDocument();
    expect(screen.getByText('1–10 of 12')).toBeInTheDocument();
  });

  it('selects a whole product (tri-state all) and Continue omits variantIds', async () => {
    renderWithProviders(<OfferProductPickerModal isOpen onClose={vi.fn()} />, {
      apiClient: mocks([conn('conn_a', 'Allegro', 'allegro')]),
    });
    const cb = await screen.findByLabelText<HTMLInputElement>('Select Product p1');
    fireEvent.click(cb);
    expect(cb.checked).toBe(true);
    expect(screen.getByText(/1 item selected across/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    const qs = continueUrlParams();
    expect(qs.get('productIds')).toBe('p1');
    expect(qs.get('variantIds')).toBeNull();
    expect(qs.get('connectionId')).toBe('conn_a');
  });

  it('expands and selects a single variant (tri-state some) and Continue carries variantIds', async () => {
    renderWithProviders(<OfferProductPickerModal isOpen onClose={vi.fn()} />, {
      apiClient: mocks([conn('conn_a', 'Allegro', 'allegro')]),
    });
    fireEvent.click(await screen.findByRole('button', { name: /expand product p1/i }));
    const variantCb = await screen.findByRole<HTMLInputElement>('checkbox', { name: /v1a/i });
    fireEvent.click(variantCb);

    const productCb = screen.getByLabelText<HTMLInputElement>('Select Product p1');
    expect(productCb.checked).toBe(false);
    expect(productCb.indeterminate).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    const qs = continueUrlParams();
    expect(qs.get('productIds')).toBe('p1');
    expect(qs.get('variantIds')).toBe('v1a');
    expect(qs.get('connectionId')).toBe('conn_a');
  });

  it('supports a mix across two products', async () => {
    renderWithProviders(<OfferProductPickerModal isOpen onClose={vi.fn()} />, {
      apiClient: mocks([conn('conn_a', 'Allegro', 'allegro')]),
    });
    // Whole p1.
    fireEvent.click(await screen.findByLabelText('Select Product p1'));
    // Single variant of p2.
    fireEvent.click(screen.getByRole('button', { name: /expand product p2/i }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /v2a/i }));

    expect(screen.getByText(/across.*2 products/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    const qs = continueUrlParams();
    expect(qs.get('productIds')).toBe('p1,p2');
    expect(qs.get('variantIds')).toBe('v2a');
    expect(qs.get('connectionId')).toBe('conn_a');
  });

  it('persists selection across a page change', async () => {
    renderWithProviders(<OfferProductPickerModal isOpen onClose={vi.fn()} />, {
      apiClient: mocks([conn('conn_a', 'Allegro', 'allegro')]),
    });
    fireEvent.click(await screen.findByLabelText('Select Product p1'));
    expect(screen.getByText(/1 item selected across.*1 product/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /next page of products/i }));
    // p1 is no longer rendered, but the selection total persists.
    expect(await screen.findByText('Product p11')).toBeInTheDocument();
    expect(screen.getByText(/1 item selected across.*1 product/i)).toBeInTheDocument();
  });

  it('auto-resolves the sole eligible connection (no picker shown)', async () => {
    renderWithProviders(<OfferProductPickerModal isOpen onClose={vi.fn()} />, {
      apiClient: mocks([conn('conn_a', 'Allegro', 'allegro')]),
    });
    await screen.findByText('Product p1');
    expect(screen.queryByLabelText(/marketplace connection/i)).not.toBeInTheDocument();
    // Selecting one product is enough to enable Continue (connection auto-resolved).
    fireEvent.click(screen.getByLabelText('Select Product p1'));
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('requires a connection pick when 2+ eligible connections exist', async () => {
    renderWithProviders(<OfferProductPickerModal isOpen onClose={vi.fn()} />, {
      apiClient: mocks([conn('conn_a', 'Allegro', 'allegro'), conn('conn_e', 'Erli', 'erli')]),
    });
    fireEvent.click(await screen.findByLabelText('Select Product p1'));
    const continueBtn = screen.getByRole('button', { name: /continue/i });
    expect(continueBtn).toBeDisabled();

    const select = screen.getByLabelText<HTMLSelectElement>(/marketplace connection/i);
    fireEvent.change(select, { target: { value: 'conn_e' } });
    expect(continueBtn).toBeEnabled();

    fireEvent.click(continueBtn);
    expect(continueUrlParams().get('connectionId')).toBe('conn_e');
  });

  it('disables Continue with no selection', async () => {
    renderWithProviders(<OfferProductPickerModal isOpen onClose={vi.fn()} />, {
      apiClient: mocks([conn('conn_a', 'Allegro', 'allegro')]),
    });
    await screen.findByText('Product p1');
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('shows a warning when no eligible connection exists', async () => {
    renderWithProviders(<OfferProductPickerModal isOpen onClose={vi.fn()} />, {
      apiClient: mocks([]),
    });
    expect(
      await screen.findByText(/no marketplace connections available/i),
    ).toBeInTheDocument();
  });
});
