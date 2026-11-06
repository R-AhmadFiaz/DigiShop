export function paymentAccountState(paymentAccounts, accountId, required) {
  if (!required) return 'not-required';
  if (paymentAccounts.loading) return 'loading';
  if (paymentAccounts.error) return 'unavailable';
  if (!paymentAccounts.data) return 'unavailable';
  if (paymentAccounts.data?.accountingEnabled !== true) return 'accounting-off';
  const accounts = Array.isArray(paymentAccounts.data.accounts) ? paymentAccounts.data.accounts : [];
  if (!accounts.length) return 'empty';
  return accounts.some(account => String(account._id) === String(accountId)) ? 'selected' : 'choose';
}
