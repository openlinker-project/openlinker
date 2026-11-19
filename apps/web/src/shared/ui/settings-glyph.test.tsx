import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SETTINGS_GLYPH_NAMES, SettingsGlyph } from './settings-glyph';

afterEach(cleanup);

describe('SettingsGlyph', () => {
  it.each(SETTINGS_GLYPH_NAMES)('should draw %s on the shared grid with the accent node', (name) => {
    const { container } = render(<SettingsGlyph name={name} />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('stroke-width', '1.5');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg?.querySelector('title')).toBeNull();
    // The family rule: one filled node, docked at the same corner on every glyph.
    const node = svg?.querySelectorAll('.settings-glyph__node');
    expect(node).toHaveLength(1);
    expect(node?.[0]).toHaveAttribute('cx', '17.5');
    expect(node?.[0]).toHaveAttribute('cy', '6.5');
  });

  it('should list every glyph once', () => {
    expect(new Set(SETTINGS_GLYPH_NAMES).size).toBe(SETTINGS_GLYPH_NAMES.length);
  });
});
