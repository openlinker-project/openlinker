import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FileUpload } from './file-upload';

describe('FileUpload', () => {
  afterEach(cleanup);

  function makeFile(
    { name = 'safety.pdf', size = 1024, type = 'application/pdf' } = {},
  ): File {
    const blob = new Blob([new Uint8Array(size)], { type });
    return new File([blob], name, { type });
  }

  it('renders the dropzone label and hint when not busy', () => {
    render(<FileUpload accept="application/pdf" maxBytes={1024 * 1024} onFileSelected={vi.fn()} />);

    expect(screen.getByText(/drop a file here/i)).toBeInTheDocument();
    expect(screen.getByText(/accepted: application\/pdf/i)).toBeInTheDocument();
  });

  it('calls onFileSelected when a valid file is picked', async () => {
    const onFileSelected = vi.fn();
    render(
      <FileUpload accept="application/pdf" maxBytes={1024 * 1024} onFileSelected={onFileSelected} />,
    );

    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile({ size: 100 })] } });

    expect(onFileSelected).toHaveBeenCalledTimes(1);
    expect(onFileSelected.mock.calls[0]?.[0]).toBeInstanceOf(File);
  });

  it('rejects files larger than maxBytes via onError, never calling onFileSelected', () => {
    const onFileSelected = vi.fn();
    const onError = vi.fn();
    render(
      <FileUpload
        accept="application/pdf"
        maxBytes={500}
        onFileSelected={onFileSelected}
        onError={onError}
      />,
    );

    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile({ size: 1000 })] } });

    expect(onFileSelected).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatch(/too large/i);
  });

  it('disables interaction while busy', () => {
    render(
      <FileUpload accept="application/pdf" maxBytes={1024} onFileSelected={vi.fn()} busy />,
    );

    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.getByText(/uploading/i)).toBeInTheDocument();
  });

  it('forwards ref to the underlying file input', () => {
    const ref = { current: null as HTMLInputElement | null };
    render(
      <FileUpload accept="application/pdf" maxBytes={1024} onFileSelected={vi.fn()} ref={ref} />,
    );
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('shows the override hint when provided', () => {
    render(
      <FileUpload
        accept="application/pdf"
        maxBytes={1024}
        onFileSelected={vi.fn()}
        hint="Reached max of 20 attachments."
      />,
    );
    expect(screen.getByText(/reached max of 20/i)).toBeInTheDocument();
  });

  it('rejects drops with a mismatched MIME type', () => {
    const onFileSelected = vi.fn();
    const onError = vi.fn();
    render(
      <FileUpload
        accept="application/pdf"
        maxBytes={1024 * 1024}
        onFileSelected={onFileSelected}
        onError={onError}
      />,
    );

    const dropzone = document.querySelector('label.file-upload') as HTMLLabelElement;
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [makeFile({ type: 'image/jpeg', name: 'img.jpg' })],
      },
    });

    expect(onFileSelected).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatch(/not accepted/i);
  });
});
