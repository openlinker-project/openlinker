/**
 * Step 3 — See what changes (#3457)
 *
 * Read before turning on. Every sentence is in `oms-onboarding.copy.ts`,
 * which records the issue that makes each one true. The acknowledgement is
 * deliberately local state: it is a confirmation, not configuration, so a
 * reload asks for it again.
 *
 * State (mockup vocabulary): `step-3-what-changes`.
 *
 * @module features/oms-onboarding/components
 */
import type { ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import { omsOnboardingCopy as COPY } from '../lib/oms-onboarding.copy';
import { StepPanel } from './step-panel';

export interface StepWhatChangesProps {
  readonly masterCount: number;
  readonly masterNames: string;
  readonly acknowledged: boolean;
  readonly onAcknowledge: (value: boolean) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

function Node({ title, body, highlight = false }: { title: string; body: string; highlight?: boolean }): ReactElement {
  return (
    <div className={highlight ? 'oms-onboarding__node oms-onboarding__node--highlight' : 'oms-onboarding__node'}>
      <span className="oms-onboarding__node-title">{title}</span>
      <span className="oms-onboarding__node-body">{body}</span>
    </div>
  );
}

function Arrow(): ReactElement {
  return <span className="oms-onboarding__arrow" aria-hidden="true">→</span>;
}

export function StepWhatChanges(props: StepWhatChangesProps): ReactElement {
  const { masterCount, masterNames, acknowledged } = props;
  const two = masterCount > 1;

  return (
    <StepPanel
      step={3}
      why={COPY.step3.why}
      onBack={props.onBack}
      next={
        <Button
          type="button"
          tone="primary"
          data-testid="btn-continue-step-3"
          disabled={!acknowledged}
          onClick={props.onContinue}
        >
          {COPY.continue}
        </Button>
      }
    >
      <p className="oms-onboarding__subtitle">{COPY.step3.flowTitle}</p>
      <div className="oms-onboarding__flows" data-testid="order-flow-diagram">
        <div className="oms-onboarding__flow">
          <span className="oms-onboarding__flow-label">{COPY.step3.today}</span>
          <div className="oms-onboarding__chain">
            <Node title={COPY.step3.buyerTitle} body={COPY.step3.buyerBody} />
            <Arrow />
            <Node title={COPY.step3.olTitle} body={COPY.step3.olTodayBody} />
            <Arrow />
            <Node
              title={masterNames}
              body={two ? COPY.step3.masterTodayTwo : COPY.step3.masterTodayOne(masterNames)}
            />
          </div>
        </div>
        <div className="oms-onboarding__flow oms-onboarding__flow--after">
          <span className="oms-onboarding__flow-label">{COPY.step3.after}</span>
          <div className="oms-onboarding__chain">
            <Node title={COPY.step3.buyerTitle} body={COPY.step3.buyerBody} />
            <Arrow />
            <Node title={COPY.step3.olTitle} body={COPY.step3.olAfterBody} />
            <Arrow />
            <Node title={COPY.step3.benchTitle} body={COPY.step3.benchBody} highlight />
            <Node title={masterNames} body={two ? COPY.step3.masterAfterTwo : COPY.step3.masterAfterOne} />
          </div>
        </div>
      </div>

      <div className="oms-onboarding__boxes" data-testid="order-routing-summary">
        <div className="oms-onboarding__box oms-onboarding__box--in">
          <p className="oms-onboarding__box-title">{COPY.step3.benchBoxTitle}</p>
          <ul>
            {COPY.step3.benchBoxItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
            {two ? <li>{COPY.step3.benchBoxTwo}</li> : null}
          </ul>
        </div>
        <div className="oms-onboarding__box">
          <p className="oms-onboarding__box-title">{COPY.step3.waitBoxTitle}</p>
          <ul>
            {COPY.step3.waitBoxItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="oms-onboarding__box">
          <p className="oms-onboarding__box-title">{COPY.step3.sameBoxTitle}</p>
          <ul>
            {COPY.step3.sameBoxItems(masterNames).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <p className="oms-onboarding__subtitle">{COPY.step3.changesTitle}</p>
        <ul className="oms-onboarding__changes" data-testid="what-changes-list">
          {COPY.step3.changes(masterNames).map((change) => (
            <li key={change.title}>
              <span className="oms-onboarding__changes-mark" aria-hidden="true">
                !
              </span>
              <span>
                <strong>{change.title}</strong>
                <span className="oms-onboarding__changes-body">{change.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <label className="oms-onboarding__ack" data-testid="ack-what-changes">
        <input
          type="checkbox"
          data-testid="input-ack"
          checked={acknowledged}
          onChange={(event) => props.onAcknowledge(event.target.checked)}
        />
        <span>{COPY.step3.ack(masterNames)}</span>
      </label>
    </StepPanel>
  );
}
