/**
 * GiftPrecedence
 *
 * Where a gift gets its form, drawn as three nodes: the promotion, the
 * connection, the OpenLinker default. The most specific one that sets a form
 * wins; three example chips light the winner and say why in a sentence, so the
 * rule can be tried rather than read.
 *
 * @module apps/web/src/features/gift-documents/components
 */
import { useState, type ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { HelpHint } from '../../../shared/ui/help-hint';

type Winner = 1 | 2 | 3;

export function GiftPrecedence(): ReactElement {
  const copy = useMessages('gift-documents').settings;
  const [winner, setWinner] = useState<Winner>(3);
  const scenarios: ReadonlyArray<{ id: Winner; label: string; says: string }> = [
    { id: 1, label: copy.scenarioRule, says: copy.saysRule },
    { id: 2, label: copy.scenarioChannel, says: copy.saysChannel },
    { id: 3, label: copy.scenarioDefault, says: copy.saysDefault },
  ];
  const nodes = [
    { id: 1 as const, node: copy.nodeRule },
    { id: 2 as const, node: copy.nodeChannel },
    { id: 3 as const, node: copy.nodeDefault },
  ];
  const says = scenarios.find((scenario) => scenario.id === winner)?.says ?? '';
  // The sentence leads with its verdict in bold, as approved: "Wygrywa X." then why.
  const verdictEnd = says.indexOf('. ');
  const verdict = verdictEnd === -1 ? says : says.slice(0, verdictEnd + 1);
  const rest = verdictEnd === -1 ? '' : says.slice(verdictEnd + 1);

  return (
    <div className="form-field gift-precedence">
      <span className="gift-label-row">
        <span className="form-field__label">{copy.precedenceTitle}</span>
        <HelpHint guide="g-prec" label={copy.helpPrecedence} />
      </span>
      <p className="form-field__description">{copy.precedenceHelp}</p>
      <div
        className="gift-precedence__nodes"
        data-win={winner}
        role="group"
        aria-label={copy.precedenceAria}
        data-testid="gift-precedence"
      >
        {nodes.map(({ id, node }, index) => (
          <span key={id} className="gift-precedence__cell">
            {index > 0 ? (
              <span className="gift-precedence__arrow" aria-hidden="true">
                ›
              </span>
            ) : null}
            <span className="gift-precedence__node" data-win={winner === id ? 'true' : undefined}>
              <span className="gift-precedence__key">{node.key}</span>
              <b>{node.title}</b>
              <span>{node.text}</span>
            </span>
          </span>
        ))}
      </div>
      <div className="gift-precedence__scenarios" role="group" aria-label={copy.scenarioAria}>
        <small>{copy.scenarioLabel}</small>
        {scenarios.map((scenario) => (
          <button
            key={scenario.id}
            type="button"
            className={['chip', winner === scenario.id ? 'chip--active' : ''].filter(Boolean).join(' ')}
            aria-pressed={winner === scenario.id}
            onClick={() => setWinner(scenario.id)}
          >
            {scenario.label}
          </button>
        ))}
      </div>
      <p className="gift-precedence__says" aria-live="polite" data-testid="gift-precedence-says">
        <b>{verdict}</b>
        {rest}
      </p>
    </div>
  );
}
