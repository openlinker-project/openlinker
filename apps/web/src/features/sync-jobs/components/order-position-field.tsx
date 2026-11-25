/**
 * Order Position Field
 *
 * The "Read orders from" control of the manual order check (#4228 follow-up).
 * The position key used to be a free-text box nobody could fill in
 * meaningfully; it is now a choice. Continuing from the last check is the
 * default, the positions OpenLinker already saved for the connection come
 * next, and typing a key is the last option, revealed only when picked.
 *
 * Presentation only: the parent owns the chosen value and turns it into the
 * job's `cursorKey`.
 *
 * @module apps/web/src/features/sync-jobs/components
 */
import type { ReactElement } from 'react';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useCursorsQuery } from '../../cursors/hooks/use-cursors-query';
import { isOrderPositionKey } from '../lib/order-position';

export const ORDER_POSITION_DEFAULT = '';
export const ORDER_POSITION_CUSTOM = '__custom__';

interface OrderPositionFieldProps {
  connectionId: string;
  choice: string;
  onChoiceChange: (choice: string) => void;
  customKey: string;
  onCustomKeyChange: (key: string) => void;
  customError?: string;
  disabled: boolean;
}

export function OrderPositionField({
  connectionId,
  choice,
  onChoiceChange,
  customKey,
  onCustomKeyChange,
  customError,
  disabled,
}: OrderPositionFieldProps): ReactElement {
  const copy = useMessages('sync-jobs').triggerSyncDialog.orderPosition;
  const format = useFormat();
  const cursors = useCursorsQuery({ connectionId }, { limit: 200 });
  const saved = (cursors.data?.items ?? []).filter((item) => isOrderPositionKey(item.cursorKey));
  const onlySaved = saved.length === 1 ? saved[0] : null;
  const extraSaved = saved.length > 1 ? saved : [];

  const hint =
    choice === ORDER_POSITION_DEFAULT
      ? onlySaved
        ? interpolate(copy.positionDefaultHintSaved, {
            key: onlySaved.cursorKey,
            when: format.relativeTime(onlySaved.updatedAt),
          })
        : copy.positionDefaultHint
      : undefined;

  return (
    <div className="order-position">
      <FormField label={copy.positionLabel} name="orderPosition" description={hint}>
        <Select
          value={choice}
          onChange={(e) => onChoiceChange(e.target.value)}
          disabled={disabled}
        >
          <option value={ORDER_POSITION_DEFAULT}>{copy.positionDefault}</option>
          {extraSaved.map((item) => (
            <option key={item.cursorKey} value={item.cursorKey}>
              {interpolate(copy.positionSaved, {
                key: item.cursorKey,
                when: format.relativeTime(item.updatedAt),
              })}
            </option>
          ))}
          <option value={ORDER_POSITION_CUSTOM}>{copy.positionCustom}</option>
        </Select>
      </FormField>

      {choice === ORDER_POSITION_CUSTOM ? (
        <div className="order-position__custom">
          <FormField
            label={copy.customLabel}
            name="orderPositionKey"
            description={copy.customHelp}
            error={customError}
          >
            <Input
              value={customKey}
              onChange={(e) => onCustomKeyChange(e.target.value)}
              disabled={disabled}
              invalid={Boolean(customError)}
            />
          </FormField>
        </div>
      ) : null}
    </div>
  );
}
