import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';

const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
  const {cashBankTotal,ReportOverview,ReportContent,ReportNotes,reportCategories}=await server.ssrLoadModule('/src/pages/owner/FinancialReports.jsx');
  const {default:PurchaseStatus}=await server.ssrLoadModule('/src/components/PurchaseStatus.jsx');
  const render=(component,props)=>renderToStaticMarkup(createElement(MemoryRouter,null,createElement(component,props)));
  const d={asOf:'2026-10-18T10:00:00Z',coverage:'Posted events only. Unposted history excluded.',
    sales:{status:'RECORDED',originalGrossMinor:100000,originalDiscountsMinor:10000,additionsMinor:20000,returnsMinor:30000,discountChangesMinor:5000,revenueMinor:75000,coverageMessage:'Old demo sales excluded.',financialStartAt:'2026-10-01T00:00:00Z',excludedUntimedCancellations:2},
    expenses:{status:'POSTED',spentMinor:10000,reversedMinor:2000,netMinor:8000,categories:[{name:'Electricity',totalMinor:8000}]},
    cashBank:{status:'POSTED',entries:[{id:'cash',name:'Main Cash',status:'POSTED',currentBalanceMinor:12345,rangeAvailable:false,openingMinor:null,closingMinor:null,netMovementMinor:null,message:'Before confirmed coverage.',transactions:[]},{id:'bank',name:'Bank',status:'POSTED',currentBalanceMinor:23456,rangeAvailable:true,openingMinor:20000,closingMinor:23456,netMovementMinor:3456,transactions:[]}]},
    customers:{status:'PROVISIONAL',debtMinor:6000,storeCreditMinor:2000,entries:[{id:'customer',name:'Amir',debtMinor:6000,storeCreditMinor:2000,reconciled:false}]},
    suppliers:{status:'INCOMPLETE',totalMinor:null,creditMinor:null,entries:[{id:'supplier',name:'Eagle',status:'UNAVAILABLE',balanceMinor:null,creditMinor:null,message:'Opening not confirmed.'}]},
    capital:{status:'POSTED',contributionsMinor:40000,withdrawalsMinor:10000,balanceMinor:30000,entries:[{name:'Owner',contributionsMinor:40000,withdrawalsMinor:10000,balanceMinor:30000}]},
    inventory:{status:'PROVISIONAL',referenceValueMinor:150000,message:'Current-cost estimate only.',entries:[{name:'Long copper coil product',quantity:5,unit:'coil',referenceValueMinor:150000}]},
    profit:{status:'UNAVAILABLE',message:'Cost at sale unavailable.',evidence:{invoicesInRange:3,receiptCostRecordsInRange:2,quantityOnlyStockRecordsInRange:4}},opening:{cutoffAt:'2026-10-01T00:00:00Z'}};
  await test('combined cash total requires every authoritative minor-unit amount; zero and overflow are explicit',()=>{
    assert.equal(cashBankTotal(d.cashBank),35801);
    assert.equal(cashBankTotal({...d.cashBank,status:'PROVISIONAL'}),null);
    assert.equal(cashBankTotal({status:'POSTED',entries:[{status:'PROVISIONAL',currentBalanceMinor:100}]}),null);
    assert.equal(cashBankTotal({status:'POSTED',entries:[]}),0);
    for(const value of [null,{status:'UNAVAILABLE',entries:[]},{status:'INCOMPLETE',entries:[]},{status:'POSTED',entries:[{status:'UNAVAILABLE',currentBalanceMinor:10}]},{status:'POSTED',entries:[{currentBalanceMinor:null}]},{status:'POSTED',entries:[{currentBalanceMinor:1.5}]},{status:'POSTED',entries:[{currentBalanceMinor:Number.MAX_SAFE_INTEGER},{currentBalanceMinor:1}]}])assert.equal(cashBankTotal(value),null);
  });
  await test('overview separates selected flows from current balances and keeps coverage warnings visible',()=>{
    const html=render(ReportOverview,{d,range:{from:'2026-10-01T00:00:00Z',to:'2026-10-19T00:00:00Z'}});
    for(const text of ['Net Sales','Operating Expenses','Current balances','PKR 358.01','Main Cash','Bank','Customers Owe Us','We Owe Suppliers','Partner Capital','Estimated Stock Value','Provisional','Only sales after','Older cancellations','Profit &amp; Loss unavailable'])assert.ok(html.includes(text),text);
    assert.ok(html.indexOf('Selected dates')<html.indexOf('Current balances'));
  });
  await test('each selection renders exactly one report and only its records',()=>{
    const labels=['Sales report','Expense report','Cash &amp; Bank report','Customer report','Supplier report','Capital report','Inventory report'];
    for(let i=0;i<reportCategories.length;i++){
      const html=render(ReportContent,{d,selected:reportCategories[i],onCustomer:()=>{}});
      assert.equal((html.match(/class="report-content"/g)||[]).length,1);
      assert.ok(html.includes('aria-label="'+labels[i]+'"'));
      for(let j=0;j<labels.length;j++)if(j!==i)assert.ok(!html.includes('aria-label="'+labels[j]+'"'));
    }
  });
  await test('details preserve reversal totals, unavailable range balances, separate debt/credit and familiar Withdrawal label',()=>{
    const cash=render(ReportContent,{d,selected:'Cash & Bank'});
    assert.ok(cash.includes('Unavailable'));assert.ok(cash.includes('account=bank'));assert.ok(cash.includes('PKR 234.56'));
    const expense=render(ReportContent,{d,selected:'Expenses'});assert.ok(expense.includes('Reversed: PKR 20.00'));assert.ok(expense.includes('PKR 80.00'));
    const customer=render(ReportContent,{d,selected:'Customers'});assert.ok(customer.includes('Customer Khata'));assert.ok(customer.includes('Needs review'));
    const supplier=render(ReportContent,{d,selected:'Suppliers'});assert.ok(supplier.includes('/owner/accounts/suppliers/supplier'));assert.ok(supplier.includes('Unavailable'));
    const capital=render(ReportContent,{d,selected:'Capital'});assert.ok(capital.includes('Withdrawal'));assert.ok(!capital.includes('Money taken out'));
  });
  await test('unavailable report never shows a fabricated empty or zero table',()=>{
    const html=render(ReportContent,{d:{...d,expenses:{status:'UNAVAILABLE',message:'Prepare accounting.'}},selected:'Expenses'});
    assert.ok(html.includes('Prepare accounting.'));assert.ok(!html.includes('<table'));assert.ok(!html.includes('PKR 0.00'));
  });
  await test('one Report Notes section retains cutoffs, exclusions, statement limits and profit evidence',()=>{
    const html=render(ReportNotes,{d});
    for(const text of ['Report Notes','Old demo sales excluded.','Before confirmed coverage.','Opening not confirmed.','Current-cost estimate only.','Cost at sale unavailable.','not used as historical cost','/owner/existing-setup','UTC day boundaries','Quantity-only stock records: 4'])assert.ok(html.includes(text),text);
  });
  await test('all actual purchase states get prominent badges without changing state values',()=>{
    for(const [status,label,tone] of [['DRAFT','Pending · Draft','warning'],['CONFIRMED','Pending · Confirmed','warning'],['PARTIALLY_RECEIVED','Partially Received','primary'],['RECEIVED','Received','success'],['CANCELLED','Cancelled','danger']]){
      const html=render(PurchaseStatus,{status});assert.ok(html.includes(label));assert.ok(html.includes('text-bg-'+tone));assert.ok(html.includes('purchase-status'));
    }
    assert.ok(render(PurchaseStatus,{status:'LEGACY'}).includes('LEGACY'));
  });
}finally{await server.close();}
