# Implementation Plan: move the language switch into the account menu and onto the login card (#4021)

## 1. Task understanding

**Goal.** Put the language switch where operators look for personal preferences: in the account menu beside
Theme and Density when signed in, and on the login card itself when signed out.

**Layer.** Frontend (`app` shell and layouts, `shared/ui`).

**Base.** `3891-i18n-lock-in` (PR #4020).

**Non-goals.** Saving the language on the user profile (separate follow-up); changing the language list.

## 2. Design

- **`LanguageToggle`** (`shared/ui/language-switch.tsx`): the language list as an inline radio group - flag,
  native name, Beta tag - with `ThemeToggle`'s keyboard model (arrows move and select, Home / End, roving
  tabindex). It reuses `LANGUAGE_OPTIONS`, so the list exists once. A popover opened from inside a Radix menu
  would close the menu on its first click, which is why the menu gets an inline control.
- **Focus after a change**: a language change remounts the app (`LocaleKeyed`). The refocus note the popover
  already used becomes `restoreFocusAfterLanguageChange(element)`, called by the popover's trigger and by the
  account-menu trigger, so a keyboard user lands back on the user chip.
- **Account menu** (`UserChip` in `app/app-shell.tsx`): a Language section after Density, before Log out.
  The sidebar / mobile drawer footer (`WorkspaceFooter`) no longer carries the switch. The pack bench renders
  the same top bar, so packers get a language switch for the first time.
- **Login card** (`guest-layout.tsx`, `consent-layout.tsx`): the popover switch moves from the page corner into
  the card's top-right corner (`.guest-card__language`); the brand gets equal side padding so it stays centred
  and clear of the switch.
- Copy `app.userMenu.language` ("Language" / "Język") with a budget.

## 3. Tests

- `language-switch.test.tsx`: the toggle lists both languages with the current one checked, keeps only the
  checked one tabbable, switches on click and with arrows, stores nothing on a no-op click, renders nothing
  without a provider, and hands focus to a menu trigger after the remount.
- `app-shell.test.tsx`: the sidebar has no language switch; the account menu has the Language radio group.
- `guest-layout.test.tsx`: the switch is inside `.guest-card`.
