/**
 * Packing onboarding copy (#3457)
 *
 * Every operator-facing sentence of the "Pack orders in OpenLinker" wizard and
 * its status page, in one file so the wizard, the status view and the tile
 * cannot drift apart, and so `scripts/check-ui-vocabulary.mjs` scans it.
 *
 * The sentences in step 3 describe what the backend actually does once packing
 * is on. Each one names the issue that makes it true, so a reviewer can check
 * it against the code rather than against the mockup:
 *
 * - a routed order is not created in the product master        #3485
 * - the product master's stock is lowered per line, once       #3453
 * - out of stock / no address / routing error waits in Orders  #3485
 * - the operator's own shop orders are not routed              #3487
 * - orders the marketplace ships itself are not routed         #3488
 * - an order already sent before is not routed on re-download  #3455
 *
 * @module features/oms-onboarding/lib
 */

export const omsOnboardingCopy = {
  page: {
    eyebrow: 'Connections',
    backToConnections: 'Add a connection',
    wizardTitle: 'OpenLinker OMS',
    wizardDescription:
      'Pick and pack orders on one screen, with a barcode scanner. Setup takes about 5 minutes. Nothing changes in how your orders are handled until the last step.',
    statusTitle: 'OpenLinker OMS',
    statusDescription:
      'What OpenLinker takes over: packing at the pack bench, then sales documents and automations. You can stop packing at any time.',
    loadingTitle: 'Loading packing setup',
    loadingMessage: 'Reading your connections, locations and stock.',
    errorTitle: 'Could not load the packing setup',
    errorMessage: 'Something went wrong while reading your setup. Try again.',
    retry: 'Try again',
  },

  steps: [
    { title: 'Your product master', meta: 'Products and stock' },
    { title: 'Sales documents', meta: 'Invoices and receipts' },
    { title: 'Add packers', meta: 'Optional' },
    { title: 'See what changes', meta: 'Read before turning on' },
    { title: 'Automations', meta: 'Review only' },
    { title: 'Who decides what', meta: 'Review' },
    { title: 'Turn it on', meta: 'Last step' },
  ],
  stepOf: (step: number, total: number): string => `Step ${String(step)} of ${String(total)}`,
  salesDocumentsStep: {
    why: 'Decide which document each order gets: an invoice or a receipt. Connect a provider that issues them, then say what each one issues, which goes first, and whether it issues by itself once an order is paid.',
    noConnectionTitle: 'No invoicing or fiscal receipt connection yet',
    noConnectionBody:
      'Connect a provider that issues invoices (for example inFakt, KSeF or Subiekt) or fiscal receipts (for example eparagony) first. Then come back here to choose what it issues.',
    addConnection: 'Add a connection',
    automaticRequiredTitle: 'Documents must be issued automatically',
    automaticRequiredBody:
      'Choose what a connection issues, mark it Primary, and set its Trigger to an automatic option (for example Auto on order paid). With the Trigger on Manual, nothing is issued unless someone does it by hand.',
    perCountry:
      'Rules for a particular country, or a default for orders no rule covers, are set on the document routing page.',
    openRouting: 'Open document routing',
  },
  setupSteps: {
    finish: 'Finish',
    review: 'Review',
    notNeeded: 'Not needed',
    undo: 'Undo',
    state: {
      done: 'Already set up',
      pending: 'Not set up yet',
      none: 'None yet',
      skipped: 'Marked as not needed',
      unknown: 'Could not check this right now',
    },
    salesDocuments: {
      why: 'Packing works. Next, decide which document each order gets: an invoice or a receipt, country by country.',
      detail: 'Document routing is configured on its own page. You can come back here when you are done.',
      open: 'Open document routing',
    },
    automations: {
      why: 'Automations let OpenLinker act by itself when something happens, for example buy the shipping label as soon as an order is packed. Nothing is set here: this is a look at what exists.',
      detail: 'Automations live on their own page. Review them, or add more, whenever you like.',
      open: 'Open automations',
    },
    whoDecides: {
      why: 'Check which system decides stock, packing and returns. Anything that needs your attention is listed there.',
      detail: 'This is a review, not a form: nothing here changes until you choose an arrangement.',
      open: 'Open who decides what',
    },
  },
  back: 'Back',
  continue: 'Continue',
  adminOnly: 'Only an admin can change the packing setup.',

  /** The created packing connection's name. Renamable on its connection page. */
  packingConnectionName: 'OpenLinker OMS',

  step1: {
    why: 'OpenLinker has no products or stock of its own. It reads them from your product master.',
    noMasterWhy:
      'OpenLinker has no products or stock of its own. It reads them from your product master. Connect it first.',
    noMasterTitle: 'No product master connected yet',
    noMasterBody:
      'Connect the product master that holds your products and stock, for example PrestaShop, WooCommerce or Subiekt GT. Then come back here.',
    connectMaster: 'Connect your product master',
    capabilityProducts: 'Products',
    capabilityStock: 'Stock',
    masterBadge: 'Your product master',
    partialTitle: 'Not usable as a product master yet',
    partialBody: (name: string, missing: string): string =>
      `${name} does not share its ${missing} with OpenLinker. Turn it on in the connection's settings.`,
    missingProducts: 'products',
    missingStock: 'stock',
    missingBoth: 'products and stock',
    openConnection: 'Open connection',
    twoTitle: 'Both product masters send stock to this one place',
    twoBody:
      'Keep each product in one product master only. If the same product is in both, OpenLinker sees two different products with two separate stock counts. A sale lowers the stock only in the product master it came from, so the other one can still sell the last units.',
    tooManyTitle: 'Too many product masters',
    tooManyBody: (count: number): string =>
      `You have ${String(count)} product masters. Packing in OpenLinker works with one or two for now. Turn off the ones you do not need, then come back here.`,
    conflictTitle: 'Stock already points somewhere else',
    conflictBody: (name: string): string =>
      `${name} already sends its stock to another place. Packing in OpenLinker uses one warehouse for now, so change that in the connection's settings first.`,
    mainInactiveTitle: 'The warehouse is switched off',
    mainInactiveBody:
      'The warehouse OpenLinker packs from is marked inactive. Turn it back on in Inventory › Locations, then confirm again.',
    openLocations: 'Open locations',
    confirm: 'Confirm',
    confirming: 'Setting up…',
    failedTitle: 'Setup did not finish',
    failedStep: {
      connection: 'Could not create the packing connection.',
      location: 'Could not create the warehouse.',
      override: (name: string): string => `Could not point the stock of ${name} at the warehouse.`,
    },
    failedHint: 'Nothing is lost. Confirm again to continue from where it stopped.',
    progressLabel: (names: string): string => `Stock from ${names} up to date`,
    progressCount: (located: string, total: string): string => `${located} of ${total}`,
    progressAria: 'Stock up to date',
    completeTitle: 'All stock is up to date',
    completeBody: 'OpenLinker can now pack every product.',
    syncingTitle: (names: string): string => `Filling in with each stock sync from ${names}`,
    syncingBody: (total: string): string =>
      `You don't need to wait here. Until it reaches ${total}, an order for a product not counted yet is handled the old way.`,
    noStockYetBody:
      "OpenLinker has not received any stock yet. It arrives with the next stock sync. You don't need to wait here.",
  },

  step2: {
    why: 'Create a login for each person who packs. They see the pack bench and nothing else. You can skip this and pack yourself: admins and operators can open the pack bench too.',
    addTitle: 'Add a packer',
    nameLabel: 'Name',
    namePlaceholder: 'Anna Nowak',
    loginLabel: 'Login',
    loginPlaceholder: 'anna',
    loginHint: 'What they type at the pack bench to sign in.',
    emailLabel: 'Email',
    emailOptional: '(optional)',
    emailPlaceholder: 'anna@example.com',
    emailHint: 'Leave empty if the packer has no work email. The role is always Packer.',
    add: 'Add packer',
    adding: 'Adding…',
    nameRequired: 'Enter a name.',
    loginRequired: 'Enter a login.',
    loginNoAt: 'A login cannot contain "@".',
    emailInvalid: 'Enter a valid email address, or leave it empty.',
    loginTaken: 'That login is already taken. Pick another one.',
    emailTaken: 'That email is already used by another account.',
    createFailedTitle: 'Could not add the packer',
    createdTitle: (name: string): string => `${name} can sign in now`,
    createdBody: (login: string): string =>
      `Give them the login ${login} and the password below. It is shown only once. They are asked to change it at first sign-in.`,
    tempPasswordLabel: 'Temporary password',
    copy: 'Copy password',
    copied: 'Copied',
    listTitle: (count: number): string => `Packers (${String(count)})`,
    loginPrefix: 'Login:',
    packerBadge: 'Packer',
    unassignedTitle: 'New orders start as Unassigned',
    unassignedBody:
      'Any packer can pick up an unassigned order at the pack bench. To give an order to a specific person, assign it on the Fulfilment page.',
    existingSummary: 'Someone already has an account?',
    existingBody: 'Change their role to Packer in',
    usersLink: 'Users',
    skip: 'Skip for now',
  },

  step3: {
    why: 'Read this before you turn it on. You can turn it off with one click, but orders already sent to the pack bench stay there.',
    flowTitle: 'How a marketplace order travels',
    today: 'Today',
    after: 'After you turn it on',
    buyerTitle: 'Allegro, Erli',
    buyerBody: 'A customer buys',
    olTitle: 'OpenLinker',
    olTodayBody: 'Downloads the order and passes it on',
    olAfterBody: 'Keeps the order',
    benchTitle: 'Fulfilment → Pack bench',
    benchBody: 'Arrives as Unassigned. A packer picks it up, scans and packs it.',
    masterTodayOne: (name: string): string => `Gets the order. Stock goes down there. You pack from ${name}.`,
    masterTodayTwo:
      'Both get the order. Each shop takes only its own products, so an order with products from both fails in one of them.',
    masterAfterOne: "Doesn't get the order. Only the stock of the sold products goes down.",
    masterAfterTwo: "Don't get the order. Stock goes down in the shop that sells each product.",
    benchBoxTitle: 'Goes to the pack bench',
    benchBoxItems: [
      'New orders from Allegro, Erli and your other marketplaces, placed after you turn it on',
      'When every product is in stock and the order has a delivery address',
    ],
    benchBoxTwo: 'An order with products from both shops is packed as one parcel',
    waitBoxTitle: 'Waits for you in Orders',
    waitBoxItems: ['An order where even one product is out of stock', 'An order with no delivery address'],
    sameBoxTitle: 'Stays as it is today',
    sameBoxItems: (names: string): string[] => [
      `Orders from your ${names} store. You pack them there.`,
      'Orders the marketplace ships itself, for example Allegro One Fulfillment',
      `Orders already in ${names} before you turn it on`,
    ],
    changesTitle: 'What changes for you',
    changes: (names: string): Array<{ title: string; body: string }> => [
      {
        title: 'Marketplace orders stay in OpenLinker.',
        body: `They no longer appear as orders in ${names}, and sales reports there won't include them. Only the stock of the sold products goes down there.`,
      },
      {
        title: 'You buy labels in OpenLinker.',
        body: 'In Orders, or with an automation that buys one when an order is packed. Then Allegro and Erli get the shipped status and the tracking number.',
      },
      {
        title: 'The pack bench prints the label and the invoice.',
        body: "It doesn't create them. Invoices and receipts follow your Sales documents settings, as today.",
      },
      {
        title: 'It applies to all your marketplaces at once.',
        body: "You can't turn it on for Allegro only.",
      },
    ],
    ack: (names: string): string =>
      `I understand that marketplace orders stay in OpenLinker, and only stock goes down in ${names}.`,
  },

  step4: {
    why: 'Everything is ready. From the moment you turn it on, new orders go to the pack bench.',
    masters: (count: number): string => (count > 1 ? 'Your product masters' : 'Your product master'),
    stock: 'Stock up to date',
    stillFilling: 'still filling in',
    packers: 'Packers',
    noPackers: 'No packers yet, admins and operators can pack',
    view: 'View',
    change: 'Change',
    turnOn: 'Start packing in OpenLinker',
    turningOn: 'Turning on…',
    otherSystemTitle: 'Another system already decides where orders are packed',
    otherSystemBody:
      'Turning this on now would leave two systems deciding the same thing, and OpenLinker would stop deciding at all. Check it on the Who decides what page first.',
    whoDecidesLink: 'Open Who decides what',
    noLocationTitle: 'There is no active warehouse to pack from',
    noLocationBody: 'Go back to step 1 and confirm your product master again. That creates it.',
    failedTitle: 'Could not turn packing on',
  },

  status: {
    onTitle: 'Packing is on',
    onBodyWaiting: 'New orders now go to the pack bench.',
    onBody: (count: number, ago: string | null): string =>
      count === 0
        ? 'Nothing on Fulfilment yet.'
        : `${String(count)} ${count === 1 ? 'parcel' : 'parcels'} on Fulfilment${ago === null ? '' : ` · last one arrived ${ago}`}`,
    continueSetup: 'Continue setup',
    partialTitle: 'OMS is partially set up',
    setUpTitle: 'OMS is set up',
    stepsLeft: (count: number): string =>
      `Packing works. ${String(count)} ${count === 1 ? 'step is' : 'steps are'} left.`,
    offTitle: 'Fulfilment is off',
    offBody: (names: string): string =>
      `New orders go to ${names} and are packed there, as before. Your stock setup is kept.`,
    openFulfilment: 'Open Fulfilment',
    openBench: 'Open pack bench',
    goToStatus: 'Go to status',
    stop: 'Turn off fulfilment',
    startAgain: 'Turn fulfilment back on',
    starting: 'Starting…',
    setupTitle: 'Setup',
    open: 'Open',
    addPackers: 'Add packers',
    steps: {
      setUp: 'Set up',
      review: 'Review',
      notNeeded: 'Not needed',
      undo: 'Undo',
      salesDocuments: {
        title: 'Sales documents',
        pending: 'Documents are issued by hand, or not at all. Mark a connection Primary and set its Trigger to automatic.',
        done: 'Documents are issued automatically.',
      },
      automations: {
        title: 'Automations',
        pending: 'None yet. Optional: let OpenLinker act when an order is packed, for example buy the shipping label.',
        done: 'At least one automation is set up.',
      },
      whoDecides: {
        title: 'Who decides what',
        pending: 'Something needs your attention in who decides stock, packing and returns.',
        done: 'Nothing needs attention.',
      },
      skipped: 'Marked as not needed.',
      unknown: 'Could not check this right now.',
    },
    addPackerDialogBody: 'They sign in at the pack bench with this login.',
    closeDialog: 'Close',
    stockFrom: (located: string, total: string, names: string): string =>
      `${located} of ${total} from ${names}`,
    firstOrderTitle: 'Your first order',
    waitingTitle: 'Waiting for the next order…',
    waitingBody:
      'It shows up here as soon as OpenLinker downloads it, usually within a few minutes. You can leave this page.',
    arrivedTitle: (reference: string): string => `Order ${reference} arrived as Unassigned.`,
    arrivedMeta: (products: number, ago: string): string =>
      `${String(products)} ${products === 1 ? 'product' : 'products'} · ${ago} · any packer can pick it up, or assign it on Fulfilment`,
    arrivedStock: (names: string): string =>
      `Stock goes down in ${names}. The order itself stays in OpenLinker.`,
    toggleFailedTitle: 'Could not change packing',
  },

  /**
   * Shown once packing is on. Turning packing on hands the fulfilment flow to
   * OpenLinker, but two things it depends on are configured elsewhere, so the
   * operator is pointed at both — as links, not as prose naming a menu.
   */
  stopDialog: {
    title: 'Turn off fulfilment in OpenLinker?',
    bodyNewOrders: (names: string): string =>
      `New orders will go to ${names} and be packed there, as before.`,
    bodyExisting: (count: number): string =>
      count === 0
        ? 'Nothing is on Fulfilment right now.'
        : `The ${String(count)} ${count === 1 ? 'parcel' : 'parcels'} already at the pack bench stay there. Finish packing them there.`,
    bodyKept:
      'Invoices and receipts are still issued automatically, for new orders too. Your automations keep running. Your stock setup is kept, so you can turn fulfilment back on with one click.',
    cancel: 'Keep it on',
    confirm: 'Turn off fulfilment',
    stopping: 'Turning off…',
  },


  /** How the product masters are named in a sentence when there are two. */
  yourProductMasters: 'your product masters',
  and: ' and ',

} as const;
