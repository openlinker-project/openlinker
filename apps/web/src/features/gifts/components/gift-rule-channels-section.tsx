/**
 * GiftRuleChannelsSection (#3935, mockup `gifts-rule-detail` "Kanały")
 *
 * Where the promotion works. An empty selection means every channel. A channel
 * whose shop may also give gifts itself carries a marker, and a warning appears
 * while the promotion covers one, because a double gift is possible there.
 *
 * @module apps/web/src/features/gifts/components
 */
import { useMemo, type ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { DetailSection } from '../../../shared/ui/detail-section';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useConnectionsQuery } from '../../connections';
import { channelMarker, coversNativeChannel, orderSourceChannels } from '../lib/gift-channels';
import type { GiftRuleSectionProps } from './gift-rule-section.types';

export function GiftRuleChannelsSection({ form, values, readOnly }: GiftRuleSectionProps): ReactElement {
  const copy = useMessages('gifts');
  const connections = useConnectionsQuery();
  const channels = useMemo(() => orderSourceChannels(connections.data ?? []), [connections.data]);
  const covered = values.channelIds.length === 0 ? channels.length : values.channelIds.length;

  const toggle = (id: string): void => {
    if (values.channelIds.length === 0) {
      form.setValue(
        'channelIds',
        channels.map((c) => c.id).filter((channelId) => channelId !== id),
      );
      return;
    }
    const current = values.channelIds;
    form.setValue('channelIds', current.includes(id) ? current.filter((c) => c !== id) : [...current, id]);
  };

  return (
    <DetailSection
      title={copy.composer.channels}
      titleAside={
        channels.length > 0 ? (
          <span className="text-muted">
            {interpolate(copy.detail.channelsCount, { n: String(covered), total: String(channels.length) })}
          </span>
        ) : undefined
      }
    >
      <fieldset className="gift-section" disabled={readOnly} data-testid="gift-composer-channels">
        <p className="text-muted">{copy.composer.channelsHelp}</p>
        {channels.map((channel) => {
          const marker = channelMarker(channel.platformType);
          const checked = values.channelIds.length === 0 || values.channelIds.includes(channel.id);
          return (
            <label key={channel.id} className="filter-check" data-testid={`gift-composer-channel-${channel.id}`}>
              <input type="checkbox" checked={checked} onChange={() => toggle(channel.id)} />
              <span className="filter-check__label">{channel.name}</span>
              <StatusBadge
                tone={marker === 'native' ? 'info' : 'neutral'}
                compact
                data-testid={`gift-composer-channel-marker-${channel.id}`}
              >
                {marker === 'native' ? copy.composer.markerNative : copy.composer.markerOpenLinker}
              </StatusBadge>
            </label>
          );
        })}
        {coversNativeChannel(values.channelIds, channels) ? (
          <Alert tone="warning" density="compact" data-testid="gift-composer-prestashop-warning">
            {copy.composer.doubleGiftWarning}
          </Alert>
        ) : null}
      </fieldset>
    </DetailSection>
  );
}
