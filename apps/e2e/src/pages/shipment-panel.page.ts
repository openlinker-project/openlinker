/**
 * Shipment panel page object (order detail)
 *
 * Covers the "Shipment" section on `/orders/:id` — empty state + "Generate
 * label" action. Consumed by the follow-up InPost segment (S6).
 *
 * @module pages
 */
import { type Locator, type Page } from '@playwright/test';

export class ShipmentPanel {
  constructor(private readonly page: Page) {}

  get section(): Locator {
    return this.page.getByRole('heading', { name: 'Shipment' });
  }

  get generateLabelButton(): Locator {
    return this.page.getByRole('button', { name: 'Generate label' });
  }
}
