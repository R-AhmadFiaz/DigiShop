import { Link } from "react-router-dom";
import {useState} from 'react';
import { useLoad } from "../../api/hooks";
import { Empty, Notice } from "../../components/Common";
import {query} from '../../api/client';
import {cashBankTotal} from '../../api/financialReports';
import {pkr,pakistanTime} from '../../api/purchases';

export function DashboardSummary({result,range}){
  const d=result.data;
  const cards=[
    {label:'Cash & Bank',scope:'Current balance',value:d?.cashBank,amount:cashBankTotal(d?.cashBank),to:'/owner/accounts/cash-bank'},
    {label:'Partner Capital',scope:'Current balance',value:d?.capital,amount:d?.capital?.balanceMinor,to:'/owner/partners'},
    {label:'Net Sales',scope:'This month',value:d?.sales,amount:d?.sales?.revenueMinor,to:'/owner/reports'},
    {label:'Expenses',scope:'This month',value:d?.expenses,amount:d?.expenses?.netMinor,to:'/owner/expenses'}
  ];
  return <section aria-label="Financial summary" className="dashboard-finances mb-3">
    <div className="dashboard-summary-grid">{cards.map(card=><Link key={card.label} to={card.to} className="dashboard-summary-card">
      <span className="d-flex flex-wrap justify-content-between gap-1"><span>{card.label}</span><small>{card.scope}</small></span>
      <strong>{result.loading?'Loading…':card.value?.status==='UNAVAILABLE'?'Unavailable':pkr(card.amount)}</strong>
      {['INCOMPLETE','PROVISIONAL'].includes(card.value?.status)&&<small className="text-warning-emphasis">{card.value.status==='INCOMPLETE'?'Incomplete — needs review':'Provisional'}</small>}
      {card.label==='Net Sales'&&card.value?.coverageMessage&&<small className="text-warning-emphasis">Only sales after {pakistanTime(card.value.financialStartAt)}.</small>}
      {card.label==='Net Sales'&&!!card.value?.excludedUntimedCancellations&&<small className="text-warning-emphasis">Older cancellations missing dates are excluded.</small>}
    </Link>)}</div>
    <p className="small text-body-secondary mt-2 mb-0">Sales and expenses: {range.from.slice(0,10)} to {new Date(Date.parse(range.to)-86400000).toISOString().slice(0,10)} (UTC reporting days).{d?.asOf&&' Updated '+pakistanTime(d.asOf)+' Pakistan time.'}</p>
    <Notice error={result.error}/>
  </section>;
}
export default function Dashboard() {
  const stock = useLoad("/products/low-stock");
  const [range]=useState(()=>{
    const today=new Date().toISOString().slice(0,10);
    return {from:today.slice(0,8)+'01T00:00:00.000Z',to:new Date(Date.parse(today+'T00:00:00.000Z')+86400000).toISOString()};
  });
  const reports=useLoad('/accounts/reports'+query(range));
  return (
    <>
      <div className="d-flex gap-2 mb-4">
        <Link className="btn btn-primary" to="sales">
          New sale
        </Link>
      </div>
      <DashboardSummary result={reports} range={range}/>
      <section className="panel">
        <div className="d-flex justify-content-between mb-3">
          <h2 className="h6 mb-0">
            Stock needing attention{" "}
            {stock.data && "(" + stock.data.counts + ")"}
          </h2>
          <button
            className="btn btn-outline-secondary btn-sm"
            disabled={stock.loading}
            onClick={stock.reload}
          >
            Refresh
          </button>
        </div>
        <Notice error={stock.error} loading={stock.loading} />
        {stock.data?.Products.length > 0 ? (
          <div className="table-responsive">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Brand</th>
                  <th>Available stock</th>
                </tr>
              </thead>
              <tbody>
                {stock.data.Products.map((p) => (
                  <tr key={p._id}>
                    <td>{p.name}</td>
                    <td>{p.brand}</td>
                    <td className="text-warning">
                      {p.stockQuantity} {p.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          stock.data && <Empty>No products need restocking.</Empty>
        )}
      </section>
    </>
  );
}
