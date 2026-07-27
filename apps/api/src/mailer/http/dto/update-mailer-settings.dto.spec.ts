/**
 * Update Mailer Settings DTO — validation spec (#1765)
 *
 * Exercises the `FromAddressShapeConstraint` guard on `fromAddress`: the
 * backend is the actual trust boundary for this field (it flows unchanged
 * into `SmtpMailerAdapter.sendMail({ from })` → nodemailer), so this closes
 * the CRLF/header-injection gap left by validating only on the frontend.
 *
 * @module apps/api/src/mailer/http/dto
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { UpdateMailerSettingsDto } from './update-mailer-settings.dto';

function buildDto(fromAddress?: string | null): UpdateMailerSettingsDto {
  return plainToInstance(UpdateMailerSettingsDto, {
    transport: 'smtp',
    smtpSecure: true,
    fromAddress,
  });
}

async function expectFromAddressRejected(fromAddress: string): Promise<void> {
  const errors = await validate(buildDto(fromAddress));
  expect(errors).toHaveLength(1);
  expect(errors[0].property).toBe('fromAddress');
  expect(errors[0].constraints).toHaveProperty('fromAddressShape');
}

describe('UpdateMailerSettingsDto', () => {
  it('should pass validation when fromAddress is a bare email', async () => {
    const errors = await validate(buildDto('noreply@openlinker.io'));

    expect(errors).toHaveLength(0);
  });

  it('should pass validation when fromAddress is a "Display Name <email>" form', async () => {
    const errors = await validate(buildDto('OpenLinker <noreply@openlinker.io>'));

    expect(errors).toHaveLength(0);
  });

  it('should pass validation when fromAddress is omitted', async () => {
    const errors = await validate(buildDto(undefined));

    expect(errors).toHaveLength(0);
  });

  it('should pass validation when fromAddress is explicitly null', async () => {
    const errors = await validate(buildDto(null));

    expect(errors).toHaveLength(0);
  });

  it('should pass validation when fromAddress is an empty string', async () => {
    const errors = await validate(buildDto(''));

    expect(errors).toHaveLength(0);
  });

  it('should reject a display-name address carrying an embedded CRLF (header injection)', async () => {
    await expectFromAddressRejected('Foo\r\nBcc: attacker@evil.com <a@b.com>');
  });

  it('should reject a display-name address carrying an embedded bare LF (header injection)', async () => {
    await expectFromAddressRejected('Foo\nBcc: x@evil.com <a@b.com>');
  });

  it('should reject a malformed bare address', async () => {
    await expectFromAddressRejected('not-an-email');
  });

  it('should reject a display-name address with a malformed inner email', async () => {
    await expectFromAddressRejected('Name <not-an-email>');
  });

  it('should reject an address with two bracketed emails rather than silently picking one', async () => {
    await expectFromAddressRejected('A <b@example.com> <d@example.com>');
  });

  it('should reject an address with consecutive dots in the local-part', async () => {
    await expectFromAddressRejected('test..test@test.pl');
  });

  it('should reject a malformed address with a stray angle bracket swallowed into the local-part', async () => {
    await expectFromAddressRejected('Test <,<test@test.test>');
  });
});
