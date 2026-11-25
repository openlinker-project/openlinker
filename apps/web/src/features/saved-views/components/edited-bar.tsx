/**
 * EditedBar
 *
 * Appears the moment the list differs from the view it started from: a change
 * summary and Reset / Save as new / Save. On a built-in view (never editable)
 * it is just "Save as view…". On a phone it docks to the bottom of the screen.
 *
 * @module apps/web/src/features/saved-views/components
 */
import type { ReactElement } from 'react';
import { interpolate } from '../../../shared/i18n/interpolate';
import { useMessages } from '../../../shared/i18n/use-messages';
import { Button } from '../../../shared/ui/button';
import { useMediaQuery } from '../../../shared/ui/use-media-query';
import type { ViewChangeKind } from '../lib/saved-view.types';

export interface EditedBarProps {
  changes: ViewChangeKind[];
  /** The active view is a saved one (personal or shared), not a built-in. */
  isSavedView: boolean;
  /** The viewer may overwrite the active saved view. */
  canEdit: boolean;
  isSaving?: boolean;
  onReset: () => void;
  onSaveChanges: () => void;
  onSaveAsNew: () => void;
}

export function EditedBar(props: EditedBarProps): ReactElement {
  const copy = useMessages('saved-views').edited;
  const narrow = useMediaQuery('(max-width: 767px)');

  if (!props.isSavedView) {
    return (
      <Button tone="secondary" className="button--sm" style={{ marginLeft: 'auto' }} onClick={props.onSaveAsNew}>
        {copy.saveAsView}
      </Button>
    );
  }

  const summary = props.changes.map((kind) => copy.changes[kind]).join(', ');
  return (
    <div className={['sv-edited', narrow ? 'sv-edited--bar' : ''].filter(Boolean).join(' ')} role="group" aria-label={copy.group}>
      <span className="sv-edited__tag">
        <span className="sv-edited-dot" aria-hidden="true" />
        {interpolate(copy.tag, { changes: summary })}
      </span>
      <Button tone="ghost" className="button--sm" onClick={props.onReset}>
        {copy.reset}
      </Button>
      {props.canEdit ? (
        <button type="button" className="sv-reset sv-linkbtn" onClick={props.onSaveAsNew}>
          {copy.saveAsNew}
        </button>
      ) : null}
      {props.canEdit ? (
        <Button className="button--sm" onClick={props.onSaveChanges} disabled={props.isSaving}>
          {copy.saveChanges}
        </Button>
      ) : (
        <Button className="button--sm" onClick={props.onSaveAsNew}>
          {copy.saveAsMine}
        </Button>
      )}
    </div>
  );
}
