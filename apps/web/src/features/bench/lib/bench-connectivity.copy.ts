/**
 * Pack-bench connectivity copy (#3422, on #3407's decision)
 *
 * The words of the connectivity readout. Split out of the retired bench-only
 * topbar's copy module (#3653) - the crumb and "Leave the bench" strings went
 * with that topbar, since `/bench` now renders the application's own.
 *
 * @module apps/web/src/features/bench/lib
 */
export const benchConnectivityCopy = {
  /**
   * The connectivity readout (#3422), worded to #3407's decision.
   *
   * The mockup labels the middle state "Scanner offline" and explains it with
   * "check the USB cable". Nothing here can observe a keyboard-wedge scanner,
   * so that sentence would be a guess dressed as a diagnosis - and its own
   * mockup comment warns that a status claim which turns out false teaches a
   * packer to distrust every other message on the screen. The middle state
   * says what the bench can prove instead.
   *
   * The red state reuses `benchParcelCopy.unreachable.badge` rather than the
   * mockup's red banner, which promises "your last 2 scans haven't synced yet
   * and will as soon as you're back online" - an offline queue
   * `use-bench-reachability.ts` deliberately refuses to build.
   */
  connectivity: {
    ok: { label: 'All systems', detail: 'The bench is talking to OpenLinker.' },
    serverUnreachable: {
      label: 'OpenLinker not answering',
      detail:
        'The network at this bench is fine - OpenLinker is not answering. Nothing already counted is lost. This clears by itself; if it does not, tell whoever looks after OpenLinker.',
    },
    linkDown: {
      label: 'No connection',
      detail:
        'This terminal has no network. Nothing already counted is lost, and new scans are turned down until it is back.',
    },
  },
} as const;
