/**
 * Login page object
 *
 * Drives the guest `/login` form. Used by the auth setup project to establish a
 * browser session; specs themselves receive an already-authenticated page.
 *
 * @module pages
 */
import { expect, type Page } from '@playwright/test';

export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/login');
    // The demo build titles the form "Sign in to the demo" and carries a second, hidden sign-up form, so the
    // visible username field is the one thing both builds share.
    await expect(this.page.locator('input[name="username"]:visible').first()).toBeVisible();
  }

  async login(username: string, password: string): Promise<void> {
    await this.page.locator('input[name="username"]:visible').first().fill(username);
    await this.page.locator('input[type="password"]:visible').first().fill(password);
    await this.page.keyboard.press('Enter');
    // The SPA redirects away from /login on success.
    await this.page.waitForURL((url) => !url.pathname.startsWith('/login'), {
      timeout: 15_000,
    });
  }
}
