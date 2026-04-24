/**
 * Prompt Templates — Legacy Path Redirects
 *
 * Prompt templates moved from Settings to a dedicated AI section (#377).
 * Old URLs stay reachable via these `<Navigate replace>` shims so bookmarks
 * and shared links resolve. Both redirects sit inside `AuthenticatedAppLayout`
 * and therefore inherit the auth gate — anonymous users bounce to `/login`
 * instead of hitting a dead redirect.
 *
 * Retire window: TBD. See follow-ups in #377 — this file is a single-file
 * delete once the deprecation period ends.
 *
 * @module app/routes
 */
import type { ReactElement } from 'react';
import { Navigate, useParams, type RouteObject } from 'react-router-dom';

export const promptTemplatesLegacyListRedirectRoute: RouteObject = {
  path: 'settings/prompt-templates',
  element: <Navigate to="/ai/prompt-templates" replace />,
};

function PromptTemplateLegacyDetailRedirect(): ReactElement {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/ai/prompt-templates" replace />;
  return <Navigate to={`/ai/prompt-templates/${id}`} replace />;
}

export const promptTemplateLegacyDetailRedirectRoute: RouteObject = {
  path: 'settings/prompt-templates/:id',
  element: <PromptTemplateLegacyDetailRedirect />,
};
