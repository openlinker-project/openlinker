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
import { useMessages } from '../../../shared/i18n';

export function SessionRecordingBullets(): ReactElement {
  const copy = useMessages('demo').recording;
  return (
    <ul className="demo-consent__bullets">
      <li>{copy.pages}</li>
      <li>{copy.typing}</li>
      <li>{copy.browser}</li>
      <li>{copy.nothingReal}</li>
    </ul>
  );
}
