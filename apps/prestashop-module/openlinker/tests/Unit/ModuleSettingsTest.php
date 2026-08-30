<?php

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for ModuleSettings and for the scope every module setting is
 * written at.
 *
 * The source guard is the point of this file: the defect in #2602 was not a
 * wrong value, it was a write at the wrong scope, so the test asserts the scope
 * directly rather than a behaviour a stubbed Configuration would fake.
 *
 * @see ModuleSettings
 */
class ModuleSettingsTest extends TestCase
{
    /**
     * Every production file that writes a module setting.
     *
     * The list used to name two of the four, so `ReplayGuard` and
     * `DeliveryRunner` could have regressed to a per-shop write unnoticed.
     */
    private const SOURCES = [
        'openlinker.php',
        'classes/OutboxRepository.php',
        'classes/ReplayGuard.php',
        'classes/DeliveryRunner.php',
    ];

    private function moduleRoot(): string
    {
        return dirname(__DIR__, 2) . '/';
    }

    /**
     * Resolve what a write call actually names.
     *
     * Most writes pass a `self::SOMETHING_CONFIG_KEY` constant, not a literal,
     * so a matcher that captured the token as written yielded a constant NAME
     * that is in neither `KEYS` nor prefixed `OPENLINKER_` - and both
     * assertions then passed on a genuinely per-shop write. The constant is
     * resolved to its declared value here so the guard tests the key.
     *
     * @return string[] one key per write call found
     */
    private function keysWrittenWith(string $method, string $source): array
    {
        preg_match_all(
            '/const\s+([A-Z_]+)\s*=\s*\'([^\']+)\'/',
            $source,
            $constants,
            PREG_SET_ORDER
        );
        $byName = [];
        foreach ($constants as $constant) {
            $byName[$constant[1]] = $constant[2];
        }

        preg_match_all(
            '/Configuration::' . preg_quote($method, '/')
                . '\(\s*(?:\'([A-Za-z_]+)\'|self::([A-Z_]+))/',
            $source,
            $matches,
            PREG_SET_ORDER
        );

        $keys = [];
        foreach ($matches as $match) {
            if (isset($match[1]) && $match[1] !== '') {
                $keys[] = $match[1];
                continue;
            }
            $name = $match[2];
            // An unresolvable constant fails loudly rather than being skipped:
            // skipping is how the old guard passed vacuously.
            self::assertArrayHasKey(
                $name,
                $byName,
                'self::' . $name . ' is written but its value could not be resolved'
            );
            $keys[] = $byName[$name];
        }

        return $keys;
    }

    // ── pickValueToPromote ────────────────────────────────────────────────────

    public function testPromotesTheOnlyValue(): void
    {
        self::assertSame('abc', ModuleSettings::pickValueToPromote([['value' => 'abc']]));
    }

    public function testPrefersANonEmptyValueOverAnEmptyOne(): void
    {
        $rows = [['value' => ''], ['value' => 'secret']];

        self::assertSame('secret', ModuleSettings::pickValueToPromote($rows));
    }

    public function testKeepsTheFirstOfSeveralNonEmptyValues(): void
    {
        $rows = [['value' => 'first'], ['value' => 'second']];

        self::assertSame('first', ModuleSettings::pickValueToPromote($rows));
    }

    /**
     * Every row empty means there is nothing worth promoting, so the caller's
     * `if ($value !== null)` guard has something to fire on.
     *
     * This previously asserted `''`, pinning the defect the docblock already
     * forbade: an empty string was written over the global row and
     * `HmacRequestVerifier::verify` then answered `misconfigured` on every
     * inbound request (#2627 review).
     */
    public function testReturnsNullWhenEveryRowIsEmpty(): void
    {
        self::assertNull(ModuleSettings::pickValueToPromote([['value' => ''], ['value' => null]]));
    }

    public function testReturnsNullWhenThereAreNoRows(): void
    {
        self::assertNull(ModuleSettings::pickValueToPromote([]));
    }

    // ── Write scope ───────────────────────────────────────────────────────────

    public function testNoModuleSettingIsWrittenPerShop(): void
    {
        foreach (self::SOURCES as $relative) {
            $source = (string) file_get_contents($this->moduleRoot() . $relative);

            foreach ($this->keysWrittenWith('updateValue', $source) as $written) {
                self::assertNotContains(
                    $written,
                    ModuleSettings::KEYS,
                    $relative . ' writes the module setting ' . $written . ' per-shop'
                );
                self::assertStringStartsNotWith(
                    'OPENLINKER_',
                    $written,
                    $relative . ' writes ' . $written . ' per-shop'
                );
            }
        }
    }

    public function testEveryGloballyWrittenOpenLinkerKeyIsListed(): void
    {
        foreach (self::SOURCES as $relative) {
            $source = (string) file_get_contents($this->moduleRoot() . $relative);

            foreach ($this->keysWrittenWith('updateGlobalValue', $source) as $written) {
                self::assertContains(
                    $written,
                    ModuleSettings::KEYS,
                    $relative . ' writes ' . $written . ', which ModuleSettings::KEYS does not list'
                );
            }
        }
    }

    /**
     * The guard has to see the constant writes, or it proves nothing.
     *
     * `ReplayGuard` and `DeliveryRunner` write only through `self::` constants,
     * so if constant resolution regressed to skipping them these two files
     * would contribute no keys at all and the two tests above would pass
     * without checking anything.
     */
    public function testTheGuardResolvesConstantWrites(): void
    {
        $replayGuard = (string) file_get_contents($this->moduleRoot() . 'classes/ReplayGuard.php');
        $runner = (string) file_get_contents($this->moduleRoot() . 'classes/DeliveryRunner.php');

        self::assertContains(
            'OPENLINKER_REPLAY_GUARD_DEGRADED_AT',
            $this->keysWrittenWith('updateGlobalValue', $replayGuard)
        );
        self::assertContains(
            'OPENLINKER_CRON_LAST_RUN_AT',
            $this->keysWrittenWith('updateGlobalValue', $runner)
        );
    }

    /**
     * `KEYS`'s own docblock says it is kept in step with uninstall. It was not:
     * three keys were listed and never deleted, which leaves rows behind after
     * an uninstall. Nothing enforced the claim, so this does.
     */
    public function testEveryKeyIsDeletedOnUninstall(): void
    {
        $source = (string) file_get_contents($this->moduleRoot() . 'openlinker.php');
        $start = strpos($source, 'private function clearConfiguration()');
        self::assertNotFalse($start);
        // Constants are declared at the top of the file, so resolution needs the
        // whole source; only the delete calls are read from the method body.
        $deleted = $this->keysWrittenWith('deleteByName', $source);

        foreach (ModuleSettings::KEYS as $key) {
            self::assertContains(
                $key,
                $deleted,
                'clearConfiguration() does not delete ' . $key
            );
        }
    }
}
