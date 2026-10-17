import RecordTable, {RecordFacts} from "../../components/RecordTable";
import {useState} from 'react';
import {useAuth} from '../../auth/AuthContext';
import {api,query} from '../../api/client';
import {useDebounce,useLoad} from '../../api/hooks';
import {pkr,minorAmount} from '../../api/purchases';
import {Empty,Field,Modal,Notice,PageTitle,Pagination} from '../../components/Common';
import SupplierAction from '../../components/SupplierAction';

const time=value=>value?new Date(value).toLocaleString('en-PK',{timeZone:'Asia/Karachi',dateStyle:'medium',timeStyle:'medium'}):'Unavailable';
const root='/accounts/partners';
export default function Partners(){
  const {user}=useAuth();
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[creating,setCreating]=useState(false),[editing,setEditing]=useState(null);
  const [existing,setExisting]=useState(false),[businessSearch,setBusinessSearch]=useState(''),[businessPage,setBusinessPage]=useState(1),[business,setBusiness]=useState(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(''),[partnerKey,setPartnerKey]=useState('');
  const [movement,setMovement]=useState(null),[selected,setSelected]=useState(''),[historyPage,setHistoryPage]=useState(1),[historySearch,setHistorySearch]=useState(''),[detailId,setDetailId]=useState(null);
  const setup=useLoad(root+'/setup'),list=useLoad(root+query({q:useDebounce(search),page,limit:20}));
  const businesses=useLoad('/accounts/entities'+query({q:useDebounce(businessSearch),page:businessPage,limit:10}));
  const history=useLoad('/accounts/capital'+query({partnerId:selected,q:useDebounce(historySearch),page:historyPage,limit:20}));
  const detail=useLoad(detailId?'/accounts/capital/'+detailId:root+'/setup');
  const available=setup.data?.available&&setup.data?.accounts?.length>0&&list.data?.available;
  function refresh(){list.reload();setup.reload();history.reload();detail.reload();businesses.reload();setMovement(null);}
  async function savePartner(event){
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    try{
      const values=Object.fromEntries(new FormData(event.currentTarget));
      let body,path=root,method='POST';
      if(editing){path+='/'+editing._id;method='PATCH';body={expectedRevision:editing.revision,...(!editing.customerId?{name:values.name,phoneNo:values.phoneNo,address:values.address}:{})};if(values.partnerActive!==undefined)body.partnerActive=values.partnerActive==='true';}
      else{if(existing&&!business)throw new Error('Choose an existing business.');body=existing?{entityId:business._id,expectedRevision:business.revision}:{key:partnerKey,name:values.name,phoneNo:values.phoneNo,address:values.address};}
      await api(path,{method,body});setCreating(false);setEditing(null);setSuccess('Partner saved.');refresh();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <>
    <PageTitle title="Partners & Capital"><button className="btn btn-primary btn-sm" onClick={()=>{setCreating(true);setExisting(false);setBusiness(null);setPartnerKey(crypto.randomUUID());setError('');}}>Add partner</button></PageTitle>
    <details className="context-help"><summary>About partner money</summary><p>Include the shop owner as a partner. Record money partners add or take out, not loans, salaries or profit shares. These totals are not the cash available; starting business money is not assigned to partners automatically.</p></details>
    <Notice error={setup.error} loading={setup.loading} success={success}/>
    {!available&&!setup.loading&&<div className="alert alert-warning">Finish money-record setup before adding or taking out partner money. Partner details are still available.</div>}
    {list.data?.total&&<div className="panel record-balance mb-3"><strong>Total business capital: {pkr(list.data.total.balanceMinor)}</strong><p className="mb-0">Money added: {pkr(list.data.total.contributionsMinor)} · Money taken out: {pkr(list.data.total.withdrawalsMinor)}</p><details className="context-help"><summary>About these totals</summary>All partners, including partners outside the current search. Reversals correct the original contribution or withdrawal totals.</details></div>}
    <SupplierAction operation="capital-operation" onChanged={refresh}>{({prepare,locked})=><>
      <Field label="Find partner"><input className="form-control" value={search} maxLength={100} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Name or phone"/></Field>
      <Notice loading={list.loading} error={list.error}/>
      <div className="table-responsive"><table className="table table-sm record-table"><thead><tr><th>Partner</th><th>Contact</th><th className="text-end">Money added</th><th className="text-end">Money taken out</th><th className="text-end">Remaining capital</th><th>Actions</th></tr></thead><tbody>{list.data?.entries.map(row=><tr key={row._id}><td>{row.name}{row.partnerActive===false&&<small className="d-block text-body-secondary">Archived</small>}</td><td>{row.phoneNo||'—'}</td><td className="text-end record-number">{pkr(row.capital?.contributionsMinor)}</td><td className="text-end record-number">{pkr(row.capital?.withdrawalsMinor)}</td><td className="text-end record-number">{pkr(row.capital?.balanceMinor)}</td><td><div className="d-flex flex-wrap gap-1"><button className="btn btn-sm btn-outline-secondary" onClick={()=>{setEditing(row);setError('');}}>Manage</button><button className="btn btn-sm btn-outline-secondary" onClick={()=>{setSelected(row._id);setHistoryPage(1);}}>History</button>{['CONTRIBUTION','WITHDRAWAL'].map(direction=><button key={direction} className="btn btn-sm btn-outline-primary" disabled={locked||!available||row.partnerActive===false} onClick={()=>{setMovement({partner:row,direction});setError('');}}>{direction==='CONTRIBUTION'?'Add money':'Take money out'}</button>)}</div></td></tr>)}</tbody></table></div>
      {list.data?.entries.length===0&&<Empty>No partners found.</Empty>}<Pagination pagination={list.data?.pagination} onPage={setPage}/>
      <section className="panel mt-4"><div className="d-flex flex-wrap justify-content-between gap-2"><h2 className="h5">Partner money history</h2>{selected&&<button className="btn btn-outline-secondary btn-sm" onClick={()=>{setSelected('');setHistoryPage(1);}}>Show all partners</button>}</div>
        <Field label="Find money added or taken out"><input className="form-control" maxLength={100} value={historySearch} onChange={e=>{setHistorySearch(e.target.value);setHistoryPage(1);}} placeholder="Partner, account, note or reference"/></Field><Notice loading={history.loading} error={history.error}/>
        {history.data&&<><RecordTable label="Partner capital register" rows={history.data.entries} columns={[
 {key:'date',label:'Date (Pakistan)',render:r=>time(r.occurredAt)},{key:'partnerName',label:'Partner'},
 {key:'action',label:'Action',render:r=>(r.kind==='CAPITAL_REVERSAL'?'Reversal of ':'')+(r.direction==='CONTRIBUTION'?'Add money':'Take money out')},
 {key:'added',label:'Capital added (+)',numeric:true,render:r=>(r.kind==='CAPITAL_REVERSAL'?r.direction==='WITHDRAWAL':r.direction==='CONTRIBUTION')?pkr(r.amountMinor):'—'},
 {key:'reduced',label:'Capital reduced (−)',numeric:true,render:r=>(r.kind==='CAPITAL_REVERSAL'?r.direction==='CONTRIBUTION':r.direction==='WITHDRAWAL')?pkr(r.amountMinor):'—'},
 {key:'accountName',label:'Cash / bank'},{key:'reference',label:'Reference',render:r=>r.reference||'—'}
 ]} onOpen={r=>setDetailId(r._id)} empty="No capital transactions recorded."/><Pagination pagination={history.data.pagination} onPage={setHistoryPage}/></>}
      </section>
      {movement&&<Modal title={movement.direction==='CONTRIBUTION'?'Record money added':'Record money taken out'} busy={locked} onClose={()=>setMovement(null)}><p><strong>{movement.partner.name}</strong> · Remaining capital: {pkr(movement.partner.capital?.balanceMinor)}</p><form onSubmit={event=>{
        event.preventDefault();if(locked)return;const values=Object.fromEntries(new FormData(event.currentTarget));try{const amountMinor=minorAmount(values.amount);if(amountMinor<=0)throw new Error('Enter a positive amount.');const account=setup.data.accounts.find(a=>a._id===values.accountId);if(!account)throw new Error('Choose a payment account.');
          prepare({path:'/accounts/capital',title:'Confirm capital movement',summary:`${movement.partner.name}: ${pkr(amountMinor)}\n${movement.direction==='CONTRIBUTION'?'Money actually received into':'Money actually paid out from'} ${account.name}.\nThis is capital, not sales or an expense.`,body:{requestKey:crypto.randomUUID(),partnerId:movement.partner._id,direction:movement.direction,amountMinor,accountId:account._id,occurredAt:new Date(values.date+'+05:00').toISOString(),description:values.description,reference:values.reference}});
        }catch(e){setError(e.message);}
      }}><fieldset disabled={locked}><Notice error={error}/><Field label="Amount (PKR)"><input name="amount" className="form-control" type="number" min="0.01" step="0.01" required/></Field><Field label="Cash / bank account"><select name="accountId" className="form-select" required><option value="">Select account</option>{setup.data.accounts.map(a=><option key={a._id} value={a._id}>{a.name} ({a.kind})</option>)}</select></Field><Field label="Date and time (Pakistan)"><input name="date" className="form-control" type="datetime-local" step="0.001" defaultValue={new Date(Date.now()+5*3600000).toISOString().slice(0,23)} required/></Field><Field label="Note"><input name="description" className="form-control" maxLength={300} required/></Field><Field label="Reference (optional)"><input name="reference" className="form-control" maxLength={100}/></Field><button className="btn btn-primary">Review money change</button></fieldset></form></Modal>}
      {detailId&&<Modal title="Capital transaction details" busy={locked} onClose={()=>setDetailId(null)}><Notice loading={detail.loading} error={detail.error}/>{detail.data?.event&&<><p><strong>{detail.data.event.partnerName} · {pkr(detail.data.event.amountMinor)}</strong></p><p>{detail.data.event.kind==='CAPITAL_REVERSAL'?'Reversal of ':''}{detail.data.event.direction==='CONTRIBUTION'?'Add money':'Take money out'}</p><p>{detail.data.event.description}</p><p>Account: {detail.data.event.accountName} ({detail.data.event.accountKind})<br/>Transaction date: {time(detail.data.event.occurredAt)}<br/>Recorded: {time(detail.data.event.recordedAt)}<br/>Recorded by: {detail.data.event.createdByName}<br/>Reference: {detail.data.event.reference||'None'}</p>
        {detail.data.reversal&&<p className="alert alert-info">Reversed on {time(detail.data.reversal.occurredAt)}. {detail.data.reversal.description}</p>}
        {detail.data.event.kind!=='CAPITAL_REVERSAL'&&!detail.data.reversal&&<form onSubmit={event=>{event.preventDefault();if(locked)return;const values=Object.fromEntries(new FormData(event.currentTarget));prepare({path:'/accounts/capital/'+detailId+'/reverse',title:'Confirm capital reversal',summary:`${detail.data.event.partnerName}: ${pkr(detail.data.event.amountMinor)}\n${detail.data.event.direction==='CONTRIBUTION'?'Return the original investment from':'Restore the withdrawn funds into'} ${detail.data.event.accountName}. Confirm the money has actually moved back. Original history will remain.`,body:{requestKey:crypto.randomUUID(),occurredAt:new Date().toISOString(),description:values.reason,confirmation:'CONFIRM CAPITAL REVERSAL'}});}}><fieldset disabled={locked||!available}><Field label="Correction reason"><input name="reason" className="form-control" maxLength={300} required/></Field><button className="btn btn-outline-danger">Review correction</button><p className="small text-body-secondary mt-2">Correct only after the money has moved back. Cash and partner money cannot go below zero; reactivate an archived partner first.</p></fieldset></form>}
      </>}</Modal>}
    </>}</SupplierAction>
    {(creating||editing)&&<Modal title={editing?'Manage partner':'Add partner'} busy={busy} onClose={()=>{setCreating(false);setEditing(null);}}><form onSubmit={savePartner}><fieldset disabled={busy}><Notice error={error}/>
      {!editing&&<Field label="Use an existing business identity"><input type="checkbox" className="form-check-input ms-2" checked={existing} onChange={e=>setExisting(e.target.checked)}/></Field>}
      {!editing&&existing?<><Field label="Find existing business"><input className="form-control" maxLength={100} value={businessSearch} onChange={e=>{setBusinessSearch(e.target.value);setBusinessPage(1);}}/></Field><Notice loading={businesses.loading} error={businesses.error}/><div className="d-flex flex-wrap gap-2 mb-3">{businesses.data?.entries.map(row=><button type="button" key={row._id} className={'btn btn-sm '+(business?._id===row._id?'btn-primary':'btn-outline-secondary')} onClick={()=>setBusiness(row)}>{row.name}</button>)}</div><Pagination pagination={businesses.data?.pagination} onPage={setBusinessPage}/>{business&&<p>Selected: {business.name}. Existing customer/supplier balances stay separate.</p>}</>:editing?.customerId?<p>Identity details come from the linked customer and are not overwritten here.</p>:<><Field label="Partner name"><input name="name" className="form-control" maxLength={100} defaultValue={editing?.name||''} required/></Field>{!editing&&<p className="small text-body-secondary">For the shop owner, enter their name ({user.username}). No login account is created.</p>}<Field label="Phone (optional)"><input name="phoneNo" className="form-control" pattern="[0-9]{11}" maxLength={11} defaultValue={editing?.phoneNo||''}/></Field><Field label="Address (optional)"><input name="address" className="form-control" maxLength={300} defaultValue={editing?.address||''}/></Field></>}
      {editing&&<Field label="Partner status"><select name="partnerActive" className="form-select" defaultValue={editing.partnerActive===false?'false':'true'}><option value="true">Active</option><option value="false" disabled={!available||editing.capital?.balanceMinor!==0}>Archived (zero remaining capital only)</option></select></Field>}
      <button className="btn btn-primary" disabled={!editing&&existing&&!business}>{busy?'Saving...':'Save partner'}</button>
    </fieldset></form></Modal>}
  </>;
}
