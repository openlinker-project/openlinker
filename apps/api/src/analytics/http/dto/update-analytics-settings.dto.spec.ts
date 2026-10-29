/**
 * Update Analytics Settings DTO - validation spec (#3588)
 *
 * `trackMargin` is optional on the full-PUT body: absent must validate (and
 * keep the stored value downstream), a non-boolean must be refused.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateAnalyticsSettingsDto } from './update-analytics-settings.dto';

const base = {
  displayCurrency: null,
  rateBasis: 'current',
  includeBackfilledTaxRatesInNetSales: false,
  netGrossBasis: 'gross',
};

describe('UpdateAnalyticsSettingsDto trackMargin', () => {
  it('should validate when trackMargin is absent', async () => {
    const errors = await validate(plainToInstance(UpdateAnalyticsSettingsDto, base));
    expect(errors).toHaveLength(0);
  });

  it.each([true, false])('should accept trackMargin=%s', async (value) => {
    const errors = await validate(
      plainToInstance(UpdateAnalyticsSettingsDto, { ...base, trackMargin: value })
    );
    expect(errors).toHaveLength(0);
  });

  it('should reject a non-boolean trackMargin', async () => {
    const errors = await validate(
      plainToInstance(UpdateAnalyticsSettingsDto, { ...base, trackMargin: 'yes' })
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('trackMargin');
  });
});
