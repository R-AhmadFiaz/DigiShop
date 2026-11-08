// Presentation policy only. The receiving transaction remains the authority.
export function receivingSetup(availability, reconciliation) {
  if (availability.data?.accountingEnabled === false) return {
    kind: 'stock-only', blocked: false,
    message: 'Financial posting is off. Stock-only deliveries are not confirmed supplier debt and do not make a payment.',
  };
  if (availability.loading) return {kind: 'checking', blocked: true, message: 'Checking supplier setup...'};
  if (availability.data?.accountingEnabled !== true) return {
    kind: 'unverified', blocked: false,
    message: 'Supplier setup could not be checked. You can review the delivery; any required supplier checks still apply when recording.',
  };
  if (reconciliation.loading) return {kind: 'checking', blocked: true, message: 'Checking supplier setup...'};
  const result = reconciliation.data;
  if (reconciliation.error || !result || typeof result.authoritative !== 'boolean' || !Object.hasOwn(result, 'cutover') || !Array.isArray(result.issues)) return {
    kind: 'unavailable', blocked: true,
    message: 'Supplier setup could not be verified. Check again or review Supplier Khata before receiving.',
  };
  if (result.authoritative === true && result.cutover && Array.isArray(result.issues) && result.issues.length === 0)
    return {kind: 'ready', blocked: false, message: ''};
  if (result.cutover === null) return {
    kind: 'opening', blocked: true,
    message: 'Confirm this supplier\'s starting balance before receiving. Open Supplier Khata, choose Confirm previous supplier balance, and review earlier debt and deliveries.',
  };
  return {
    kind: 'review', blocked: true,
    message: 'This supplier\'s starting balance is already recorded, but the records need reconciliation. Review the warnings in Supplier Khata. Do not create another opening or reset the balance.',
  };
}

export function receivingError(error, request) {
  if (error.status === 409 && /^\/purchases\/[^/]+\/receipts$/.test(request?.path || '') &&
      /supplier payable cutover or reconciliation incomplete/i.test(error.message))
    return 'Supplier records need review before receiving. Open Supplier Khata to complete the starting-balance check or resolve reconciliation warnings, then check setup again. This attempt changed no stock or payment.';
  return error.message;
}
