import RecordTable from '../../components/RecordTable';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, query } from '../../api/client';
import { useDebounce, useLoad } from '../../api/hooks';
import { Empty, Field, Modal, money, Notice, PageTitle, Pagination } from '../../components/Common';

function Balance({ account }) {
  const result = useLoad('/accounts/financial/' + account._id);
  return <section className="mt-3" aria-label="Account balance">
    <Notice loading={result.loading} />
    {result.error && <div className="alert alert-warning">Balance unavailable: {result.error}</div>}
    {result.data && Number.isSafeInteger(result.data.balanceMinor) && <p className="record-balance fw-semibold">Balance: PKR {money(result.data.balanceMinor / 100)} </p>}
  </section>;
}
export default function CashBank() {
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [creating, setCreating] = useState(false), [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [accountCode,setAccountCode]=useState('');
  const term = useDebounce(search), list = useLoad('/accounts/financial' + query({q:term,page,limit:20}));
  async function save(event) {
    event.preventDefault(); if (busy) return;
    const body = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setError('');
    try { await api('/accounts/financial', {method:'POST',body}); setCreating(false); setSuccess('Account created. Confirm its starting balance before use.'); list.reload(); }
    catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  return <>
    <PageTitle title="Cash & Bank"><button className="btn btn-primary btn-sm" onClick={()=>{setAccountCode('ACC_'+crypto.randomUUID().toUpperCase());setCreating(true);setError('');}}>Add account</button></PageTitle>
    <details className="context-help"><summary>Account setup</summary>Confirm starting balances and activate money records before using these accounts. <Link to="/owner/existing-setup">Open starting balances and account setup</Link>.</details>
    <Notice success={success} />
    <input aria-label="Search accounts" className="form-control search-input mb-3" placeholder="Account name or reference" maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);setSelected(null);}} />
    <section className="panel"><Notice loading={list.loading} error={list.error}/>
      {selected&&<><h2 className="h6 mt-3">{selected.name}</h2><Balance key={selected._id} account={selected}/></>}
      {list.data&&<><RecordTable label="Cash and bank accounts" rows={list.data.entries.filter(a=>['CASH','BANK'].includes(a.kind))} columns={[
 {key:'name',label:'Account'},{key:'kind',label:'Type',render:a=>a.kind==='CASH'?'Cash':'Bank'},
 {key:'status',label:'Status',render:a=>a.isActive===false?'Inactive':'Active'},
 {key:'transactions',label:'History',render:a=><Link className="btn btn-outline-secondary btn-sm" to={'/owner/accounts/transactions?account='+encodeURIComponent(a._id)}>Transactions</Link>}
 ]} onOpen={setSelected} detailLabel="View balance" empty="No cash or bank accounts on this page."/><Pagination pagination={list.data.pagination} onPage={p=>{setPage(p);setSelected(null);}}/></>}
    </section>
    {creating && <Modal title="Add cash or bank account" busy={busy} onClose={()=>setCreating(false)}><form onSubmit={save}><fieldset disabled={busy}><Notice error={error}/><Field label="Account name"><input name="name" className="form-control" maxLength={100} required/></Field><Field label="Account reference" hint="Filled for you. You may enter a different unique reference."><input name="code" defaultValue={accountCode} className="form-control" maxLength={50} pattern="[A-Za-z0-9_-]+" required/></Field><Field label="Type"><select name="kind" className="form-select"><option value="CASH">Cash</option><option value="BANK">Bank</option></select></Field><button className="btn btn-primary" type="submit">{busy?'Saving...':'Create account'}</button></fieldset></form></Modal>}
  </>;
}
