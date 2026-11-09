# Implementation Plan: move the language switch into the account menu and onto the guest card (#4021)

## 1. Task understanding

**Goal.** Put the language switch where operators look for personal preferences: first in the account menu,
above Theme and Density, when signed in, and on the card itself on the signed-out guest screens. Also rename
the Insights nav entry to "System health" / "Kondycja systemu".

**Layer.** Frontend (`app` shell and layouts, `features/language`).

**Base.** `3891-i18n-lock-in` (PR #4020).

**Non-goals.** Saving the language on the user profile (separate follow-up); changing the language list.

## 2. Design

- **One language list** (`features/language/components/language-switch.tsx`): the popover's list moves into
  `LanguageOptionList` - an `OptionList` row per language with flag, native name, code and the Beta badge with its
  hover hint. The popover (`LanguageSwitch`) and the account menu (`LanguageMenuList`) both render it, so the menu
  shows the same rows rather than a look-alike. A popover opened from inside a Radix menu would close the menu
  on its first click, which is why the menu gets the list in place. `LanguageMenuList` stops the list's own
  navigation keys (arrows, Home / End, Enter, Space) from reaching the menu's arrow roving; Escape still closes
  the menu.
- **Focus after a change**: a language change remounts the app (`LocaleKeyed`). The refocus note the popover
  already used becomes `restoreFocusAfterLanguageChange(element)`, called by the popover's trigger and by the
  account-menu trigger, so a keyboard user lands back on the user chip.
- **Account menu** (`UserChip` in `app/app-shell.tsx`): a Language section first, above Theme and Density.
  The sidebar / mobile drawer footer (`WorkspaceFooter`) no longer carries the switch. The pack bench renders
  the same top bar, so packers get a language switch for the first time.
- **Guest card** (`guest-layout.tsx`: forgot password, reset password, confirm email): the popover switch moves
  from the page corner into the card's top-right corner (`.guest-card__language`); the brand gets equal side
  padding so it stays centred and clear of the switch. Login, register and consent are out of scope here: since
  #4048 they render `LoginStageLayout`, whose top bar already carries the language switch.
- Copy `app.userMenu.language` ("Language" / "Język") with a budget.
- **Nav rename**: `app.pages.insights` (nav, breadcrumb, command palette) and the login backdrop's nav label become
  "System health" / "Kondycja systemu". The page's own title ("Operations overview") is unchanged.

## 3. Tests

- `language-menu-list.test.tsx`: the list shows both languages with the current one selected, the code and the
  Beta badge like the popover, switches on click and by keyboard without the keys reaching the surrounding menu,
  stores nothing on a no-op click, renders nothing without a provider, and hands focus to a menu trigger after
  the remount.
- `app-shell.test.tsx`: the sidebar has no language switch; the account menu has the Language list, above Theme.
- `nav-registry.test.ts`, `app.test.tsx`: the nav entry reads "System health".
- `guest-layout.test.tsx`: the switch is inside `.guest-card`.
