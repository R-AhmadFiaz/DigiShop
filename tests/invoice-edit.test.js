import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { adjustmentBody, invoiceEditChanges } from '../src/api/invoice.js';
import { paymentAccountState } from '../src/utils/invoiceCashAccount.js';

const order={_id:'invoice-1',revision:7,saleType:'RETAIL',discountType:'PERCENTAGE',discountValue:5,items:[
  {lineId:'line-a',productId:'product-a',name:'Cable A',quantity:3,unitPrice:100,itemDiscount:2},
  {lineId:'line-b',productId:'product-b',name:'Cable B',quantity:2,unitPrice:80},
]};
const products=[{_id:'product-a',retailPrice:120,wholesalePrice:110,stockQuantity:4},{_id:'product-b',retailPrice:90,wholesalePrice:85,stockQuantity:5},{_id:'product-c',retailPrice:45,wholesalePrice:40,stockQuantity:9}];

test('quantity edits map reductions to original line returns and increases to current-price additions',()=>{
  const change=invoiceEditChanges({order,quantities:{'line-a':'2','line-b':'5'},dispositions:{'line-a':'DAMAGED'},products});
  const body=adjustmentBody({order,mode:'adjustments',key:'stable-key',reason:'Exchange',returns:change.returns,additions:change.additions,discountType:order.discountType,discountValue:String(order.discountValue),funds:{cashReceivedAmount:'0',creditRedeemedAmount:'0',cashRefundAmount:'0',creditIssueAmount:'0'}});
  assert.deepEqual(body.returns,[{lineId:'line-a',quantity:1,disposition:'DAMAGED'}]);
  assert.deepEqual(body.additions,[{productId:'product-b',quantity:3}]);
  assert.equal(body.discountType,'PERCENTAGE');assert.equal(body.discountValue,5);
  assert.equal(Object.hasOwn(body.additions[0],'retailPrice'),false);
  assert.equal(body.expectedRevision,7);
});

test('added catalogue products remain separate addition lines and can share an existing product',()=>{
  const change=invoiceEditChanges({order,quantities:{'line-a':'3','line-b':'2'},additions:[{_id:'product-a',name:'Cable A',retailPrice:120,quantity:'2'},{_id:'product-c',name:'Cable C',retailPrice:45,quantity:'1'}],dispositions:{},products});
  assert.deepEqual(change.returns,{});
  assert.deepEqual(change.additions,[{_id:'product-a',quantity:2},{_id:'product-c',quantity:1}]);
});

test('every reduced line requires an explicit independent restock or damaged condition',()=>{
  assert.throws(()=>invoiceEditChanges({order,quantities:{'line-a':'1','line-b':'0'},products}),/Choose the condition/);
  const change=invoiceEditChanges({order,quantities:{'line-a':'1','line-b':'0'},dispositions:{'line-a':'RESTOCK','line-b':'DAMAGED'},products});
  assert.deepEqual(change.returns,{
    'line-a':{quantity:'2',disposition:'RESTOCK'},
    'line-b':{quantity:'2',disposition:'DAMAGED'},
  });
  assert.throws(()=>invoiceEditChanges({order,quantities:{'line-a':''},products}),/whole quantity/);
});

test('increasing a historical line is blocked if its shop product/current price cannot be resolved',()=>{
  assert.throws(()=>invoiceEditChanges({order,quantities:{'line-a':'4'},products:[]}),/pricing is unavailable/);
  assert.throws(()=>invoiceEditChanges({order:{...order,saleType:'WHOLESALE'},quantities:{'line-a':'4'},products:[{_id:'product-a',wholesalePrice:null}]}),/price is unavailable/);
});

test('invoice editor uses the existing protected preview/commit and keyboard conventions',()=>{
  const editor=fs.readFileSync(new URL('../src/components/InvoiceAdjustment.jsx',import.meta.url),'utf8');
  const invoice=fs.readFileSync(new URL('../src/pages/owner/Invoice.jsx',import.meta.url),'utf8');
  assert.match(invoice,/Edit Invoice/);assert.match(invoice,/mode === "adjustments" \?/);
  assert.match(editor,/invoiceEditChanges\(/);assert.match(editor,/\/preview/);
  assert.match(editor,/confirmationToken:preview\.confirmationToken/);
  assert.match(editor,/e\.key==='F2'/);assert.match(editor,/e\.key==='F6'/);
  assert.match(editor,/e\.key==='Escape'/);assert.match(editor,/ArrowDown.*ArrowUp.*Enter/s);
  assert.match(editor,/Choose condition/);assert.match(editor,/onSaved\(\)/);
});

test('edit and cancellation actions use independent eligibility flags',()=>{
  const invoice=fs.readFileSync(new URL('../src/pages/owner/Invoice.jsx',import.meta.url),'utf8');
  assert.match(invoice,/eligibility\?\.adjustmentEligible\s*&&\s*<button[\s\S]*?>Edit Invoice<\/button>/);
  assert.match(invoice,/eligibility\?\.cancellationEligible\s*&&\s*<button[\s\S]*?>Cancel invoice<\/button>/);
  assert.doesNotMatch(invoice,/cancellationEligible[^\n]*Edit Invoice/);
  assert.doesNotMatch(invoice,/adjustmentEligible[^\n]*Cancel invoice/);
});

test('adjustment preview errors are operation-specific and reload is reserved for stale revisions',()=>{
  const client=fs.readFileSync(new URL('../src/api/client.js',import.meta.url),'utf8');
  const editor=fs.readFileSync(new URL('../src/components/InvoiceAdjustment.jsx',import.meta.url),'utf8');
  assert.match(client,/if \(cancellation && \/debt history\|balance cannot safely\|product missing\//);
  assert.match(client,/invoiceOperation && \/debt history\|balance cannot safely\|verified reconciliation/);
  assert.match(editor,/function staleInvoiceError/);
  assert.match(editor,/reloadRequired&&<button[^>]*>Reload invoice/);
});

test('smart review uses a native modal and keeps settlement decisions outside the POS layout',()=>{
  const editor=fs.readFileSync(new URL('../src/components/InvoiceAdjustment.jsx',import.meta.url),'utf8');
  assert.match(editor,/className="invoice-smart-review"/);
  assert.match(editor,/dialog\.showModal\(\)/);
  assert.match(editor,/reviewHeading\.current\?\.focus/);
  assert.match(editor,/onCancel=/);
  assert.match(editor,/requestAnimationFrame\(\(\)=>reviewTrigger\.current\?\.focus/);
  assert.match(editor,/previewSettlement\(\)/);
  assert.match(editor,/confirmationToken:preview\.confirmationToken/);
  assert.match(editor,/Walk-in invoices must be fully paid/);
  assert.match(editor,/settlementMode==='FULL'/);
  assert.match(editor,/settlementMode==='PARTIAL'/);
  assert.match(editor,/settlementMode==='LATER'/);
  assert.match(editor,/Full payment/);
  assert.match(editor,/Partial payment/);
  assert.match(editor,/Pay later/);
  assert.match(editor,/Choose cash or bank/);
  assert.match(editor,/Confirm & receive/);
  assert.match(editor,/Confirm & refund/);
  assert.match(editor,/autoPreviewKey.current===signature/);
  assert.doesNotMatch(editor,/className="invoice-settlement-dialog"/);
  assert.match(editor,/\{!editor&&preview&&<div className="border rounded p-3 mt-2 invoice-edit-preview"/);
});

test('cash account state requires a loaded configured account only for real cash movements',()=>{
  const accounts={loading:false,error:'',data:{accountingEnabled:true,accounts:[{_id:'cash-a',name:'Counter cash'},{_id:'bank-b',name:'Main bank'}]}};
  assert.equal(paymentAccountState(accounts,'cash-a',true),'selected');
  assert.equal(paymentAccountState(accounts,'bank-b',true),'selected');
  assert.equal(paymentAccountState(accounts,'missing',true),'choose');
  assert.equal(paymentAccountState({...accounts,data:{...accounts.data,accounts:[]}},'',true),'empty');
  assert.equal(paymentAccountState({loading:true},'',true),'loading');
  assert.equal(paymentAccountState({loading:false,error:'unavailable'},'',true),'unavailable');
  assert.equal(paymentAccountState({loading:false,data:{accountingEnabled:false,accounts:[]}},'',true),'accounting-off');
  assert.equal(paymentAccountState({loading:true},'',false),'not-required');
});

test('receipt and refund controls are available in Smart Review with safe preview gating',()=>{
  const editor=fs.readFileSync(new URL('../src/components/InvoiceAdjustment.jsx',import.meta.url),'utf8');
  const smartReview=editor.slice(editor.indexOf('<dialog'),editor.indexOf('</dialog>'));
  assert.match(editor,/label="Receive payment into"/);
  assert.match(editor,/label="Refund from"/);
  assert.match(editor,/No active cash\/bank accounts\. Set one up in Cash &amp; Bank\./);
  assert.match(editor,/Walk-in invoices must be fully paid[\s\S]*?Amount to settle[\s\S]*?Full payment required\.[\s\S]*?Receive payment into/);
  assert.match(editor,/disabled=\{busy\|\|reloadRequired\|\|!preview\?\.canSubmit/);
  assert.match(editor,/setSettlementAmount\(''\)/);
  assert.match(editor,/reviewOpen&&settlementMode==='PARTIAL'[\s\S]*?settlementAmountInput\.current\?\.select/);
  assert.match(editor,/const signature=JSON\.stringify\(\[review\.revision,settlementMode,paymentSource,settlementAmount,refundMethod,splitRefundCash,routing\.receiptAccountId,routing\.refundAccountId\]\)/);
  assert.doesNotMatch(editor,/Review settlement/);
  assert.match(editor,/invalidateSettlement\(\);setRouting\(current=>\(\{\.\.\.current,receiptAccountId:event\.target\.value\}\)\)/);
  assert.match(editor,/invalidateSettlement\(\);setRouting\(current=>\(\{\.\.\.current,refundAccountId:event\.target\.value\}\)\)/);
  assert.match(editor,/if\(needsCashRouting&&\(paymentAccounts\.loading\|\|paymentAccounts\.error\|\|!paymentAccounts\.data\)\)/);
  assert.match(editor,/if\(needsCashRouting&&paymentAccounts\.data\.accountingEnabled===true\)/);
  assert.match(editor,/<CashAccountField label="Receive payment into"[\s\S]*?onRetry=\{paymentAccounts\.reload\}/);
  assert.match(editor,/settlementMode==='FULL'&&paymentSource==='CASH'&&<CashAccountField label="Receive payment into"/);
  assert.match(editor,/if\(value>0\)\{[\s\S]*?if\(!accounts\.some\(a=>String\(a\._id\)===String\(accountId\)\)/);
  assert.match(editor,/const result=await api\(endpoint\+'\/preview'/);
  assert.doesNotMatch(smartReview,/smart-review-acknowledgment/);
  assert.match(smartReview,/Confirm &amp; receive|Confirm & receive/);
  assert.match(smartReview,/Confirm &amp; refund|Confirm & refund/);
  assert.match(smartReview,/disabled=\{busy\|\|reloadRequired\|\|!preview\?\.canSubmit\}/);
  assert.match(editor,/dialog\.showModal\(\)/);
  assert.match(editor,/onCancel=/);
  assert.match(editor,/requestAnimationFrame\(\(\)=>reviewTrigger\.current\?\.focus/);
  const css=fs.readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
  assert.match(css,/\.smart-review-cash-account\s*\{[^}]*max-width:360px/s);
  assert.match(css,/\.invoice-smart-review-footer\s*\{[^}]*justify-content:space-between/s);
});

test('Smart Review uses a compact summary and side-by-side settlement/change hierarchy',()=>{
  const editor=fs.readFileSync(new URL('../src/components/InvoiceAdjustment.jsx',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
  assert.match(editor,/Previous total/);
  assert.match(editor,/Updated total/);
  assert.match(editor,/Already paid/);
  assert.match(editor,/Full payment required\./);
  assert.match(editor,/className="smart-review-lower"/);
  assert.match(editor,/<details><summary>\{changedMovements\.length\} product changes/);
  assert.match(editor,/setSettlementAmount\(\(due\/100\)\.toFixed\(2\)\)/);
  assert.match(css,/\.smart-review-lower\s*\{[^}]*display:grid;\s*grid-template-columns:minmax\(0,1\.15fr\) minmax\(0,\.85fr\)/s);
  assert.match(css,/\.invoice-smart-review-body\s*\{[^}]*overflow:visible/s);
  assert.doesNotMatch(css,/\.invoice-smart-review-body\s*\{[^}]*overflow:auto/s);
  assert.match(css,/@media \(max-width:700px\), \(max-height:650px\)[\s\S]*?\.invoice-smart-review \{ max-height:94dvh; overflow:auto;/);
});
