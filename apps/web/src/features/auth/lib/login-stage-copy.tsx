/**
 * Login Stage Copy
 *
 * Resolves the words the login stage shows (#4029). Two sources, by design:
 * the demo's copy is fixed in the `login.demo` catalog, while a real install
 * starts from `login.production` and lets an admin override six fields per
 * language (`GET /system/config` -> `loginPage`). An override that is empty
 * falls back to the catalog, so a fresh install never shows a blank page.
 *
 * @module features/auth/lib
 */
import type { ReactNode } from 'react';
import { renderRich, type Messages, type ResolvedCopy } from '../../../shared/i18n';
import { RichTextView } from '../../../shared/ui/rich-text-view';
import type { LoginPageCopyOverrides } from '../../system';

type LoginMessages = ResolvedCopy<Messages['login']>;

export interface LoginStageLink {
  label: string;
  href: string;
}

export interface LoginStageCopy {
  bar: { chip: string; text: string; linksLabel: string; links: LoginStageLink[] } | null;
  headline: { lines: string[]; rotating: string[] | null; accent: string | null };
  lead: string;
  highlights: string[];
  tabs: { register: string; login: string };
  register: {
    title: string;
    lead: string;
    submit: string;
    pending: string;
    sentTitle: string;
    sentLead: (email: string) => ReactNode;
    sentAction: string;
    recording: string | null;
  };
  login: { title: string; lead: string; submit: string; pending: string; failed: string };
  recorded: { label: string; items: string[] } | null;
  consent: {
    title: string;
    lead: string;
    decline: string;
    accept: string;
    pending: string;
    fine: string;
    errorTitle: string;
  } | null;
  support: ReactNode | null;
}

const DEMO_LINK_HREFS = {
  site: { pl: 'https://openlinker.io/pl/', en: 'https://openlinker.io/' },
  docs: 'https://docs.openlinker.io/',
  github: 'https://github.com/openlinker-project/openlinker',
} as const;

const bold = (chunk: string): ReactNode => <span className="auth-card__mail">{chunk}</span>;

const docsLink = (chunk: string): ReactNode => (
  <a href={DEMO_LINK_HREFS.docs} target="_blank" rel="noreferrer">
    {chunk}
  </a>
);

export function buildDemoLoginCopy(messages: LoginMessages, locale: string): LoginStageCopy {
  const demo = messages.demo;
  const bar = messages.bar;
  return {
    bar: {
      chip: bar.chip,
      text: bar.text,
      linksLabel: bar.linksLabel,
      links: [
        {
          label: bar.site,
          href: locale === 'pl' ? DEMO_LINK_HREFS.site.pl : DEMO_LINK_HREFS.site.en,
        },
        { label: bar.docs, href: DEMO_LINK_HREFS.docs },
        { label: bar.github, href: DEMO_LINK_HREFS.github },
      ],
    },
    headline: {
      lines: [demo.headline.line1, demo.headline.line2],
      rotating: Object.values(demo.headline.rotate),
      accent: null,
    },
    lead: demo.lead,
    highlights: Object.values(demo.highlights),
    tabs: { ...demo.tabs },
    register: {
      title: demo.register.title,
      lead: demo.register.lead,
      submit: demo.register.submit,
      pending: demo.register.pending,
      sentTitle: demo.register.sentTitle,
      sentLead: (email) =>
        renderRich(
          demo.register.sentLead,
          { b: bold },
          { email: email || messages.ui.yourAddress }
        ),
      sentAction: demo.register.sentAction,
      recording: demo.register.recording,
    },
    login: { ...demo.login },
    recorded: {
      label: demo.recorded.label,
      items: [demo.recorded.r1, demo.recorded.r2, demo.recorded.r3, demo.recorded.r4],
    },
    consent: { ...demo.consent },
    support: null,
  };
}

const pick = (override: string | undefined, fallback: string): string =>
  override && override.trim() ? override : fallback;

export function buildProductionLoginCopy(
  messages: LoginMessages,
  overrides: LoginPageCopyOverrides = {}
): LoginStageCopy {
  const prod = messages.production;
  return {
    bar: null,
    headline: {
      lines: [pick(overrides.headline, prod.headline.line1)],
      rotating: null,
      accent: pick(overrides.headlineAccent, prod.headline.accent),
    },
    lead: pick(overrides.lead, prod.lead),
    highlights: [],
    tabs: { ...prod.tabs },
    register: {
      title: pick(overrides.registerTitle, prod.register.title),
      lead: pick(overrides.registerSubtitle, prod.register.lead),
      submit: prod.register.submit,
      pending: prod.register.pending,
      sentTitle: prod.register.sentTitle,
      sentLead: () => prod.register.sentLead,
      sentAction: prod.register.sentAction,
      recording: null,
    },
    login: {
      ...prod.login,
      title: pick(overrides.formTitle, prod.login.title),
      lead: pick(overrides.formSubtitle, prod.login.lead),
    },
    recorded: null,
    consent: null,
    // An admin's support line is rich text from the settings editor (sanitized
    // again on render); the default links to the docs.
    support:
      overrides.support && overrides.support.trim() ? (
        <RichTextView html={overrides.support} />
      ) : (
        renderRich(prod.support, { link: docsLink })
      ),
  };
}
