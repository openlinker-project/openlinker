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

export function PlatformPicker(): ReactElement {
  const plugins = usePlatforms();
  const cards = plugins
    .filter((p) => p.setupCard !== undefined)
    .map((p) => ({ platformType: p.platformType, ...p.setupCard! }));

  return (
    <div className="platform-picker">
      <ul className="platform-picker__list">
        {cards.map((card) => (
          <li key={card.platformType}>
            <Link to={card.to} className="platform-picker__card">
              <div className="platform-picker__card-header">
                <h3 className="platform-picker__card-title">{card.title}</h3>
                <span className="toolbar-chip">{card.badge}</span>
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
