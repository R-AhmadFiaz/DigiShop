import { useState } from 'react';
import { api, query } from '../../api/client';
import { useDebounce, useLoad } from '../../api/hooks';
import { pkr, pakistanTime, minorAmount } from '../../api/purchases';
import { Empty, Field, Modal, Notice, PageTitle, Pagination } from '../../components/Common';
import SupplierAction from '../../components/SupplierAction';

const root = '/accounts/expenses';
const expenseTime = value => value ? new Date(value).toLocaleString('en-PK',{timeZone:'Asia/Karachi',dateStyle:'medium',timeStyle:'medium'}) : 'Unavailable';
export default function Expenses() {
  const [month,setMonth]=useState(()=>new Date(Date.now()+5*3600000).toISOString().slice(0,7));
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[creating,setCreating]=useState(false),[selected,setSelected]=useState(null);
  const [categoryName,setCategoryName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
  const setup=useLoad(root+'/setup'),categories=useLoad(root+'/categories');
  const term=useDebounce(search),list=useLoad(root+query({month,q:term,page,limit:20}));
  const detail=useLoad(selected?root+'/'+selected:root+'/setup');
  function changed(){list.reload();detail.reload();setup.reload();setCreating(false);}
  async function addCategory(event){
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    try{await api(root+'/categories',{method:'POST',body:{name:categoryName}});setCategoryName('');categories.reload();setSuccess('Category saved.');}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <>
    <PageTitle title="Expenses"/>
    <p className="text-body-secondary">Operating costs only. Purchases, supplier payments and customer refunds are recorded separately.</p>
    <Notice loading={setup.loading} error={setup.error||error} success={success}/>
    {!setup.loading&&(!setup.data?.available||!setup.data?.accounts?.length)&&<div className="alert alert-warning">Expense posting unavailable. Activated accounting and a prepared cash/bank account are required. No expense payment will be recorded.</div>}
    <form className="d-flex gap-2 mb-3" onSubmit={addCategory}><input aria-label="New expense category" className="form-control" value={categoryName} onChange={e=>setCategoryName(e.target.value)} placeholder="Category, e.g. rent or electricity" maxLength={80} required/><button className="btn btn-outline-secondary text-nowrap" disabled={busy||!categoryName.trim()}>Add category</button></form>
    <SupplierAction operation="expense-operation" onChanged={changed}>{({prepare,locked})=><>
      <button className="btn btn-primary mb-3" disabled={locked||!setup.data?.available||!setup.data?.accounts?.length} onClick={()=>{setCreating(true);setError('');}}>Record expense</button>
      <div className="row g-2 mb-3"><div className="col-sm-4"><Field label="Month (Pakistan time)"><input type="month" className="form-control" value={month} onChange={e=>{setMonth(e.target.value);setPage(1);}}/></Field></div><div className="col-sm-8"><Field label="Search expenses"><input className="form-control" maxLength={100} placeholder="Category, description, account or reference" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></Field></div></div>
      <Notice loading={list.loading} error={list.error}/>
      {list.data&&<><p className="fw-semibold">Net expenses: {pkr(list.data.totalMinor)}</p><p className="text-body-secondary">Selected month and search. Reversals reduce expenses on their actual dates. This is not a profit calculation.</p><div className="d-flex flex-wrap gap-3 mb-3">{list.data.breakdown.map(row=><span key={row.categoryId}>{row.category}: <strong>{pkr(row.netMinor)}</strong></span>)}</div>
        <div className="table-responsive"><table className="table table-sm"><thead><tr><th>Date / time (Pakistan)</th><th>Category</th><th>Description</th><th>Amount</th><th>Paid from</th><th>Activity</th><th/></tr></thead><tbody>{list.data.entries.map(row=><tr key={row._id}><td>{expenseTime(row.occurredAt)}</td><td>{row.categoryName}</td><td>{row.description}</td><td>{pkr(row.amountMinor)}</td><td>{row.accountName} ({row.accountKind==='CASH'?'Cash':'Bank'})</td><td>{row.kind==='EXPENSE'?'Expense':'Reversal'}</td><td><button className="btn btn-outline-secondary btn-sm" onClick={()=>setSelected(row._id)}>Details</button></td></tr>)}</tbody></table></div>{!list.data.entries.length&&<Empty>No expenses for this selection.</Empty>}<Pagination pagination={list.data.pagination} onPage={setPage}/></>}
      {creating&&<Modal title="Record expense" busy={locked} onClose={()=>setCreating(false)}><form onSubmit={event=>{
        event.preventDefault();if(locked)return;setError('');const values=Object.fromEntries(new FormData(event.currentTarget));
        try{const amountMinor=minorAmount(values.amount);if(amountMinor<=0)throw new Error('Enter a positive amount.');const occurredAt=new Date(values.date+'+05:00').toISOString();
          prepare({path:root,title:'Confirm expense payment',summary:`${pkr(amountMinor)} — ${values.description}\n${pakistanTime(occurredAt)}\nConfirm this payment has actually been made from the selected account.`,body:{requestKey:crypto.randomUUID(),amountMinor,categoryId:values.categoryId,accountId:values.accountId,occurredAt,description:values.description,reference:values.reference}});
        }catch(e){setError(e.message);}
      }}><fieldset disabled={locked}><Notice error={error}/><Field label="Category"><select name="categoryId" className="form-select" required><option value="">Select category</option>{categories.data?.entries.map(row=><option key={row._id} value={row._id}>{row.name}</option>)}</select></Field><Field label="Amount (PKR)"><input name="amount" type="number" min="0.01" step="0.01" className="form-control" required/></Field><Field label="Paid from"><select name="accountId" className="form-select" required><option value="">Select cash or bank account</option>{setup.data?.accounts.map(row=><option key={row._id} value={row._id}>{row.name} ({row.kind})</option>)}</select></Field><Field label="Date and time (Pakistan)"><input name="date" type="datetime-local" step="0.001" defaultValue={new Date(Date.now()+5*3600000).toISOString().slice(0,23)} className="form-control" required/></Field><Field label="Description"><input name="description" maxLength={300} className="form-control" required/></Field><Field label="Reference (optional)"><input name="reference" maxLength={100} className="form-control"/></Field><button className="btn btn-primary">Review payment</button></fieldset></form></Modal>}
      {selected&&<Modal title="Expense details" busy={locked} onClose={()=>setSelected(null)}><Notice loading={detail.loading} error={detail.error}/>{detail.data?.expense&&<>
        <p><strong>{detail.data.expense.categoryName} — {pkr(detail.data.expense.amountMinor)}</strong></p><p>{detail.data.expense.description}</p><p>Paid from: {detail.data.expense.accountName} ({detail.data.expense.accountKind})</p><p>Effective: {expenseTime(detail.data.expense.occurredAt)}<br/>Recorded: {expenseTime(detail.data.expense.recordedAt)}<br/>Recorded by: {detail.data.expense.createdByName}<br/>Reference: {detail.data.expense.reference||'None'}</p>
        {detail.data.expense.kind==='EXPENSE_REVERSAL'&&<p>Reversal of a previously recorded expense. Original history is preserved.</p>}
        {detail.data.reversal&&<p className="alert alert-info">Reversed on {expenseTime(detail.data.reversal.occurredAt)}. {detail.data.reversal.description}</p>}
        {detail.data.expense.kind==='EXPENSE'&&!detail.data.reversal&&<form onSubmit={event=>{event.preventDefault();if(locked)return;const values=Object.fromEntries(new FormData(event.currentTarget));prepare({path:root+'/'+selected+'/reverse',title:'Confirm expense reversal',summary:`Restore ${pkr(detail.data.expense.amountMinor)} to ${detail.data.expense.accountName}. Confirm the original funds have actually been returned. This preserves the original expense.`,body:{requestKey:crypto.randomUUID(),occurredAt:new Date().toISOString(),description:values.reason,confirmation:'CONFIRM EXPENSE REVERSAL'}});}}><fieldset disabled={locked||!setup.data?.available}><Field label="Correction reason"><input name="reason" className="form-control" maxLength={300} required/></Field><button className="btn btn-outline-danger">Review reversal</button><p className="small text-body-secondary mt-2">Only reverse after the original funds have been restored. Then record a corrected expense if needed.</p></fieldset></form>}
      </>}</Modal>}
    </>}</SupplierAction>
    <Notice error={categories.error}/>
  </>;
}
