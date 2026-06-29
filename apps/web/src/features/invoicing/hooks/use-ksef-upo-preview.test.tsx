/**
 * useKsefUpoPreview Tests (#1234)
 *
 * Covers the object-URL lifecycle + content-type allowlist logic:
 *   - PDF blob → kind 'pdf', objectUrl created
 *   - XML blob (application/xml + text/xml) → kind 'xml'
 *   - Unknown MIME → kind 'unsupported', no objectUrl created
 *   - Error path: open returns false and exposes error
 *   - Object URL revoked on close
 *   - Object URL revoked on unmount (no leak)
 */
import { act, renderHook } from '@testing-library/react';
import type { PropsWithChildren, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { useKsefUpoPreview } from './use-ksef-upo-preview';

function createWrapper(overrides: Partial<Parameters<typeof createMockApiClient>[0]>) {
  const client = createMockApiClient(overrides);
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return <ApiClientProvider client={client}>{children}</ApiClientProvider>;
  };
}

describe('useKsefUpoPreview', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn((blob: Blob) => `blob:mock-${blob.type}`);
    URL.revokeObjectURL = vi.fn();
  });

  // Restore originals after each test so stubs don't leak.
  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('creates an objectUrl for a PDF blob and reports kind=pdf', async () => {
    const pdfBlob = new Blob(['%PDF'], { type: 'application/pdf' });
    const downloadUpo = vi.fn().mockResolvedValue(pdfBlob);
    const wrapper = createWrapper({ invoicing: { downloadUpo } });

    const { result } = renderHook(() => useKsefUpoPreview(), { wrapper });
    let ok = false;
    await act(async () => {
      ok = await result.current.open('inv_1');
    });

    expect(ok).toBe(true);
    expect(downloadUpo).toHaveBeenCalledWith('inv_1');
    expect(URL.createObjectURL).toHaveBeenCalledWith(pdfBlob);
    expect(result.current.preview?.kind).toBe('pdf');
    expect(result.current.preview?.objectUrl).toMatch(/^blob:mock/);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('reports kind=xml for application/xml blobs', async () => {
    const xmlBlob = new Blob(['<xml/>'], { type: 'application/xml' });
    const downloadUpo = vi.fn().mockResolvedValue(xmlBlob);
    const wrapper = createWrapper({ invoicing: { downloadUpo } });

    const { result } = renderHook(() => useKsefUpoPreview(), { wrapper });
    await act(async () => { await result.current.open('inv_2'); });

    expect(result.current.preview?.kind).toBe('xml');
  });

  it('reports kind=xml for text/xml blobs', async () => {
    const xmlBlob = new Blob(['<xml/>'], { type: 'text/xml' });
    const downloadUpo = vi.fn().mockResolvedValue(xmlBlob);
    const wrapper = createWrapper({ invoicing: { downloadUpo } });

    const { result } = renderHook(() => useKsefUpoPreview(), { wrapper });
    await act(async () => { await result.current.open('inv_3'); });

    expect(result.current.preview?.kind).toBe('xml');
  });

  it('reports kind=unsupported and does NOT create an objectUrl for unknown MIME', async () => {
    const binBlob = new Blob(['data'], { type: 'application/octet-stream' });
    const downloadUpo = vi.fn().mockResolvedValue(binBlob);
    const wrapper = createWrapper({ invoicing: { downloadUpo } });

    const { result } = renderHook(() => useKsefUpoPreview(), { wrapper });
    await act(async () => { await result.current.open('inv_4'); });

    expect(result.current.preview?.kind).toBe('unsupported');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('returns false and exposes error when the fetch fails', async () => {
    const fetchError = new Error('network error');
    const downloadUpo = vi.fn().mockRejectedValue(fetchError);
    const wrapper = createWrapper({ invoicing: { downloadUpo } });

    const { result } = renderHook(() => useKsefUpoPreview(), { wrapper });
    let ok = true;
    await act(async () => { ok = await result.current.open('inv_5'); });

    expect(ok).toBe(false);
    expect(result.current.preview).toBeNull();
    expect(result.current.error?.message).toBe('network error');
  });

  it('revokes the objectUrl when close() is called', async () => {
    const pdfBlob = new Blob(['%PDF'], { type: 'application/pdf' });
    const downloadUpo = vi.fn().mockResolvedValue(pdfBlob);
    const wrapper = createWrapper({ invoicing: { downloadUpo } });

    const { result } = renderHook(() => useKsefUpoPreview(), { wrapper });
    await act(async () => { await result.current.open('inv_6'); });
    const createdUrl = result.current.preview?.objectUrl ?? '';

    act(() => { result.current.close(); });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(createdUrl);
    expect(result.current.preview).toBeNull();
  });

  it('revokes the objectUrl on unmount (no leak)', async () => {
    const pdfBlob = new Blob(['%PDF'], { type: 'application/pdf' });
    const downloadUpo = vi.fn().mockResolvedValue(pdfBlob);
    const wrapper = createWrapper({ invoicing: { downloadUpo } });

    const { result, unmount } = renderHook(() => useKsefUpoPreview(), { wrapper });
    await act(async () => { await result.current.open('inv_7'); });
    const createdUrl = result.current.preview?.objectUrl ?? '';

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(createdUrl);
  });
});
