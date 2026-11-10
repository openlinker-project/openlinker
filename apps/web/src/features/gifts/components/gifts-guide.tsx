/**
 * GiftsGuide (#3935)
 *
 * The "How gifts and bundles work" button and its drawer, for the orders list
 * and the order detail. One component, two variants: the words differ, the
 * mechanics (button, drawer, `?` key) are the shared GuideDrawer's.
 *
 * @module apps/web/src/features/gifts/components
 */
import { useCallback, useState, type ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { GuideDrawer, useGuideShortcut, type GuideSection } from '../../../shared/ui/guide-drawer';

export interface GiftsGuideProps {
  variant: 'list' | 'detail';
}

export function GiftsGuide({ variant }: GiftsGuideProps): ReactElement {
  const copy = useMessages('gifts').guide;
  const [open, setOpen] = useState(false);
  const openGuide = useCallback(() => {
    setOpen(true);
  }, []);
  useGuideShortcut(openGuide);

  const sections: readonly GuideSection[] =
    variant === 'list'
      ? [
          {
            id: 'marks',
            title: copy.list.s1.title,
            tag: copy.list.s1.tag,
            body: (
              <>
                <p>{copy.list.s1.gift}</p>
                <p>{copy.list.s1.bundle}</p>
                <p>{copy.list.s1.missing}</p>
              </>
            ),
          },
          {
            id: 'filters',
            title: copy.list.s2.title,
            tag: copy.list.s2.tag,
            body: (
              <>
                <p>{copy.list.s2.quick}</p>
                <p>{copy.list.s2.attention}</p>
              </>
            ),
          },
        ]
      : [
          {
            id: 'lines',
            title: copy.detail.s1.title,
            tag: copy.detail.s1.tag,
            body: (
              <>
                <p>{copy.detail.s1.bundle}</p>
                <p>{copy.detail.s1.gift}</p>
                <p>{copy.detail.s1.source}</p>
              </>
            ),
          },
          {
            id: 'missing',
            title: copy.detail.s2.title,
            tag: copy.detail.s2.tag,
            body: (
              <>
                <p>{copy.detail.s2.skip}</p>
                <p>{copy.detail.s2.manual}</p>
              </>
            ),
          },
          {
            id: 'document',
            title: copy.detail.s3.title,
            tag: copy.detail.s3.tag,
            body: <p>{copy.detail.s3.body}</p>,
          },
        ];
  const text = variant === 'list' ? copy.list : copy.detail;

  return (
    <>
      <Button tone="secondary" className="button--sm" onClick={openGuide} data-testid="gifts-guide-open">
        {copy.button}
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
        sections={sections}
        footerHint={copy.footer}
      />
    </>
  );
}
