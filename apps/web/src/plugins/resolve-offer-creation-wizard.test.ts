/**
 * resolveOfferCreationWizard — unit spec
 *
 * Covers the pure resolver: match, no-match, and first-match-wins when
 * multiple plugins contribute for the same `platformType` (#608).
 */
import { describe, expect, it } from 'vitest';
import type { ComponentType } from 'react';

import type {
  OfferCreationWizardProps,
  OpenLinkerPlugin,
} from '../shared/plugins';

import { resolveOfferCreationWizard } from './resolve-offer-creation-wizard';

const dummyComponent: ComponentType<OfferCreationWizardProps> = () => null;

function plugin(id: string, platformType?: string): OpenLinkerPlugin {
  if (platformType === undefined) {
    return { id };
  }
  return {
    id,
    build: {
      offerCreationWizard: { platformType, component: dummyComponent },
    },
  };
}

describe('resolveOfferCreationWizard', () => {
  it('returns null when the plugin list is empty', () => {
    expect(resolveOfferCreationWizard([], 'allegro')).toBeNull();
  });

  it('returns null when no plugin contributes for the requested platform', () => {
    const plugins = [plugin('prestashop', 'prestashop'), plugin('docs-only')];
    expect(resolveOfferCreationWizard(plugins, 'allegro')).toBeNull();
  });

  it('returns the matching contribution by platformType', () => {
    const plugins = [plugin('allegro', 'allegro'), plugin('prestashop', 'prestashop')];
    const resolved = resolveOfferCreationWizard(plugins, 'allegro');
    expect(resolved).not.toBeNull();
    expect(resolved?.platformType).toBe('allegro');
    expect(resolved?.component).toBe(dummyComponent);
  });

  it('ignores plugins that do not contribute an offerCreationWizard', () => {
    const plugins = [plugin('no-wizard'), plugin('allegro', 'allegro')];
    expect(resolveOfferCreationWizard(plugins, 'allegro')?.platformType).toBe('allegro');
  });

  it('returns the first match when multiple plugins contribute for the same platformType', () => {
    const firstComponent: ComponentType<OfferCreationWizardProps> = () => null;
    const secondComponent: ComponentType<OfferCreationWizardProps> = () => null;
    const plugins: OpenLinkerPlugin[] = [
      {
        id: 'first',
        build: { offerCreationWizard: { platformType: 'allegro', component: firstComponent } },
      },
      {
        id: 'second',
        build: { offerCreationWizard: { platformType: 'allegro', component: secondComponent } },
      },
    ];
    expect(resolveOfferCreationWizard(plugins, 'allegro')?.component).toBe(firstComponent);
  });
});
