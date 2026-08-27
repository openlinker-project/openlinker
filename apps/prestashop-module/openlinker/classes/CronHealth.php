<?php
/**
 * Cron Health
 *
 * Turns "when did delivery last run" into something the panel can state (#2618).
 *
 * A shop whose cron never fired used to look identical to a shop with nothing
 * to deliver: no error, no warning, just stock that updated late. This is the
 * missing signal.
 *
 * The staleness threshold tolerates an hourly cron, because that is the
 * shortest interval some hosting tiers offer. An operator on such a tier should
 * see a slow shop, not a permanent alarm.
 *
 * Pure so the rule is testable without a PrestaShop runtime.
 *
 * @module prestashop-module/classes
 */

class CronHealth
{
    /** A pass older than this is reported as stale. */
    const STALE_AFTER_SECONDS = 7200;

    /**
     * Describe the state of delivery.
     *
     * @param string|null $lastRunAt 'Y-m-d H:i:s' as recorded by DeliveryRunner.
     * @param int|null    $nowTs     Unix timestamp, for tests.
     * @return array{ran: bool, age_seconds: int|null, stale: bool}
     */
    public static function assess($lastRunAt, $nowTs = null)
    {
        $nowTs = $nowTs === null ? time() : (int) $nowTs;
        $lastRunAt = trim((string) $lastRunAt);

        if ($lastRunAt === '') {
            // Never having run is the state this exists to reveal, so it counts
            // as stale rather than as unknown.
            return ['ran' => false, 'age_seconds' => null, 'stale' => true];
        }

        $timestamp = strtotime($lastRunAt);
        if ($timestamp === false) {
            return ['ran' => false, 'age_seconds' => null, 'stale' => true];
        }

        // A clock that moved backwards reads as fresh, not as a negative age.
        $age = max(0, $nowTs - $timestamp);

        return [
            'ran' => true,
            'age_seconds' => $age,
            'stale' => $age > self::STALE_AFTER_SECONDS,
        ];
    }
}
