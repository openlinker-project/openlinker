/**
 * GiftsGuide (#3935)
 *
 * The "How gifts and bundles work" button and its drawer, one component for the
 * six surfaces that carry gifts or bundles (orders list and detail, return
 * detail, pack bench, stock movements). The words are per variant in the `gifts`
 * namespace; the mechanics (button, drawer, `?` key, deep link) are the shared
 * GuideDrawer's.
 *
 * @module apps/web/src/features/gifts/components
 */
import { useCallback, useState, type ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { GuideDrawer, useGuideShortcut } from '../../../shared/ui/guide-drawer';

export type GiftsGuideVariant = 'list' | 'detail' | 'returns' | 'bench' | 'stock';

export interface GiftsGuideProps {
  variant: GiftsGuideVariant;
  /** Registers the `?` shortcut. Off where the page already binds `?` itself. */
  shortcut?: boolean;
  className?: string;
}

export function GiftsGuide({ variant, shortcut = true, className }: GiftsGuideProps): ReactElement {
  const copy = useMessages('gifts').guide;
  const text = copy.variants[variant];
  const [open, setOpen] = useState(false);
  const openGuide = useCallback(() => {
    setOpen(true);
  }, []);
  useGuideShortcut(shortcut ? openGuide : noop);

  return (
    <>
      <Button
        tone="secondary"
        className={['button--sm', className].filter(Boolean).join(' ')}
        onClick={openGuide}
        data-testid="gifts-guide-open"
      >
        {text.button}
        <span className="button__shortcut" aria-hidden="true">
          ?
        </span>
      </Button>
      <GuideDrawer
        open={open}
        onOpenChange={setOpen}
        kicker={copy.kicker}
        title={text.title}
        intro={text.intro}
        sections={Object.entries(text.sections).map(([id, section]) => ({
          id,
          title: section.title,
          tag: section.tag,
          body: (
            <>
              {Object.entries(section)
                .filter(([key]) => /^p\d+$/.test(key))
                .map(([key, paragraph]) => (
                  <p key={key}>{paragraph}</p>
                ))}
            </>
          ),
        }))}
        footerHint={copy.footer}
      />
    </>
  );
}

function noop(): void {
  /* shortcut disabled */
}
