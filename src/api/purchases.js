import { amount } from './invoice.js';

export const pkr = minor => Number.isSafeInteger(minor) ? 'PKR ' + (minor / 100).toLocaleString('en-PK', {minimumFractionDigits:2,maximumFractionDigits:2}) : 'Unavailable';
export const pakistanTime = value => value ? new Date(value).toLocaleString('en-PK', {timeZone:'Asia/Karachi',dateStyle:'medium',timeStyle:'short'}) : 'Unavailable';
const activityNames = {
  SUPPLIER_PAYABLE:'We owe supplier', CUSTOMER_RECEIVABLE:'Customer owes us',
  STORE_CREDIT_LIABILITY:'Customer store credit', SUPPLIER_CREDIT:'Supplier owes us',
  OPENING_EQUITY:'Starting business value', PURCHASES_CLEARING:'Received-goods account',
  SETTLEMENT_CLEARING:'Invoice money account', OPENING:'Starting balance',
  SUPPLIER_OPENING:'Supplier starting balance', REVERSAL:'Correction',
  INVOICE_RECEIPT:'Money received on invoice', INVOICE_REFUND:'Invoice refund paid',
  PURCHASE_RECEIPT:'Goods received', SUPPLIER_PAYMENT:'Money paid to supplier',
  SUPPLIER_RETURN:'Goods returned to supplier', SUPPLIER_REFUND:'Refund received from supplier',
  SUPPLIER_CREDIT_APPLICATION:'Supplier credit used', SUPPLIER_REVERSAL:'Supplier correction',
  CAPITAL_CONTRIBUTION:'Money added to business', CAPITAL_WITHDRAWAL:'Money taken out',
  CAPITAL_REVERSAL:'Partner money corrected', EXPENSE_REVERSAL:'Expense corrected',
  CREDIT_REDEEMED:'Store credit used', CREDIT_RESTORED:'Store credit returned',
  CREDIT_ISSUED:'Store credit given', PARTNER_CAPITAL:'Partner business money',
};
export const activity = value => activityNames[value] || (value || 'Recorded activity').replaceAll('_',' ').toLowerCase().replace(/^./,s=>s.toUpperCase());
export const accountName = account => account.name?.trim().toUpperCase().replaceAll(' ','_') === account.kind ? activity(account.kind) : account.name;
export function minorAmount(value) { return Math.round(amount(value,'an amount') * 100); }
export function purchaseItems(rows) {
  if (!rows.length) throw new Error('Add at least one product.');
  return rows.map(row => {
    const quantity=Number(row.quantity);
    if (!Number.isSafeInteger(quantity)||quantity<1) throw new Error('Enter whole positive quantities.');
    const unitCostMinor=minorAmount(row.cost);
    if (!Number.isSafeInteger(quantity*unitCostMinor)) throw new Error('Purchase value is too large.');
    return {productId:row._id,quantity,unitCostMinor};
  });
}
export function quantityItems(rows,values,remaining) {
  const items=rows.flatMap(row=>{
    const raw=values[row.productId];
    if(raw===undefined||raw===''||Number(raw)===0)return [];
    const quantity=Number(raw);
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>remaining(row))throw new Error('Check quantities against the available units.');
    return [{productId:row.productId,quantity}];
  });
  if(!items.length)throw new Error('Enter at least one quantity.');
  return items;
}
export function returnQuantities(receipt,events) {
  return Object.fromEntries(receipt.items.map(row=>{
    const returned=events.reduce((sum,event)=>sum+(event.kind==='REVERSAL'?-1:1)*event.items.filter(i=>i.productId===row.productId).reduce((n,i)=>n+i.quantity,0),0);
    if(!Number.isSafeInteger(returned)||returned<0||returned>row.quantity)throw new Error('Return history needs review.');
    return [row.productId,{returned,eligible:row.quantity-returned}];
  }));
}
