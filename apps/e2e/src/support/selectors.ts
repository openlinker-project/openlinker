/**
 * Selector helpers
 *
 * Small utilities for driving the app's semantic controls. The shared `Select`
 * primitive renders a native `<select>`, but option labels often embed extra
 * context (e.g. `{name} ({platformType})`), so callers usually know a substring,
 * not the exact label. `selectOptionByText` resolves the matching option's value
 * and selects it.
 *
 * @module support
 */
import { type Locator } from '@playwright/test';

/**
 * Select the first `<option>` in a native select whose visible text contains
 * `text`. Throws if no option matches.
 */
export async function selectOptionByText(select: Locator, text: string): Promise<void> {
  const option = select.locator('option', { hasText: text }).first();
  const value = await option.getAttribute('value');
  if (value === null) {
    throw new Error(`No option containing "${text}" found in select`);
  }
  await select.selectOption(value);
}
