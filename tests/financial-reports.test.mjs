import test from 'node:test';
import assert from 'node:assert/strict';
import {reportSales, reportRange, reportMinor} from '../dist/utils/financialReports.js';
const invoice={_id:'one',status:'PENDING',subtotal:20,discountAmount:2,totalPrice:18};
const event=(kind,quantity,price,before,after,net)=>({movements:[{kind,quantity,unitPriceMinor:price}],before:{discountMinor:before},after:{discountMinor:after},financial:{salesDeltaMinor:net,cashReceivedMinor:999999}});
test('recorded invoice value is not paid cash; integer paisa discounts remain exact',()=>{
  assert.equal(reportSales([{...invoice,paidAmount:0}],[],[],new Set()).revenueMinor,1800);
  assert.equal(reportSales([{...invoice,subtotal:0.3,discountAmount:0.1,totalPrice:0.2}],[],[],new Set()).revenueMinor,20);
});
test('returns and additions use historical selling values and dated discount changes',()=>{
  const r=reportSales([], [event('RETURN',1,1000,200,100,-900),event('ADD',1,1200,100,220,1080)],[],new Set());
  assert.equal(r.returnsMinor,1000);assert.equal(r.additionsMinor,1200);assert.equal(r.discountChangesMinor,20);assert.equal(r.revenueMinor,180);
});
test('full return reverses revenue and discounts without counting refunds as new sales',()=>{
  const r=reportSales([invoice],[event('RETURN',2,1000,200,0,-1800)],[],new Set());
  assert.equal(r.revenueMinor,0);assert.equal(r.netDiscountsMinor,0);
});
test('cancelled original sale is preserved only when reversal date is known',()=>{
  assert.equal(reportSales([{...invoice,status:'CANCELLED'}],[],[],new Set()).excludedUntimedCancellations,1);
  assert.equal(reportSales([{...invoice,status:'CANCELLED'}],[],[],new Set(['one'])).revenueMinor,1800);
  assert.equal(reportSales([],[],[{...invoice,status:'CANCELLED'}],new Set()).revenueMinor,-1800);
});
test('original snapshot wins over changed invoice and incompatible evidence fails closed',()=>{
  assert.equal(reportSales([{...invoice,totalPrice:0,subtotal:0,revision:2,originalSnapshot:invoice}],[],[],new Set()).revenueMinor,1800);
  assert.throws(()=>reportSales([{...invoice,revision:2}],[],[],new Set()),/snapshot missing/);
  assert.throws(()=>reportSales([], [event('RETURN',1,1000,0,0,1000)],[],new Set()),/disagree/);
  assert.throws(()=>reportSales([{...invoice,totalPrice:1.001}],[],[],new Set()));
  assert.throws(()=>reportMinor(BigInt(Number.MAX_SAFE_INTEGER)+1n),/safe monetary/);
});
test('UTC half-open ranges reject invalid, reversed and oversized date windows',()=>{
  const r=reportRange('2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z');assert.equal(+r.end-+r.start,86400000);
  for(const args of [[null,null],['2026-01-01','2026-01-02'],['2026-02-30T00:00:00.000Z','2026-03-01T00:00:00.000Z'],['2026-01-02T00:00:00.000Z','2026-01-01T00:00:00.000Z'],['2020-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z']])assert.throws(()=>reportRange(...args));
});
