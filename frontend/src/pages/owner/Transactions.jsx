import { useSearchParams } from 'react-router-dom';
import { query } from '../../api/client';
import { useDebounce, useLoad } from '../../api/hooks';
import { Empty, Field, Notice, PageTitle, Pagination } from '../../components/Common';
import TransactionHistory from '../../components/TransactionHistory';
import { usePageParam, useQueryParam } from '../../api/paging';
export default function Transactions(){
  const [params,setParams]=useSearchParams(),id=params.get('account')||'',sourceId=params.get('sourceId')||'';
  const [search,setSearch]=useQueryParam('find'),[page,setPage]=usePageParam('accountsPage');
  // Choosing an account keeps the account list position; the statement restarts at its first page.
  const choose=account=>setParams(current=>{const next=new URLSearchParams(current);for(const key of ['account','sourceId','stPage'])next.delete(key);if(account)next.set('account',account);return next;},{replace:true});
  const accounts=useLoad('/accounts/financial'+query({q:useDebounce(search),page,limit:20}));
  return <><PageTitle title="Transactions"/><section className="panel transactions-accounts"><p className="text-body-secondary">View recorded money activity or choose an account. Unchecked old records may be missing.</p>
    <Field label="Find an account"><input className="form-control" placeholder="Account name or reference" maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></Field><Notice loading={accounts.loading} error={accounts.error}/>
    <div className="d-flex flex-wrap gap-2"><button className={'btn btn-sm '+(!id?'btn-primary':'btn-outline-secondary')} onClick={()=>choose('')}>All recorded activity</button>{accounts.data?.entries.map(a=><button key={a._id} className={'btn btn-sm '+(id===a._id?'btn-primary':'btn-outline-secondary')} onClick={()=>choose(a._id)}>{a.name}</button>)}</div>
    {accounts.data?.entries.length===0&&<Empty>No accounts found.</Empty>}<Pagination label="Accounts" pagination={accounts.data?.pagination} rows={accounts.data?.entries.length} onPage={setPage}/>
  </section><TransactionHistory key={id||sourceId||'global'} accountId={id} sourceId={sourceId} name={accounts.data?.entries.find(a=>a._id===id)?.name}/></>;
}
