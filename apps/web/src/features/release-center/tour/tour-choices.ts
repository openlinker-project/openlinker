/**
 * Tour choices (#4149)
 *
 * The settings a tour step lets an administrator decide in place. Pure so the
 * config merge is testable: a connection's `config` is replaced wholesale by
 * the API, so a choice must be written over the current config, never alone.
 *
 * @module features/release-center/tour
 */

export interface TourChoice {
  id: string;
  /** Value written at the step's config path. */
  value: boolean;
}

export interface TourChoiceSpec {
  /** Path inside `connection.config`. */
  path: readonly string[];
  choices: readonly TourChoice[];
}

/** Steps that carry choices. Others (routing) are looked at, not decided here. */
export const TOUR_CHOICES: Readonly<Record<string, TourChoiceSpec>> = {
  'packing-owner': {
    path: ['fulfilmentOwnedByDestination'],
    choices: [
      { id: 'ownPacking', value: false },
      { id: 'externalPacking', value: true },
    ],
  },
  'inpost-notify-buyer': {
    path: ['shipping', 'notifyMarketplaceOnLabelPurchase'],
    choices: [
      { id: 'notifyNow', value: true },
      { id: 'notifyLater', value: false },
    ],
  },
};

type Config = Readonly<Record<string, unknown>>;

export function readChoice(spec: TourChoiceSpec, config: Config): string | null {
  const value = spec.path.reduce<unknown>(
    (acc, key) => (typeof acc === 'object' && acc !== null ? (acc as Config)[key] : undefined),
    config
  );
  if (typeof value !== 'boolean') return null;
  return spec.choices.find((choice) => choice.value === value)?.id ?? null;
}

export function applyChoice(spec: TourChoiceSpec, config: Config, choiceId: string): Config | null {
  const choice = spec.choices.find((c) => c.id === choiceId);
  if (!choice) return null;
  const write = (node: Config, path: readonly string[]): Config => {
    const [head, ...rest] = path;
    if (rest.length === 0) return { ...node, [head]: choice.value };
    const child = node[head];
    const base = typeof child === 'object' && child !== null ? (child as Config) : {};
    return { ...node, [head]: write(base, rest) };
  };
  return write(config, spec.path);
}
