/**
 * CommandPalette
 *
 * Data-agnostic ⌘K command palette primitive built on `cmdk`. Renders a
 * Radix Dialog overlay containing a cmdk Command root. Consumers supply
 * `groups` of `PaletteItem`s; the component handles rendering, keyboard
 * navigation, and empty/loading states.
 *
 * Only this file may import from `cmdk`. All other layers must import the
 * project primitive instead (#333).
 *
 * @module shared/ui
 */
import { Command } from 'cmdk';
import { forwardRef, type ComponentPropsWithoutRef, type ReactElement } from 'react';
import { Dialog, DialogContent } from './dialog';

export interface PaletteItem {
  id: string;
  label: string;
  description?: string;
  onSelect: () => void;
}

export interface PaletteGroup {
  key: string;
  heading: string;
  items: PaletteItem[];
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  groups: PaletteGroup[];
  loading?: boolean;
  placeholder?: string;
}

export function CommandPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  groups,
  loading = false,
  placeholder = 'Search…',
}: CommandPaletteProps): ReactElement {
  const hasItems = groups.some((g) => g.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="command-palette"
        aria-label="Command palette"
        // cmdk's Command provides its own focus management — suppress the
        // Radix default auto-focus so the input receives focus instead.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command className="command-palette__command" shouldFilter={false} loop>
          <div className="command-palette__input-row">
            <span className="command-palette__search-icon" aria-hidden="true">
              ⌕
            </span>
            <Command.Input
              className="command-palette__input"
              placeholder={placeholder}
              value={query}
              onValueChange={onQueryChange}
              autoFocus
            />
          </div>

          <Command.List className="command-palette__list" aria-label="Command results">
            {loading ? (
              <Command.Loading>
                <div className="command-palette__state">Searching…</div>
              </Command.Loading>
            ) : !hasItems ? (
              <Command.Empty>
                <div className="command-palette__state">
                  {query.length > 0 ? 'No results found.' : 'Start typing to search.'}
                </div>
              </Command.Empty>
            ) : (
              groups.map((group) =>
                group.items.length > 0 ? (
                  <Command.Group
                    key={group.key}
                    heading={group.heading}
                    className="command-palette__group"
                  >
                    {group.items.map((item) => (
                      <Command.Item
                        key={item.id}
                        value={item.id}
                        className="command-palette__item"
                        onSelect={item.onSelect}
                      >
                        <span className="command-palette__item-label">{item.label}</span>
                        {item.description ? (
                          <span className="command-palette__item-description">
                            {item.description}
                          </span>
                        ) : null}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ) : null,
              )
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

// CommandPaletteTrigger — thin button that activates the palette.
// Wraps a forwardRef so parent can focus it programmatically.

type CommandPaletteTriggerProps = ComponentPropsWithoutRef<'button'> & {
  onClick: () => void;
};

export const CommandPaletteTrigger = forwardRef<HTMLButtonElement, CommandPaletteTriggerProps>(
  function CommandPaletteTrigger({ onClick, className = '', ...props }, ref) {
    const classes = ['shell-topbar__search', className].filter(Boolean).join(' ');
    return (
      <button
        ref={ref}
        type="button"
        className={classes}
        onClick={onClick}
        aria-label="Open command palette (⌘K)"
        title="Open command palette (⌘K)"
        {...props}
      >
        <span className="shell-topbar__search-icon" aria-hidden="true">
          ⌕
        </span>
        <span className="shell-topbar__search-placeholder">
          Search orders, products, connections…
        </span>
        <kbd className="shell-topbar__search-kbd" aria-hidden="true">
          ⌘K
        </kbd>
      </button>
    );
  },
);
