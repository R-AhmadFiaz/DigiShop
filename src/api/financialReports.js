// Display total only: the complete report must confirm every account balance.
export function cashBankTotal(value){
  if(!value||!['POSTED','POSTED_TEST'].includes(value.status)||!Array.isArray(value.entries))return null;
  let sum=0n;
  for(const account of value.entries){
    if(!['POSTED','POSTED_TEST'].includes(account.status)||!Number.isSafeInteger(account.currentBalanceMinor))return null;
    sum+=BigInt(account.currentBalanceMinor);
  }
  return sum>BigInt(Number.MAX_SAFE_INTEGER)||sum<BigInt(Number.MIN_SAFE_INTEGER)?null:Number(sum);
}
