/**
 * OfferDescriptionEditor
 *
 * Simple text editor for Allegro offer descriptions. Allegro uses a structured
 * section format; for MVP only a single text section is supported.
 *
 * @module apps/web/src/features/listings/components
 */
import type { ReactElement } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';

interface OfferDescriptionEditorProps {
  registration: UseFormRegisterReturn;
  error?: string;
  id?: string;
}

export function OfferDescriptionEditor({
  registration,
  error,
  id,
}: OfferDescriptionEditorProps): ReactElement {
  return (
    <div className="offer-description-editor">
      <textarea
        id={id}
        {...registration}
        className={['offer-description-editor__textarea', error ? 'input--error' : ''].filter(Boolean).join(' ')}
        rows={6}
        aria-invalid={error !== undefined}
        aria-describedby={error ? 'description-error description-note' : 'description-note'}
      />
      {error ? (
        <p id="description-error" className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <p id="description-note" className="offer-description-editor__note">
        Allegro formats description as structured sections. Only text content is supported for editing here.
      </p>
    </div>
  );
}
