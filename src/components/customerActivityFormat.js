const money=value=>Number(value||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
export const formatSignedMinor=value=>Number.isSafeInteger(value)?`${value>0?'+':value<0?'−':''}${money(Math.abs(value)/100)}`:'Unavailable';

// These are source-provided effects. Missing one side means the change is
// incomplete, so do not infer a zero or net debt against store credit.
export function formatBalanceChange(event){
  const {debtEffectMinor:debt,creditEffectMinor:credit}=event;
  if(!Number.isSafeInteger(debt)||!Number.isSafeInteger(credit))return 'Unavailable';
  if(debt===0&&credit===0)return '—';
  if(debt!==0&&credit===0)return formatSignedMinor(debt);
  if(debt===0&&credit!==0)return `Credit ${formatSignedMinor(credit)}`;
  return `Debt ${formatSignedMinor(debt)} · Credit ${formatSignedMinor(credit)}`;
}

export function formatCustomerDate(value){
  if(!value)return 'Recorded date unavailable';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return 'Recorded date unavailable';
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Karachi',day:'2-digit',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).formatToParts(date);
  const part=type=>parts.find(item=>item.type===type)?.value;
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')} ${part('dayPeriod')?.toUpperCase()}`;
}
