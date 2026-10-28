/**
 * Fiscal Failure Details (#3843)
 *
 * The identifiers of a provider's refusal, rendered INSIDE the failure alert
 * under its sentence: the provider's error code, the device's code, the
 * provider's document id, plus OpenLinker's explanation when the adapter
 * recognised the answer exactly. They go under the sentence, not into it, so
 * the sentence stays short and the identifiers stay copyable one by one.
 *
 * Renders nothing when the record carries no details - every record written
 * before the field existed, and every provider that declares none.
 *
 * Callers gate it on `orders:write`: the identifiers are for someone who acts on
 * the order or talks to the provider's support, and a read-only role gets the
 * failure sentence alone.
 *
 * @module features/fiscalization/components
 */
import { useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { useTranslation } from '../../../shared/i18n';
import type { FiscalProviderFailureDetails } from '../api/fiscalization.types';
import {
  buildFiscalFailureDetailRows,
  buildFiscalFailureSupportText,
} from '../lib/fiscal-failure-details';

interface FiscalFailureDetailsProps {
  details: FiscalProviderFailureDetails | null;
}

export function FiscalFailureDetails({ details }: FiscalFailureDetailsProps): ReactElement | null {
  const { t } = useTranslation();
  const rows = buildFiscalFailureDetailRows(details, t);
  const hint = details?.hint ?? null;
  if (rows.length === 0 && !hint) return null;

  return (
    <div className="fiscal-failure-details" data-testid="fiscal-failure-details">
      {hint ? <p className="fiscal-failure-details__hint">{hint}</p> : null}
      {rows.length > 0 ? (
        <dl className="fiscal-failure-details__list">
          {rows.map((row) => (
            <div className="fiscal-failure-details__row" key={row.key}>
              <dt>{row.label}</dt>
              <dd>
                <CopyableId
                  id={row.value}
                  copyLabel={t('fiscalReceipt.details.copyOne', 'Copy {label}').replace(
                    '{label}',
                    row.label,
                  )}
                />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/**
 * Puts every identifier on the clipboard as plain `label: value` lines. Renders
 * nothing when there is nothing to copy.
 */
export function CopyFiscalFailureDetailsButton({
  details,
}: FiscalFailureDetailsProps): ReactElement | null {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const rows = buildFiscalFailureDetailRows(details, t);
  if (rows.length === 0) return null;

  const handleCopy = (): void => {
    void navigator.clipboard
      ?.writeText(buildFiscalFailureSupportText(rows))
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  return (
    <Button tone="secondary" onClick={handleCopy}>
      {copied
        ? t('fiscalReceipt.details.copied', 'Copied')
        : t('fiscalReceipt.details.copyAll', 'Copy details')}
    </Button>
  );
}
