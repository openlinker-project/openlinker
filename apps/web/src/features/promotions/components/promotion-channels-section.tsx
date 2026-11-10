/**
 * PromotionChannelsSection (#3935, mockups "Kanały")
 *
 * Where the promotion works: one row per sales channel with a checkbox, the
 * connection's name, what kind of channel it is and its platform chip. An empty
 * choice means every channel, which the card shows as all ticked; the form keeps
 * the explicit list only once the operator unticks one. A shop that also gives
 * gifts by itself gets one warning, because a customer could receive two.
 *
 * @module apps/web/src/features/promotions/components
 */
import { useMemo, type ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { ComposerSection } from '../../../shared/ui/composer-section';
import { useConnectionsQuery } from '../../connections';
import { channelMarker, coversNativeChannel, orderSourceChannels } from '../../gifts/lib/gift-channels';
import { PromotionChannelChip } from './promotion-channel-chip';
import type { PromotionSectionProps } from './promotion-section.types';

export function PromotionChannelsSection({
  form,
  values,
  readOnly,
  riseIndex,
  step,
}: PromotionSectionProps): ReactElement {
  const copy = useMessages('promotions').s.channels;
  const connections = useConnectionsQuery();
  const channels = useMemo(() => orderSourceChannels(connections.data ?? []), [connections.data]);
  const covered = values.channelIds.length === 0 ? channels.length : values.channelIds.length;

  const toggle = (id: string): void => {
    const current =
      values.channelIds.length === 0 ? channels.map((channel) => channel.id) : values.channelIds;
    const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
    // The last channel stays: an empty list means every channel, so unticking
    // it would read as the opposite of what the operator did.
    if (next.length === 0) return;
    form.setValue('channelIds', next.length === channels.length ? [] : next, { shouldDirty: true });
  };

  return (
    <ComposerSection
      step={step}
      title={copy.title}
      aside={channels.length > 0 ? interpolate(copy.aside, { n: String(covered), total: String(channels.length) }) : undefined}
      riseIndex={riseIndex}
      data-testid="promotion-channels-section"
    >
      <p className="form-field__description pm-tight">{copy.help}</p>
      <fieldset className="pm-fieldset" disabled={readOnly}>
        <div className={['form-field', ''].filter(Boolean).join(' ')}>
          <div className="pm-checks" data-testid="promotion-channels">
            {channels.map((channel) => {
              const checked = values.channelIds.length === 0 || values.channelIds.includes(channel.id);
              return (
                <label key={channel.id} className="pm-check" data-testid={`promotion-channel-${channel.id}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      toggle(channel.id);
                    }}
                  />
                  <span>
                    <span className="pm-check__n">{channel.name}</span>
                    <span className="pm-check__s">
                      {channelMarker(channel.platformType) === 'native' ? copy.kindShop : copy.kindMarket}
                    </span>
                  </span>
                  <span className="pm-chans">
                    <PromotionChannelChip connection={channel} />
                  </span>
                </label>
              );
            })}
          </div>
          <p className="pm-err">{copy.error}</p>
        </div>
      </fieldset>
      {coversNativeChannel(values.channelIds, channels) ? (
        <Alert tone="warning" density="compact" data-testid="promotion-double-gift-warning">
          {copy.doubleGift}
        </Alert>
      ) : null}
    </ComposerSection>
  );
}
