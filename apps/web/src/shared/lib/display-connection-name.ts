/**
 * Demo and sandbox connections are sometimes named with a creation timestamp
 * appended, e.g. "Allegro sandbox (2026-11-21T23:23:24.209Z)". The suffix is
 * noise in a headline; the full name stays available for a title attribute.
 */
const ISO_SUFFIX = /\s*\(\s*\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s*\)\s*$/;

export function displayConnectionName(name: string): string {
  const cleaned = name.replace(ISO_SUFFIX, '').trim();
  return cleaned.length > 0 ? cleaned : name;
}
