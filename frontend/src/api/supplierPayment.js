import {minorAmount} from './purchases';
export function verifiedPayable(result){
  return result?.authoritative===true&&!!result.cutover&&result.issues?.length===0&&Number.isSafeInteger(result.balanceMinor)&&result.balanceMinor>=0&&Number.isSafeInteger(result.creditMinor)&&result.creditMinor>=0;
}
export function paymentAmount(value,balance,available){
  const amountMinor=minorAmount(value);
  if(amountMinor<=0||amountMinor>balance)throw Error('Enter a positive payment no greater than the outstanding payable.');
  if(!Number.isSafeInteger(available)||amountMinor>available)throw Error('The selected account does not have enough available money.');
  return amountMinor;
}
export function samePayable(result,snapshot){
  return verifiedPayable(result)&&String(result.cutover._id)===String(snapshot.cutover._id)&&result.balanceMinor===snapshot.balanceMinor&&result.creditMinor===snapshot.creditMinor;
}
export const paymentRecorded='digishop:supplier-payment';
