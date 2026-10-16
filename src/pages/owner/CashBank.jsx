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
    {result.data && Number.isSafeInteger(result.data.balanceMinor) && <p className="fw-semibold">Balance: PKR {money(result.data.balanceMinor / 100)} <small className="d-block text-body-secondary">Prepared test-account balance. Live accounting is not enabled.</small></p>}
  </section>;
}
export default function CashBank() {
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [creating, setCreating] = useState(false), [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const term = useDebounce(search), list = useLoad('/accounts/financial' + query({q:term,page,limit:20}));
  async function save(event) {
    event.preventDefault(); if (busy) return;
    const body = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setError('');
    try { await api('/accounts/financial', {method:'POST',body}); setCreating(false); setSuccess('Account created. Balance setup is still required.'); list.reload(); }
    catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  return <>
    <PageTitle title="Cash & Bank"><button className="btn btn-primary btn-sm" onClick={()=>{setCreating(true);setError('');}}>Add account</button></PageTitle>
    <p className="text-body-secondary">Live accounting is not enabled. Account creation requires an approved local test setup; balances require confirmed opening balances and setup.</p>
    <Notice success={success} />
    <input aria-label="Search accounts" className="form-control search-input mb-3" placeholder="Account name or reference" maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);setSelected(null);}} />
    <section className="panel"><Notice loading={list.loading} error={list.error}/>
      {list.data && <><div className="table-responsive"><table className="table table-sm"><thead><tr><th>Account</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {list.data.entries.filter(a=>['CASH','BANK'].includes(a.kind)).map(a=><tr key={a._id}><td>{a.name}</td><td>{a.kind==='CASH'?'Cash':'Bank'}</td><td>{a.isActive===false?'Inactive':'Active'}</td><td><button className="btn btn-outline-secondary btn-sm me-2" onClick={()=>setSelected(a)}>View balance</button><Link className="btn btn-outline-secondary btn-sm" to={'/owner/accounts/transactions?account='+encodeURIComponent(a._id)}>Transactions</Link></td></tr>)}
      </tbody></table></div>{!list.data.entries.some(a=>['CASH','BANK'].includes(a.kind)) && <Empty>No cash or bank accounts on this page.</Empty>}<Pagination pagination={list.data.pagination} onPage={p=>{setPage(p);setSelected(null);}}/></>}
      {selected && <><h2 className="h6 mt-3">{selected.name}</h2><Balance key={selected._id} account={selected}/></>}
    </section>
    {creating && <Modal title="Add cash or bank account" busy={busy} onClose={()=>setCreating(false)}><form onSubmit={save}><fieldset disabled={busy}><Notice error={error}/><Field label="Account name"><input name="name" className="form-control" maxLength={100} required/></Field><Field label="Account reference" hint="A short unique reference, for example TILL_1 or BANK_1."><input name="code" className="form-control" maxLength={50} pattern="[A-Za-z0-9_-]+" required/></Field><Field label="Type"><select name="kind" className="form-select"><option value="CASH">Cash</option><option value="BANK">Bank</option></select></Field><button className="btn btn-primary" type="submit">{busy?'Saving...':'Create account'}</button></fieldset></form></Modal>}
  </>;
}
