/**
 * What's new content (#4147, ADR-085)
 *
 * The setup block (steps of the installed version, "X of N" or "All set", a
 * "Set up now" / "Show me where" button or "Done" per row) above the full
 * changelog. The changelog is English by decision, so its block carries
 * `lang="en"` and one locale sentence says so in the active language.
 *
 * @module features/release-center/components
 */
import { useEffect, useRef, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import changelog from 'virtual:openlinker-changelog';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { ListPagination } from '../../../shared/ui/list-pagination';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useReleaseCenterAccess } from '../hooks/use-release-center-access';
import { useReleaseStepRows } from '../hooks/use-release-step-rows';
import { compareVersions, isValidVersion } from '../lib/compare-versions';
import {
  RELEASES_PAGE_SIZE,
  findReleaseIndex,
  pageOfIndex,
  paginateReleases,
} from '../lib/paginate-releases';
import { BaselineMarkdown } from './baseline-markdown';
import { rowsToTourSteps } from './release-dialog-host';
import { useTour } from '../tour/tour-context';
import { ReleaseIcon } from './release-icon';
import { useStepCopy } from './release-step-copy';

export function WhatsNewContent(): ReactElement {
  const copy = useMessages('release-center').whatsNew;
  const dialogCopy = useMessages('release-center').dialog;
  const stepCopy = useStepCopy();
  const tour = useTour();
  const { canWriteSteps } = useReleaseCenterAccess();
  const rows = useReleaseStepRows();
  const left = rows.filter((row) => !row.done).length;

  const releases = [...changelog.releases]
    .filter((r) => isValidVersion(r.version))
    .sort((a, b) => compareVersions(b.version, a.version));

  // Pagination and the deep-link target are URL state (`?page=`, `?v=`), so a
  // reload, back/forward and a shared link all land on the same releases.
  const [searchParams, setSearchParams] = useSearchParams();
  const target = searchParams.get('v');
  const targetIndex = findReleaseIndex(releases, target);
  const pageCount = Math.max(1, Math.ceil(releases.length / RELEASES_PAGE_SIZE));
  const rawPage = searchParams.get('page');
  // An explicit page wins; otherwise a deep link opens the page holding its release.
  const effectiveRaw =
    rawPage !== null ? rawPage : targetIndex >= 0 ? String(pageOfIndex(targetIndex)) : null;
  const { page, offset, items: pageReleases } = paginateReleases(releases, effectiveRaw);
  const isLastPage = page === pageCount;
  const targetVersion = targetIndex >= 0 ? releases[targetIndex]?.version : undefined;

  const langRef = useRef<HTMLParagraphElement>(null);
  const changelogRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  const goToPage = (nextPage: number): void => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('v');
        if (nextPage > 1) next.set('page', String(nextPage));
        else next.delete('page');
        return next;
      },
      { preventScrollReset: true }
    );
    // Keyboard and screen reader users land at the top of the new list, whose
    // range is announced by the pager's live summary.
    requestAnimationFrame(() => {
      langRef.current?.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth';
    if (targetVersion) {
      document
        .getElementById(`release-v${targetVersion}`)
        ?.scrollIntoView?.({ behavior, block: 'start' });
    } else if (!firstRender.current) {
      (langRef.current ?? changelogRef.current)?.scrollIntoView?.({ behavior, block: 'start' });
    }
    firstRender.current = false;
  }, [page, targetVersion]);

  return (
    <div className="whats-new">
      <p className="whats-new__intro">{copy.intro}</p>

      <aside className="whats-new__rail">
      <section className="whats-new__card whats-new__setup" aria-labelledby="whats-new-setup">
        <div className="whats-new__head">
          <h3 id="whats-new-setup">{copy.setupTitle}</h3>
          {rows.length > 0 ? (
            <span
              className={`release-chip ${left === 0 ? 'release-chip--success' : 'release-chip--accent'}`}
            >
              {left === 0
                ? copy.allSet
                : interpolate(copy.progress, { done: rows.length - left, total: rows.length })}
            </span>
          ) : null}
        </div>
        {rows.length > 0 ? (
          <div
            className="whats-new__meter"
            role="presentation"
            style={{ ['--done' as string]: `${((rows.length - left) / rows.length) * 100}%` }}
          />
        ) : null}
        {rows.length === 0 ? <p>{copy.noSteps}</p> : null}
        <ul className="whats-new__rows">
          {rows.map((row) => (
            <li key={row.key} className="whats-new__row">
              <span className="whats-new__row-title">
                {stepCopy(row.step.id).title}
                {row.connection ? <span> · {row.connection.name}</span> : null}
                <span
                  className={`release-chip${canWriteSteps && row.importance === 'required' ? ' release-chip--accent' : ''}`}
                >
                  {canWriteSteps
                    ? row.importance === 'required'
                      ? dialogCopy.required
                      : dialogCopy.optional
                    : dialogCopy.needsAdmin}
                </span>
              </span>
              {row.done ? (
                <StatusBadge tone="success">{copy.done}</StatusBadge>
              ) : (
                <Button
                  tone="secondary"
                  className="button--sm"
                  onClick={() => tour.start(rowsToTourSteps([row]))}
                >
                  {canWriteSteps ? copy.setNow : copy.showWhere}{' '}
                  <ReleaseIcon name="arrow-right" size={12} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
      {releases.length > 1 ? (
        <nav className="whats-new__card whats-new__index" aria-label="Releases" lang="en">
          <h3>Releases</h3>
          <ul>
            {releases.map((release, i) => (
              <li key={release.version}>
                <a
                  href={`?v=${release.version}`}
                  aria-current={
                    release.version === (targetVersion ?? releases[offset]?.version)
                      ? 'true'
                      : undefined
                  }
                  onClick={(event) => {
                    event.preventDefault();
                    setSearchParams(
                      (prev) => {
                        const next = new URLSearchParams(prev);
                        next.delete('page');
                        next.set('v', release.version);
                        return next;
                      },
                      { preventScrollReset: true }
                    );
                  }}
                >
                  <span className="mono-text">{`v${release.version}`}</span>
                  {i === 0 ? (
                    <span className="release-chip release-chip--success">{copy.current}</span>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      </aside>

      <div className="whats-new__main">
      <p className="whats-new__lang" ref={langRef} tabIndex={-1}>
        {copy.changelogLanguage}
      </p>
      {releases.length === 0 && !changelog.baseline ? <p>{copy.changelogUnavailable}</p> : null}
      <div lang="en" className="whats-new__changelog" ref={changelogRef}>
        {pageReleases.map((release, i) => {
          const index = offset + i;
          return (
            <article
              key={release.version}
              id={`release-v${release.version}`}
              className={`whats-new__card${release.version === targetVersion ? ' whats-new__card--target' : ''}`}
            >
              <div className="whats-new__head whats-new__head--release">
                <h3>{`v${release.version}`}</h3>
                <StatusBadge tone={index === 0 ? 'success' : 'neutral'}>
                  {index === 0 ? copy.current : copy.older}
                </StatusBadge>
                {release.date ? <span className="whats-new__date">{release.date}</span> : null}
              </div>
              {release.groups.map((group) => (
                <div key={group.title} className="whats-new__group">
                  <h4>{group.title}</h4>
                  <ul>
                    {group.entries.map((entry) => (
                      <li key={`${entry.scope ?? ''}:${entry.text}`} className="whats-new__change">
                        <span>
                          {entry.scope ? <b className="mono-text">{entry.scope}: </b> : null}
                          {entry.text}
                        </span>
                        {entry.commits[0] ? (
                          <span className="release-dialog__hash">
                            {entry.commits[0].slice(0, 7)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </article>
          );
        })}
        {changelog.baseline && isLastPage ? (
          <article className="whats-new__card">
            <div className="whats-new__head">
              <StatusBadge tone="neutral">{copy.older}</StatusBadge>
              <h3>{`v${changelog.baseline.version}`}</h3>
              <span className="whats-new__date">{copy.baselineTitle}</span>
            </div>
            <BaselineMarkdown markdown={changelog.baseline.markdown} />
          </article>
        ) : null}
      </div>
      {releases.length > RELEASES_PAGE_SIZE ? (
        <ListPagination
          offset={offset}
          limit={RELEASES_PAGE_SIZE}
          rowCount={pageReleases.length}
          total={releases.length}
          totalState="known"
          showTotalLoader={false}
          onOffsetChange={(next) => {
            goToPage(Math.floor(next / RELEASES_PAGE_SIZE) + 1);
          }}
        />
      ) : null}
      </div>
    </div>
  );
}
