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
  await test('invoice and delivery histories retain immutable record actions and API paths',()=>{
    const invoice=fs.readFileSync(new URL('../src/components/InvoiceHistory.jsx',import.meta.url),'utf8');
    const deliveries=fs.readFileSync(new URL('../src/pages/owner/PurchaseDetails.jsx',import.meta.url),'utf8');
    assert.match(invoice,/Open printable record/);assert.match(invoice,/\/history/);
    assert.match(deliveries,/Return details/);assert.match(deliveries,/expectedRevision:po.revision/);
    assert.match(deliveries,/requestKey:crypto.randomUUID\(\)/);
  });
}finally{await server.close();}
