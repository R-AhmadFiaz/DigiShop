import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import fs from 'node:fs';

const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
  const {default:RecordTable,RecordFacts}=await server.ssrLoadModule('/src/components/RecordTable.jsx');
  const columns=[{key:'reference',label:'Reference'},{key:'amount',label:'Amount',numeric:true}];
  await test('shared table styles center headers, values, placeholders and action buttons',()=>{
    const rows=[{_id:'empty',reference:'—',amount:'—'},{_id:'paid',reference:'INV-1',amount:'PKR 5,000.00'},{_id:'zero',reference:'Name — note',amount:0}];
    const html=renderToStaticMarkup(createElement(RecordTable,{label:'Alignment',columns,rows}));
    assert.match(html,/class="record-reference record-placeholder">—<\/td>/);
    assert.match(html,/class="text-end record-number record-placeholder">—<\/td>/);
    assert.match(html,/class="text-end record-number">PKR 5,000.00<\/td>/);
    assert.match(html,/class="text-end record-number">0<\/td>/);
    assert.match(html,/class="record-reference">Name — note<\/td>/);
    assert.match(html,/<th[^>]*class="text-end record-number"[^>]*>Amount<\/th>/);
    const css=fs.readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
    assert.match(css,/table th, table td,\s*table \.text-start, table \.text-end\s*\{\s*text-align: center !important;/);
    assert.match(css,/table \.btn\s*\{\s*text-align: center !important; justify-content: center;/);
    assert.match(css,/table \{ font-size: 14\.5px; \}/);
    assert.match(css,/table th \{ font-size: 14px; font-weight: 600; \}/);
    assert.doesNotMatch(css,/\.record-table th:not\(\.record-number\).*text-align: left/);
  });
  await test('register preserves supplied event order, amounts and unavailable values',()=>{
    const rows=[{_id:'later',reference:'RET-2',amount:0},{_id:'earlier',reference:'INV-1',amount:null}];
    const before=JSON.stringify(rows);
    const html=renderToStaticMarkup(createElement(RecordTable,{label:'Shop register',columns,rows}));
    assert.ok(html.indexOf('RET-2')<html.indexOf('INV-1'));
    assert.match(html,/record-number">0<\/td>/);assert.match(html,/record-number">Unavailable<\/td>/);
    assert.match(html,/scope="col"/);assert.match(html,/role="region" aria-label="Shop register" tabindex="0"/);
    assert.equal(JSON.stringify(rows),before);
  });
  await test('record details stay collapsed and accessible without losing action buttons',()=>{
    const html=renderToStaticMarkup(createElement(RecordTable,{label:'Returns',columns,rows:[{_id:0,reference:'R-1',amount:100}],details:()=>createElement('p',null,'Long private note')}));
    assert.match(html,/data-record-id="0"/);assert.match(html,/aria-expanded="false"/);
    assert.match(html,/>Details<\/button>/);assert.doesNotMatch(html,/Long private note/);
  });
  await test('empty register and facts never manufacture zero balances or metadata',()=>{
    const html=renderToStaticMarkup(createElement(RecordTable,{label:'History',columns,empty:'No deliveries recorded.'}));
    assert.match(html,/No deliveries recorded/);assert.doesNotMatch(html,/PKR 0/);
    const facts=renderToStaticMarkup(createElement(RecordFacts,{items:[['Balance',null],['Actor','<script>']]}));
    assert.match(facts,/Unavailable/);assert.match(facts,/&lt;script&gt;/);
  });
  await test('date, reference, amount and action columns get distinct layout classes',()=>{
    const html=renderToStaticMarkup(createElement(RecordTable,{label:'Statement',columns:[{key:'date',label:'Date'},{key:'reference',label:'Reference'},{key:'amount',label:'Amount',numeric:true},{key:'open',label:'Action'}],rows:[{_id:'event',date:'1 Jan 2026',reference:'INV-100',amount:100,open:'View'}]}));
    assert.match(html,/class="record-date"/);assert.match(html,/class="record-reference"/);
    assert.match(html,/class="text-end record-number"/);assert.match(html,/class="record-actions"/);
  });
  await test('invoice and delivery histories retain immutable record actions and API paths',()=>{
    const invoice=fs.readFileSync(new URL('../src/components/InvoiceHistory.jsx',import.meta.url),'utf8');
    const deliveries=fs.readFileSync(new URL('../src/pages/owner/PurchaseDetails.jsx',import.meta.url),'utf8');
    assert.match(invoice,/Open printable record/);assert.match(invoice,/\/history/);
    assert.match(deliveries,/Return details/);assert.match(deliveries,/expectedRevision:po.revision/);
    assert.match(deliveries,/requestKey:crypto.randomUUID\(\)/);
  });
  await test('supplier forms keep uncertain-request recovery accessible inside disclosures',()=>{
    const source=fs.readFileSync(new URL('../src/pages/owner/SupplierDetails.jsx',import.meta.url),'utf8');
    assert.match(source,/balance.creditMinor>0\|\|locked/);assert.equal((source.match(/open=\{locked\|\|undefined\}/g)||[]).length,2);
    assert.match(source,/accountId=\{balance.data.accountId\}[^>]*supplier/);
    assert.match(source,/CONFIRM SUPPLIER REFUND RECEIVED/);assert.match(source,/CONFIRM SUPPLIER REVERSAL/);
  });
  await test('report summaries use supplied current amounts without aggregating incomplete account pages',()=>{
    const source=fs.readFileSync(new URL('../src/pages/owner/FinancialReports.jsx',import.meta.url),'utf8');
    for(const field of ['sales.revenueMinor','expenses.netMinor','customers.debtMinor','suppliers.totalMinor','capital.balanceMinor','inventory.referenceValueMinor'])assert.ok(source.includes('amount={d.'+field+'}'));
    assert.match(source,/pkr\(a.currentBalanceMinor\)/);assert.doesNotMatch(source,/\.reduce\(/);
    assert.match(source,/Selected dates/);assert.match(source,/Current balances/);assert.match(source,/Inventory estimate — provisional/);
  });
}finally{await server.close();}
