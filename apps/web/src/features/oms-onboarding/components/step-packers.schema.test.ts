/**
 * Add-a-packer form schema - validation messages follow the active language
 * (#4017). The schema reads each message when a value is validated, not when
 * the module loads, so switching the language after import still changes it.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadMessages } from '../../../shared/i18n';
// The non-React setter the LocaleProvider uses; the barrel exposes no setter.
import { setActiveLocale } from '../../../shared/i18n/active-locale';
import { addPackerFormSchema } from './step-packers.schema';

function messagesFor(values: { displayName: string; username: string; email: string }): string[] {
  const result = addPackerFormSchema.safeParse(values);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('addPackerFormSchema', () => {
  beforeAll(async () => {
    await loadMessages('pl');
  });

  afterEach(() => {
    setActiveLocale('en');
  });

  it('should answer in English when English is active', () => {
    expect(messagesFor({ displayName: '', username: 'a@b', email: 'nope' })).toEqual([
      'Enter a name.',
      'A login cannot contain "@".',
      'Enter a valid email address, or leave it empty.',
    ]);
  });

  it('should answer in Polish when the language is switched after the schema loaded', () => {
    setActiveLocale('pl');

    expect(messagesFor({ displayName: '', username: '', email: '' })).toEqual([
      'Wpisz imię i nazwisko.',
      'Wpisz login.',
    ]);
    expect(messagesFor({ displayName: 'Anna', username: 'a@b', email: 'nope' })).toEqual([
      'Login nie może zawierać znaku "@".',
      'Wpisz poprawny adres e-mail albo zostaw pole puste.',
    ]);
  });
});
