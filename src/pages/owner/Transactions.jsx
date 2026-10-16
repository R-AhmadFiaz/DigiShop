import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { query } from '../../api/client';
import { useDebounce, useLoad } from '../../api/hooks';
import { dateText, Empty, Field, money, Notice, PageTitle, Pagination } from '../../components/Common';

function Statement({ id, name }) {
  const [search,setSearch]=useState(''), [from,setFrom]=useState(''), [to,setTo]=useState(''), [page,setPage]=useState(1);
  const term=useDebounce(search);
  // UTC midnight boundaries; backend end is exclusive and cannot be in the future.
  const result=useLoad('/accounts/financial/'+encodeURIComponent(id)+'/history'+query({q:term,page,limit:20,from:from?from+'T00:00:00.000Z':undefined,to:to?to+'T00:00:00.000Z':undefined}));
  return <section className="panel mt-3"><h2 className="h5">{name || 'Selected account'} transactions</h2><p className="text-body-secondary">One account at a time. Dates use UTC; “Before” excludes that date. Payments and credits are not sales totals.</p>
    <div className="row g-2 mb-3"><div className="col-md-6"><Field label="Search transactions"><input className="form-control" placeholder="Description, type or invoice reference" maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></Field></div><div className="col-md-3"><Field label="From (UTC)"><input type="date" className="form-control" max={new Date().toISOString().slice(0,10)} value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}}/></Field></div><div className="col-md-3"><Field label="Before (UTC)"><input type="date" className="form-control" max={new Date().toISOString().slice(0,10)} value={to} onChange={e=>{setTo(e.target.value);setPage(1);}}/></Field></div></div>
    <Notice loading={result.loading}/>{result.error && <div role="alert" className="alert alert-warning">History unavailable: {result.error}</div>}
    {result.data && <><p>Current account balance: PKR {money(result.data.balanceMinor/100)}</p><div className="table-responsive"><table className="table table-sm"><thead><tr><th>Date</th><th>Type</th><th>Amount (PKR)</th><th>Source</th><th>Recorded by</th><th className="text-end">Balance (PKR)</th></tr></thead><tbody>{result.data.entries.map(row=><tr key={row._id}><td>{dateText(row.occurredAt || row.createdAt)}</td><td>{(row.source?.kind || row.description || 'Recorded entry').replaceAll('_',' ')}</td><td>{row.debitMinor>0?'Debit '+money(row.debitMinor/100):row.creditMinor>0?'Credit '+money(row.creditMinor/100):Number.isFinite(row.amount)?money(row.amount):'Unavailable'}</td><td>{row.invoice?.orderId?<Link to={'/owner/sales/'+row.invoice.orderId}>{row.invoice.invoiceNo || 'View invoice'}</Link>:row.invoiceNo || (row.source?.kind==='OPENING'?'Opening balance':row.source?.kind==='TRANSFER'?'Account transfer':row.referenceId?'Invoice reference recorded':'Reference recorded')}</td><td>{row.createdByName || 'Unavailable'}</td><td className="text-end">{Number.isSafeInteger(row.runningBalanceMinor)?money(row.runningBalanceMinor/100):'Unavailable for this search'}</td></tr>)}</tbody></table></div>{!result.data.entries.length && <Empty>No transactions found.</Empty>}<Pagination pagination={result.data.pagination} onPage={setPage}/></>}
  </section>;
}
export default function Transactions() {
  const [params,setParams]=useSearchParams(), id=params.get('account') || '';
  const [search,setSearch]=useState(''), [page,setPage]=useState(1), term=useDebounce(search);
  const accounts=useLoad('/accounts/financial'+query({q:term,page,limit:20}));
  return <><PageTitle title="Transactions"/><p className="text-body-secondary">Choose an account to view its recorded history. A combined business statement is not available.</p>
    <section className="panel"><Field label="Find an account"><input className="form-control search-input" placeholder="Account name or reference" maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></Field><Notice loading={accounts.loading} error={accounts.error}/><div className="d-flex flex-wrap gap-2">{accounts.data?.entries.map(a=><button key={a._id} className={'btn btn-sm '+(a._id===id?'btn-primary':'btn-outline-secondary')} onClick={()=>setParams({account:a._id})}>{a.name}</button>)}</div>{accounts.data?.entries.length===0 && <Empty>No accounts found.</Empty>}<Pagination pagination={accounts.data?.pagination} onPage={setPage}/></section>
    {id && <Statement key={id} id={id} name={accounts.data?.entries.find(a=>a._id===id)?.name}/>}
  </>;
}
