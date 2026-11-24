/**
 * Platform Picker
 *
 * Step 1 of the connection setup flow. Renders one card per registered
 * platform plugin that exposes a `setupCard`. Cards are sourced from the
 * plugin registry (`shared/plugins`) — adding a new platform plugin is
 * the single edit point; this component picks it up automatically.
 */
import { renderRich, useMessages } from '../../../shared/i18n';
import type { ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePlatforms } from '../../../shared/plugins';
import { useConnectionsQuery } from '../hooks/use-connections-query';
import { captureDemoEvent } from '../../demo';
import { isFromOmsSetup, withOmsSetupReturn } from '../lib/oms-setup-return';

export function PlatformPicker(): ReactElement {
  const copy = useMessages('connections').platformPicker;
  const plugins = usePlatforms();
  const connectionsQuery = useConnectionsQuery();
  // An operator sent here by the OMS setup keeps the way back through the
  // platform's wizard to the connection it creates (#3958).
  const [searchParams] = useSearchParams();
  const fromOmsSetup = isFromOmsSetup(searchParams);
  // A featured platform (the OMS) is a single setup, not one card per
  // account: once its connection exists the card says so and leads to it.
  const configuredTypes = new Set((connectionsQuery.data ?? []).map((c) => c.platformType));
  const cards = plugins
    .filter(
      (p) =>
        p.setupCard !== undefined &&
        (p.hideFromCreateConnection !== true || p.setupCard.featured === true)
    )
    .map((p) => ({ platformType: p.platformType, ...p.setupCard! }))
    // Stable: featured cards first, every other card keeps its registry order.
    .sort((a, b) => Number(b.featured === true) - Number(a.featured === true));

  return (
    <div className="platform-picker">
      <ul className="platform-picker__list">
        {cards.map((card) => (
          <li key={card.platformType}>
            <Link
              to={withOmsSetupReturn(card.to, fromOmsSetup)}
              className={
                card.featured === true
                  ? 'platform-picker__card platform-picker__card--featured'
                  : 'platform-picker__card'
              }
              onClick={() =>
                captureDemoEvent('demo_connection_platform_selected', {
                  platformType: card.platformType,
                })
              }
            >
              <div className="platform-picker__card-header">
                <h3 className="platform-picker__card-title">{card.title}</h3>
                <span className={card.featured === true ? 'toolbar-chip toolbar-chip--accent' : 'toolbar-chip'}>
                  {card.badge}
                </span>
              </div>
              <p className="platform-picker__card-description">{card.description}</p>
              <span className="platform-picker__card-cta" aria-hidden="true">
                {card.featured === true && configuredTypes.has(card.platformType)
                  ? copy.alreadySetUp
                  : copy.continue}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="platform-picker__advanced">
        {renderRich(copy.advanced, {
          link: (text) => <Link to="/connections/new/advanced">{text}</Link>,
        })}
      </p>
    </div>
  );
}
