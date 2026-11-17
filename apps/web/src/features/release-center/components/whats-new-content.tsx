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
import type { ReactElement } from 'react';
import changelog from 'virtual:openlinker-changelog';
import { useNavigate } from 'react-router-dom';
import { interpolate, useMessages } from '../../../shared/i18n';
import { useFormat } from '../../../shared/i18n/use-format';
import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useReleaseCenterAccess } from '../hooks/use-release-center-access';
import { useReleaseStepRows } from '../hooks/use-release-step-rows';
import { compareVersions, isValidVersion } from '../lib/compare-versions';
import { BaselineMarkdown } from './baseline-markdown';
import { stepPath } from './release-dialog-host';
import { useStepCopy } from './release-step-copy';

export function WhatsNewContent(): ReactElement {
  const copy = useMessages('release-center').whatsNew;
  const dialogCopy = useMessages('release-center').dialog;
  const stepCopy = useStepCopy();
  const format = useFormat();
  const navigate = useNavigate();
  const { canWriteSteps } = useReleaseCenterAccess();
  const rows = useReleaseStepRows();
  const left = rows.filter((row) => !row.done).length;

  const releases = [...changelog.releases]
    .filter((r) => isValidVersion(r.version))
    .sort((a, b) => compareVersions(b.version, a.version));

  return (
    <div className="whats-new">
      <p className="whats-new__intro">{copy.intro}</p>

      <section className="whats-new__card" aria-labelledby="whats-new-setup">
        <div className="whats-new__head">
          <h3 id="whats-new-setup">{copy.setupTitle}</h3>
          {rows.length > 0 ? (
            <StatusBadge tone={left === 0 ? 'success' : 'warning'}>
              {left === 0
                ? copy.allSet
                : interpolate(copy.progress, { done: rows.length - left, total: rows.length })}
            </StatusBadge>
          ) : null}
        </div>
        {rows.length === 0 ? <p>{copy.noSteps}</p> : null}
        <ul className="whats-new__rows">
          {rows.map((row) => (
            <li key={row.key} className="whats-new__row">
              <span className="whats-new__row-title">
                {stepCopy(row.step.id).title}
                {row.connection ? <span> · {row.connection.name}</span> : null}
                <span className="release-dialog__chip">
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
                <Button tone="secondary" onClick={() => navigate(stepPath(row))}>
                  {canWriteSteps ? copy.setNow : copy.showWhere}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <p className="whats-new__lang">{copy.changelogLanguage}</p>
      {releases.length === 0 && !changelog.baseline ? <p>{copy.changelogUnavailable}</p> : null}
      <div lang="en" className="whats-new__changelog">
        {releases.map((release, index) => (
          <article key={release.version} className="whats-new__card">
            <div className="whats-new__head">
              <StatusBadge tone={index === 0 ? 'success' : 'neutral'}>
                {index === 0 ? copy.current : copy.older}
              </StatusBadge>
              <h3>{`v${release.version}`}</h3>
              {release.date ? (
                <span className="whats-new__date">{format.date(release.date)}</span>
              ) : null}
            </div>
            {release.groups.map((group) => (
              <div key={group.title} className="whats-new__group">
                <h4>{group.title}</h4>
                <ul>
                  {group.entries.map((entry) => (
                    <li key={`${entry.scope ?? ''}:${entry.text}`}>
                      {entry.scope ? <b className="mono-text">{entry.scope}: </b> : null}
                      {entry.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </article>
        ))}
        {changelog.baseline ? (
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
    </div>
  );
}
