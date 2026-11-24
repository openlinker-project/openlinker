/**
 * Retention Scope (#4289)
 *
 * One scope's whole editor: the master switch and the studio under it, tied to
 * the plan for exactly this scope's rules. It is what the general page shows in
 * a tab and what the connection edit embeds for "own rules".
 *
 * The switch is the one control that can start erasing data, so it is locked
 * until the plan for the rules on screen has been calculated (the live plan IS
 * the trial run). A switch already on stays operable, so it can always be
 * turned off.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import { useEffect, type ReactElement, type ReactNode } from 'react';
import { useMessages } from '../../../shared/i18n';
import { Switch } from '../../../shared/ui/switch';
import type { BuyerDataPreview, BuyerDataRules } from '../api/buyer-data.types';
import { useBuyerDataFollowersPlan } from '../hooks/use-buyer-data-followers';
import { useBuyerDataPlan } from '../hooks/use-buyer-data-plan';
import { validateBuyerDataRules } from '../lib/buyer-data-config';
import { RetentionStudio, type RetentionStudioProps } from './retention-studio';

export interface RetentionScopeProps {
  rules: BuyerDataRules;
  onChange: (next: BuyerDataRules) => void;
  /** The switch is saved on; only changes the hint, never the lock. */
  savedEnabled: boolean;
  connectionId?: string;
  /** The session may not write, or the raw JSON is unparseable. */
  locked?: boolean;
  /** Inherited values: the studio is ghosted. */
  ghost?: boolean;
  /** Hides the master switch (the scope follows another scope's switch). */
  showSwitch?: boolean;
  /** Reports the latest answered plan, for the confirmation that counts what will happen. */
  onPlan?: (preview: BuyerDataPreview | undefined) => void;
  /**
   * The Defaults tab: only these connections follow the defaults, so the plan
   * and the strip count them and nobody else. Absent = the scope's own orders.
   */
  followerIds?: readonly string[];
  /** One line saying whose orders the plan counts. */
  planNote?: string;
  planFollowers?: RetentionStudioProps['planFollowers'];
  /** Closes the workbench under the studio (the channel comparison). */
  footer?: ReactNode;
  name: string;
}

export function RetentionScope({
  rules,
  onChange,
  savedEnabled,
  connectionId,
  locked = false,
  ghost = false,
  showSwitch = true,
  onPlan,
  followerIds,
  planNote,
  planFollowers,
  footer,
  name,
}: RetentionScopeProps): ReactElement {
  const copy = useMessages('buyer-data').scope;
  const input = {
    hideAfterDays: rules.hideAfterDays,
    eraseAfterDays: rules.eraseAfterDays,
    mode: rules.mode,
  };
  const single = useBuyerDataPlan(
    { connectionId, ...input },
    { enabled: followerIds === undefined }
  );
  const followers = useBuyerDataFollowersPlan(input, followerIds ?? [], {
    enabled: followerIds !== undefined,
  });
  const plan = followerIds === undefined ? single : followers;
  const issues = validateBuyerDataRules(rules);
  const canEnable = issues.length === 0 && plan.fresh;

  useEffect(() => {
    onPlan?.(plan.fresh ? plan.data : undefined);
    // `plan.data` identity changes with every answer, which is exactly when to report.
  }, [plan.fresh, plan.data]);

  const hint = rules.enabled
    ? savedEnabled
      ? copy.hintOn
      : copy.hintDraft
    : canEnable
      ? copy.hintReady
      : copy.hintWaiting;

  const railHead = showSwitch ? (
    <div
      className={`retention-scope__switch${rules.enabled ? ' retention-scope__switch--on' : ''}`}
    >
      <Switch
        checked={rules.enabled}
        disabled={locked || (!canEnable && !rules.enabled)}
        onCheckedChange={(enabled) => onChange({ ...rules, enabled })}
        aria-describedby={`${name}-switch-hint`}
        data-testid={`buyer-data-switch-${name}`}
        label={copy.switchLabel}
      />
      <p
        id={`${name}-switch-hint`}
        className="retention-scope__hint"
        data-testid="buyer-data-switch-hint"
      >
        {hint}
      </p>
    </div>
  ) : undefined;

  return (
    <div className="retention-scope" data-testid={`retention-scope-${name}`}>
      <RetentionStudio
        name={name}
        rules={rules}
        onChange={onChange}
        connectionId={connectionId}
        plan={plan}
        followerIds={followerIds}
        planNote={planNote}
        planFollowers={planFollowers}
        disabled={locked}
        ghost={ghost}
        railHead={railHead}
        footer={footer}
      />
    </div>
  );
}
