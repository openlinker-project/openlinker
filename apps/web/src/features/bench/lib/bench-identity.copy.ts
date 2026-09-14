/**
 * Pack-bench identity copy (#2413, stories A2–A4, ADR-071)
 *
 * One copy source for the three designed states in the `bench-identity`
 * mockup — locked, sign in, handover — so the overlay and the identity bar
 * cannot drift apart.
 *
 * ## What this copy is NOT allowed to say
 *
 * - **Nothing about the order, ever, on the locked screen.** A shared floor
 *   terminal is routinely unattended, so no reference, no buyer, no address and
 *   nothing about what is in the box. The mockup states this to the packer in
 *   as many words, and `bench-surface.test.tsx` asserts the locked
 *   state renders no descendant of the bench body.
 * - **No "authority", no "posture", no "FulfillmentWork".** The epic's P9
 *   naming rule, enforced for this folder by `scripts/check-ui-vocabulary.mjs`.
 * - **Not "PIN", not "badge".** ADR-071 rejects all three credentials; copy
 *   that implies one would advertise a sign-in this product does not have.
 *
 * @module apps/web/src/features/bench/lib
 */

export const benchIdentityCopy = {
  bar: {
    /** Story A4: visible without opening a menu, beside the item being scanned. */
    signedInLabel: 'Signed in',
    signedOutLabel: 'Nobody is signed in',
    switchAction: 'Switch packer',
    switchHint: 'One tap, without leaving the box',
  },
  locked: {
    title: 'This bench is locked',
    body: 'Sign in to carry on. Nothing about the order that was open is shown here — no reference, no buyer, no address, nothing about what is in the box.',
    /** Why the box is still open behind the lock, said plainly. */
    progressReassurance: 'Nothing has been lost. The box is exactly as it was left.',
    unlockAction: 'Sign in',
  },
  signIn: {
    title: 'Sign in to this bench',
    body: 'Use your own account. It works at any bench in this warehouse.',
    submitAction: 'Sign in',
  },
  handover: {
    title: 'Handing the bench over',
    body: 'The next person to finish this box is the one recorded as having packed it. Check what has already been verified before you take it on.',
    confirmAction: 'Sign in as someone else',
    cancelAction: 'Stay signed in',
  },
} as const;
