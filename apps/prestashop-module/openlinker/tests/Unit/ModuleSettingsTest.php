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
    private const SOURCES = [
        'openlinker.php',
        'classes/OutboxRepository.php',
    ];

    private function moduleRoot(): string
    {
        return dirname(__DIR__, 2) . '/';
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

    public function testReturnsAnEmptyStringWhenEveryRowIsEmpty(): void
    {
        self::assertSame('', ModuleSettings::pickValueToPromote([['value' => ''], ['value' => null]]));
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
            preg_match_all(
                '/Configuration::updateValue\(\s*(?:\'([A-Z_]+)\'|self::([A-Z_]+))/',
                $source,
                $matches,
                PREG_SET_ORDER
            );

            foreach ($matches as $match) {
                $written = $match[1] !== '' ? $match[1] : $match[2];
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
            preg_match_all(
                '/Configuration::updateGlobalValue\(\s*\'([A-Z_]+)\'/',
                $source,
                $matches
            );

            foreach ($matches[1] as $written) {
                self::assertContains(
                    $written,
                    ModuleSettings::KEYS,
                    $relative . ' writes ' . $written . ', which ModuleSettings::KEYS does not list'
                );
            }
        }
    }
}
