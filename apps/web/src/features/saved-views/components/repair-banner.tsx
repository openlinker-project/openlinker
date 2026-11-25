/**
 * RepairBanner
 *
 * A saved view that references something that no longer exists still loads: the
 * missing items are skipped and listed here, with the choice to remove them for
 * good (editable views) or to keep a corrected copy (read-only ones).
 *
 * @module apps/web/src/features/saved-views/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n/use-messages';
import { Button } from '../../../shared/ui/button';
import { ViewIcon } from './view-icons';

export interface RepairBannerProps {
  /** One line per issue, already worded for the operator. */
  issues: string[];
  canEdit: boolean;
  onFix: () => void;
  onSaveAsMine: () => void;
  onDismiss: () => void;
}

export function RepairBanner(props: RepairBannerProps): ReactElement {
  const copy = useMessages('saved-views').repair;
  return (
    <div className="sv-repair" role="alert">
      <span className="sv-repair__icon">
        <ViewIcon name="warn" />
      </span>
      <div className="sv-repair__body">
        <b>{copy.title}</b> {copy.body}
        <ul>
          {props.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      </div>
      <div className="sv-repair__actions">
        {props.canEdit ? (
          <Button className="button--sm" onClick={props.onFix}>
            {copy.fix}
          </Button>
        ) : (
          <Button className="button--sm" onClick={props.onSaveAsMine}>
            {copy.saveAsMine}
          </Button>
        )}
        <Button tone="secondary" className="button--sm" onClick={props.onDismiss}>
          {copy.dismiss}
        </Button>
      </div>
    </div>
  );
}
