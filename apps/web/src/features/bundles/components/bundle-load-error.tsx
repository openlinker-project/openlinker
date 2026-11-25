/**
 * Bundle load error (#3624)
 *
 * One answer for every "the bundle could not be loaded" place: says what
 * happened, offers a retry and a way back, instead of a dead sentence.
 *
 * @module apps/web/src/features/bundles/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';

export interface BundleLoadErrorProps {
  onRetry: () => void;
  testId?: string;
}

export function BundleLoadError({ onRetry, testId }: BundleLoadErrorProps): ReactElement {
  const copy = useMessages('bundles').form;
  return (
    <Alert tone="error" title={copy.loadFailedTitle} data-testid={testId}>
      <p>{copy.loadFailedBody}</p>
      <div className="bf-loaderror__actions">
        <Button tone="secondary" className="button--sm" onClick={onRetry}>
          {copy.retry}
        </Button>
        <Link className="button button--secondary button--sm" to="/products?bundles=only">
          {copy.backToListShort}
        </Link>
      </div>
    </Alert>
  );
}
