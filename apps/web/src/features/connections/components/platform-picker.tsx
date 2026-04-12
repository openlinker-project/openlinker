/**
 * Platform Picker
 *
 * Step 1 of the connection setup flow. Renders one card per supported
 * platform and links to that platform's guided wizard route. The
 * metadata table is indexed by PlatformType so the compiler fails if a
 * new platform type is added to PLATFORM_TYPES without a corresponding
 * card entry.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { PLATFORM_TYPES, type PlatformType } from '../api/connections.types';

interface PlatformCard {
  title: string;
  description: string;
  to: string;
  badge: string;
}

const PLATFORM_CARDS: Record<PlatformType, PlatformCard> = {
  prestashop: {
    title: 'PrestaShop',
    description:
      'Connect a PrestaShop store via the Webservice API. You will need the shop URL and a webservice key.',
    to: '/connections/new/prestashop',
    badge: 'Webservice API',
  },
  allegro: {
    title: 'Allegro',
    description:
      'Connect an Allegro seller account. Authorization uses OAuth 2.0 — no manual token paste.',
    to: '/connections/new/allegro',
    badge: 'OAuth 2.0',
  },
};

export function PlatformPicker(): ReactElement {
  return (
    <div className="platform-picker">
      <ul className="platform-picker__list">
        {PLATFORM_TYPES.map((platformType) => {
          const card = PLATFORM_CARDS[platformType];
          return (
            <li key={platformType}>
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
          );
        })}
      </ul>
      <p className="platform-picker__advanced">
        Need to configure a raw adapter key or bespoke config JSON?{' '}
        <Link to="/connections/new/advanced">Use advanced mode</Link>.
      </p>
    </div>
  );
}
