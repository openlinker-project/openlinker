/**
 * Platform Picker
 *
 * Step 1 of the connection setup flow. Renders one card per registered
 * platform plugin that exposes a `setupCard`. Cards are sourced from the
 * plugin registry (`shared/plugins`) — adding a new platform plugin is
 * the single edit point; this component picks it up automatically.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { usePlatforms } from '../../../shared/plugins';
import { captureDemoEvent } from '../../demo';

export function PlatformPicker(): ReactElement {
  const plugins = usePlatforms();
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
              to={card.to}
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
                Continue →
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="platform-picker__advanced">
        Need to configure a raw adapter key or bespoke config JSON?{' '}
        <Link to="/connections/new/advanced">Use advanced mode</Link>.
      </p>
    </div>
  );
}
