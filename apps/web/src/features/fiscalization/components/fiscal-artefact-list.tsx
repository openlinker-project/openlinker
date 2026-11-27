/**
 * Fiscal Artefact List (#1909)
 *
 * Renders the neutral `medium`/`disposition` artefact pairs a registration
 * returned. An empty or absent list on a `registered` record is a SUCCESS
 * state (ADR-042 dec. 2 — a pure reporting regime returns identifiers only),
 * never rendered as missing or broken.
 *
 * `medium` drives the action, `disposition` is a hint only: core neither
 * renders nor delivers, so this component reads `medium` to decide HOW to
 * present the artefact (open a link, offer a download, show a QR image) and
 * never branches on `disposition` for behaviour.
 *
 * @module apps/web/src/features/fiscalization/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import type { FiscalArtefact } from '../api/fiscalization.types';

interface FiscalArtefactListProps {
  artefacts: FiscalArtefact[];
}

function download(artefact: FiscalArtefact): void {
  const isDataLike = /^https?:\/\//i.test(artefact.content);
  const href = isDataLike
    ? artefact.content
    : `data:${artefact.contentType ?? 'application/octet-stream'};base64,${artefact.content}`;
  const link = document.createElement('a');
  link.href = href;
  link.download = artefact.label ?? 'receipt';
  link.rel = 'noopener noreferrer';
  link.click();
}

export function FiscalArtefactList({ artefacts }: FiscalArtefactListProps): ReactElement | null {
  const copy = useMessages('fiscalization').fiscalReceipt.artefact;

  if (artefacts.length === 0) {
    return null;
  }

  return (
    <ul className="artefact-list">
      {artefacts.map((artefact, index) => (
        <li className="artefact-row" key={`${artefact.medium}-${index}`}>
          <span className="artefact-row__medium">
            {copy.medium[artefact.medium] ?? artefact.medium}
          </span>
          <span className="artefact-row__body">
            <span className="artefact-row__title">
              {artefact.label ?? copy.medium[artefact.medium] ?? artefact.medium}
            </span>
          </span>
          <span className="artefact-row__action">
            {artefact.medium === 'link' ? (
              <a
                href={artefact.content}
                target="_blank"
                rel="noopener noreferrer"
                className="button button--secondary button--sm"
              >
                {copy.open}
              </a>
            ) : null}
            {artefact.medium === 'document' ? (
              <Button
                tone="secondary"
                className="button--sm"
                onClick={() => download(artefact)}
              >
                {copy.download}
              </Button>
            ) : null}
            {artefact.medium === 'code' ? (
              <img
                src={`data:${artefact.contentType ?? 'image/png'};base64,${artefact.content}`}
                alt={copy.codeAlt}
                width={64}
                height={64}
              />
            ) : null}
            {artefact.medium === 'text' || artefact.medium === 'markup' ? (
              <span className="text-muted">
                {copy.internal}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
