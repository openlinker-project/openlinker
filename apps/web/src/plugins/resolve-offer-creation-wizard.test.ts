/**
 * resolveOfferCreationWizard — unit spec
 *
 * Covers the pure resolver: match, no-match, and first-match-wins when
 * multiple plugins contribute for the same `platformType` (#608).
 */
import { describe, expect, it } from 'vitest';
import type { ComponentType } from 'react';

import { resolveOfferCreationWizard } from './resolve-offer-creation-wizard';
import type { OfferCreationWizardProps, WebPlugin } from './plugin.types';

const dummyComponent: ComponentType<OfferCreationWizardProps> = () => null;

function plugin(id: string, platformType?: string): WebPlugin {
  if (platformType === undefined) {
    return { id };
  }
  return {
    id,
    offerCreationWizard: { platformType, component: dummyComponent },
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
    const plugins: WebPlugin[] = [
      { id: 'first', offerCreationWizard: { platformType: 'allegro', component: firstComponent } },
      { id: 'second', offerCreationWizard: { platformType: 'allegro', component: secondComponent } },
    ];
    expect(resolveOfferCreationWizard(plugins, 'allegro')?.component).toBe(firstComponent);
  });
});
