/**
 * Session Recording Bullets
 *
 * The plain-language list of what a demo session records. Shared by the two
 * places consent is asked for — the registration disclosure and the `/consent`
 * page (#1938) — so the disclosure cannot drift between them.
 *
 * Keep it in step with the masking config in `lib/init-demo-integrations.ts`:
 * masking covers passwords only (#1877), so anything claiming more would be
 * false.
 *
 * @module features/demo/components
 */
import type { ReactElement } from 'react';

export function SessionRecordingBullets(): ReactElement {
  return (
    <ul className="demo-consent__bullets">
      <li>Pages you open and buttons you click</li>
      <li>Text you type, except passwords</li>
      <li>Your browser, screen size, and rough location from your IP</li>
      <li>Nothing real. Every store, order, and invoice in the demo is made up.</li>
    </ul>
  );
}
