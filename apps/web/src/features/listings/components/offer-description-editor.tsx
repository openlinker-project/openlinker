/**
 * OfferDescriptionEditor
 *
 * The description field of the edit-offer drawer. A thin binding between React
 * Hook Form and the shared `RichTextEditor`, which derives its toolbar and
 * schema from the destination's declared `DescriptionFormat` (ADR-046).
 *
 * Before this it was a bare `<textarea>` with a note saying "Only text content
 * is supported for editing here" - which was never the operator's problem to
 * carry: the destination's own contract now decides what can be authored, and the
 * offer's connection is what selects it.
 *
 * @module apps/web/src/features/listings/components
 */
import type { ReactElement } from 'react';

import { RichTextEditor } from '../../../shared/ui';
import { useDescriptionFormatQuery } from '../hooks/use-description-format-query';
import { OFFER_DESCRIPTION_FALLBACK_FORMAT } from './offer-description-editor.constants';

interface OfferDescriptionEditorProps {
  /** The offer's connection - selects whose contract the editor is built from. */
  connectionId: string;
  value: string;
  onChange: (html: string) => void;
  error?: string;
  disabled?: boolean;
  id?: string;
}

export function OfferDescriptionEditor({
  connectionId,
  value,
  onChange,
  error,
  disabled = false,
  id,
}: OfferDescriptionEditorProps): ReactElement {
  const formatQuery = useDescriptionFormatQuery(connectionId);
  // Narrow while the contract loads, for the same reason the content tab does it:
  // a control appearing a moment late beats one that lets an operator author a
  // tag this marketplace then discards. The endpoint never errors.
  const format = formatQuery.data ?? OFFER_DESCRIPTION_FALLBACK_FORMAT;

  return (
    <div className="offer-description-editor">
      <RichTextEditor
        id={id}
        format={format}
        value={value}
        onChange={onChange}
        disabled={disabled}
        aria-label="Offer description"
      />
      {error !== undefined ? (
        <p id="description-error" className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
