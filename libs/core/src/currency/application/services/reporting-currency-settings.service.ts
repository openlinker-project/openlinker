/**
 * Reporting Currency Settings Service
 *
 * Resolves the system-level reporting currency `settings row -> env -> default`
 * and owns the save-time validation. Shaped after
 * `AiProviderActiveSettingsService`, down to the read-through model: no
 * in-process cache, because the read is a singleton-row primary-key lookup and
 * a cache would need an invalidator port pointing back at whichever module
 * writes it.
 *
 * SAVE-TIME VALIDATION IS THREE LAYERS AND ZERO HTTP:
 *
 *  1. Shape - `trim().toUpperCase()` then `/^[A-Z]{3}$/`. Fails with
 *     `InvalidReportingCurrencyError`, which the controller maps to 400.
 *  2. Reachability - membership of `SUPPORTED_REPORTING_CURRENCIES` narrowed by
 *     what the registered providers quote. Fails with
 *     `ReportingCurrencyUnsupportedError`, mapped to 422. This is the HARD
 *     GATE, and it is a pure array test so a provider being unreachable can
 *     never stop an operator saving a setting.
 *  3. Coverage advisory - `assessCoverage`, which WARNS AND NEVER BLOCKS. It is
 *     composed in the interfaces layer, where reading the observed native
 *     currencies out of `orders` is legal; doing it here would cost this
 *     context its leaf property.
 *
 * @module libs/core/src/currency/application/services
 * @implements {IReportingCurrencySettingsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@openlinker/shared/logging';
import {
  EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN,
  REPORTING_CURRENCY_SETTING_REPOSITORY_TOKEN,
} from '../../currency.tokens';
import {
  InvalidReportingCurrencyError,
  ReportingCurrencyUnsupportedError,
} from '../../domain/exceptions/reporting-currency.exception';
import { ExchangeRateProviderRegistryPort } from '../../domain/ports/exchange-rate-provider-registry.port';
import { ReportingCurrencySettingRepositoryPort } from '../../domain/ports/reporting-currency-setting-repository.port';
import {
  DEFAULT_REPORTING_CURRENCY,
  REPORTING_CURRENCY_ENV_VAR,
  SUPPORTED_REPORTING_CURRENCIES,
  type ReportingCurrencySettingsView,
  type SetReportingCurrencyOptions,
} from '../../domain/types/reporting-currency.types';
import type { IReportingCurrencySettingsService } from '../interfaces/reporting-currency-settings.service.interface';

const ISO_4217_SHAPE = /^[A-Z]{3}$/;

@Injectable()
export class ReportingCurrencySettingsService implements IReportingCurrencySettingsService {
  private readonly logger = new Logger(ReportingCurrencySettingsService.name);

  /**
   * Latches the "your env value was ignored" warning to exactly one emission.
   * `resolve()` runs on every stamp attempt, so warning per call would bury the
   * log under one line per order while telling the operator nothing new.
   */
  private envWarningEmitted = false;

  constructor(
    @Inject(REPORTING_CURRENCY_SETTING_REPOSITORY_TOKEN)
    private readonly repository: ReportingCurrencySettingRepositoryPort,
    @Inject(EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN)
    private readonly registry: ExchangeRateProviderRegistryPort,
    private readonly configService: ConfigService
  ) {}

  async resolve(): Promise<string> {
    const row = await this.repository.findSetting();
    return row ? row.reportingCurrency : this.resolveEnvFallback();
  }

  async getView(): Promise<ReportingCurrencySettingsView> {
    const row = await this.repository.findSetting();

    if (row) {
      return {
        reportingCurrency: row.reportingCurrency,
        source: 'setting',
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
        supportedCurrencies: this.listSelectableCurrencies(),
      };
    }

    const fromEnv = this.readEnvCurrency();
    return {
      reportingCurrency: fromEnv ?? DEFAULT_REPORTING_CURRENCY,
      source: fromEnv ? 'env' : 'default',
      // `null` on both non-row rungs - no row was ever written, so there is
      // nothing to have been written BY or AT. This is the discriminator the
      // frontend renders as `EUR (default)`, mirroring the AI settings view.
      updatedAt: null,
      updatedBy: null,
      supportedCurrencies: this.listSelectableCurrencies(),
    };
  }

  async setReportingCurrency(
    code: string,
    updatedBy: string | null,
    options?: SetReportingCurrencyOptions
  ): Promise<ReportingCurrencySettingsView> {
    const normalised = code.trim().toUpperCase();

    // Layer 1 - shape.
    if (!ISO_4217_SHAPE.test(normalised)) {
      throw new InvalidReportingCurrencyError(code);
    }

    // Layer 2 - reachability. The hard gate.
    const selectable = this.listSelectableCurrencies();
    if (!selectable.includes(normalised)) {
      throw new ReportingCurrencyUnsupportedError(normalised, selectable);
    }

    const previous = await this.resolve();
    const saved = await this.repository.upsertSetting(normalised, updatedBy);

    this.logger.log('reporting_currency.set', {
      from: previous,
      to: normalised,
      actor: updatedBy ?? 'system',
      // Layer 3 is assessed by the caller and never blocks; recording the
      // acknowledgement keeps the audit trail honest about an operator who
      // proceeded past a known gap.
      acknowledgedCoverageGaps: options?.acknowledgeCoverageGaps === true,
    });

    return {
      reportingCurrency: saved.reportingCurrency,
      source: 'setting',
      updatedAt: saved.updatedAt,
      updatedBy: saved.updatedBy,
      supportedCurrencies: selectable,
    };
  }

  listSelectableCurrencies(): readonly string[] {
    const quoted = new Set<string>();
    for (const provider of this.registry.list()) {
      for (const currency of provider.listSupportedCurrencies()) {
        quoted.add(currency);
      }
    }

    // The union across providers, per ADR-040's save-time gate. Note the
    // sharper condition it approximates: a currency is truly reachable only if
    // ITS OWN publisher (`resolveRateSource`) is registered and quotes it. The
    // two differ only in a partial-wiring state that no shipped host produces,
    // since `FxIntegrationModule` registers both providers together.
    return SUPPORTED_REPORTING_CURRENCIES.filter((currency) => quoted.has(currency));
  }

  /**
   * The env rung. A malformed or unsupported value is IGNORED with exactly one
   * warning and never a throw - a bad env var must not take a deployment down
   * at boot over a setting that has a working default.
   */
  private resolveEnvFallback(): string {
    return this.readEnvCurrency() ?? DEFAULT_REPORTING_CURRENCY;
  }

  private readEnvCurrency(): string | null {
    const raw = this.configService.get<string>(REPORTING_CURRENCY_ENV_VAR);
    if (typeof raw !== 'string' || raw.trim() === '') {
      return null;
    }

    const normalised = raw.trim().toUpperCase();
    if (
      ISO_4217_SHAPE.test(normalised) &&
      (SUPPORTED_REPORTING_CURRENCIES as readonly string[]).includes(normalised)
    ) {
      return normalised;
    }

    if (!this.envWarningEmitted) {
      this.envWarningEmitted = true;
      this.logger.warn(
        `${REPORTING_CURRENCY_ENV_VAR}='${raw}' is not a supported reporting currency and was ignored. ` +
          `Supported: [${SUPPORTED_REPORTING_CURRENCIES.join(', ')}]. ` +
          `Falling back to '${DEFAULT_REPORTING_CURRENCY}'.`
      );
    }
    return null;
  }
}
