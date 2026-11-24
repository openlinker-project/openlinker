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
    // The app defaults to Polish; the labels below are English. Same key as the
    // fixtures use (`openlinker.locale`), set before the first paint.
    await this.page.addInitScript(() => {
      if (window.localStorage.getItem('openlinker.locale') === null) {
        window.localStorage.setItem('openlinker.locale', 'en');
      }
    });
    await this.page.goto('/login');
    await expect(this.page.getByRole('heading', { name: /^Sign in to\b/ })).toBeVisible();
  }

  async login(username: string, password: string): Promise<void> {
    await this.page.getByLabel('Username', { exact: true }).fill(username);
    await this.page.getByLabel('Password', { exact: true }).fill(password);
    await this.page.getByRole('button', { name: 'Sign in' }).click();
    // The SPA redirects away from /login on success.
    await this.page.waitForURL((url) => !url.pathname.startsWith('/login'), {
      timeout: 15_000,
    });
  }
}
