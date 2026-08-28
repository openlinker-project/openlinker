<?php
/**
 * Secret Display
 *
 * Rules for showing and re-saving a stored credential (#2619).
 *
 * The webhook secret and the cron token used to be rendered into the
 * configuration form as input values. An HTML input value is in the page
 * source, so the secret reached the browser cache, the operator's password
 * manager and any screenshot of the page - and a password-type input does not
 * change that, it only hides the characters on screen.
 *
 * The form now renders an empty field plus a short hint, and an empty submitted
 * value means "keep what is stored" rather than "clear it".
 *
 * @module prestashop-module/classes
 */

class SecretDisplay
{
    /** Characters of the stored value shown so an operator can tell two apart. */
    const HINT_CHARS = 4;

    /**
     * A hint an operator can recognise a value by, without revealing it.
     *
     * A short value yields no hint at all: showing most of a six-character
     * token would be worse than showing nothing.
     *
     * @param string|null $secret
     * @return string Empty when there is nothing to hint at.
     */
    public static function hint($secret)
    {
        $secret = (string) $secret;

        // Never reveal more than a third of a credential, so a short secret
        // gets no hint at all rather than most of itself.
        if (strlen($secret) < self::HINT_CHARS * 3) {
            return $secret === '' ? '' : '(set)';
        }

        return substr($secret, 0, self::HINT_CHARS) . '...';
    }

    /**
     * Decide what to store for a submitted credential field.
     *
     * @param string|null $submitted Value from the form.
     * @param string|null $stored    Value currently in configuration.
     * @return string|null The value to write, or null to leave it alone.
     */
    public static function resolveSubmitted($submitted, $stored)
    {
        $submitted = trim((string) $submitted);

        if ($submitted === '') {
            // Blank is the normal state of the field now, so it can only mean
            // "unchanged". Clearing a secret is done by typing a new one.
            return null;
        }

        if ($submitted === (string) $stored) {
            return null;
        }

        return $submitted;
    }
}
