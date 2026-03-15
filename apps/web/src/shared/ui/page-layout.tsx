import type { PropsWithChildren, ReactElement, ReactNode } from 'react';

interface PageLayoutProps extends PropsWithChildren {
  actions?: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  summary?: ReactNode;
  title: ReactNode;
}

export function PageLayout({
  actions,
  children,
  description,
  eyebrow,
  summary,
  title,
}: PageLayoutProps): ReactElement {
  return (
    <section className="page-section">
      <div className={actions ? 'page-header page-header--split' : 'page-header'}>
        <div className="page-header__content">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2 className="page-title">{title}</h2>
          {description ? <p className="page-description">{description}</p> : null}
        </div>

        {actions ? <div className="page-header__actions">{actions}</div> : null}
      </div>

      {summary ? <div className="toolbar page-summary">{summary}</div> : null}
      {children}
    </section>
  );
}
