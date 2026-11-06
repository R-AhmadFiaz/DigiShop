import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { invoiceCustomerDisplayName } from '../src/utils/invoiceCustomerName.js';

test('invoice display override takes precedence without changing the linked customer', () => {
  const order = { customerDisplayName: 'Corrected invoice name', customerId: { _id: 'customer-1', name: 'Master profile' } };
  assert.equal(invoiceCustomerDisplayName(order), 'Corrected invoice name');
  assert.equal(order.customerId.name, 'Master profile');
  assert.equal(invoiceCustomerDisplayName({ customerId: { name: 'Master profile' } }), 'Master profile');
  assert.equal(invoiceCustomerDisplayName({ customerDisplayName: 'Walk-in name', customerId: null }), 'Walk-in name');
});

test('customer correction is keyboard editable and printed, and history is visible', () => {
  const invoice = fs.readFileSync(new URL('../src/pages/owner/Invoice.jsx', import.meta.url), 'utf8');
  const receipt = fs.readFileSync(new URL('../src/components/Receipt.jsx', import.meta.url), 'utf8');
  const history = fs.readFileSync(new URL('../src/components/InvoiceHistory.jsx', import.meta.url), 'utf8');
  assert.match(invoice, /customer-display-name/);
  assert.match(invoice, /expectedDisplayRevision/);
  assert.match(invoice, /event\.key === "Escape"/);
  assert.match(invoice, /editButton\.current\?\.focus/);
  assert.match(receipt, /customerName/);
  assert.match(history, /Customer name updates/);
});

test('edit invoice layout aligns the table/search and highlights totals without technical helper copy', () => {
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const editor = fs.readFileSync(new URL('../src/components/InvoiceAdjustment.jsx', import.meta.url), 'utf8');
  assert.match(css, /\.invoice-editor-main\s*\{[^}]*grid-template-rows:minmax\(0,1fr\)[^}]*align-items:stretch/s);
  assert.match(css, /\.invoice-edit-lines\s*\{[^}]*overflow:auto/s);
  assert.match(css, /invoice-edit-updated[^}]*font-size/s);
  assert.doesNotMatch(editor, /Original line · original price retained|use Review Changes for server calculation|Enter selects the highlighted product|Refund vs store credit is your choice|Close the editor to return/);
  assert.match(editor, /Condition of \$\{/);
});

test('smart settlement review is a separate modal and cannot resize the product workspace', () => {
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const editor = fs.readFileSync(new URL('../src/components/InvoiceAdjustment.jsx', import.meta.url), 'utf8');
  assert.match(editor, /<div className="invoice-editor-main">[\s\S]*?<fieldset disabled=\{locked\} className="invoice-editor-checkout"/);
  assert.match(editor, /<dialog ref=\{reviewDialog\} className="invoice-smart-review"/);
  assert.match(editor, /previewSettlement\(\)/);
  assert.doesNotMatch(editor, /className="invoice-settlement-dialog"/);
  assert.doesNotMatch(editor, /<details className="invoice-edit-payment"/);
  assert.match(css, /\.invoice-editor-main\s*\{[^}]*flex:1 1 0/s);
  assert.match(css, /\.invoice-editor-checkout\s*\{[^}]*flex:none/s);
  assert.match(css, /\.invoice-smart-review\s*\{[^}]*max-height:calc\(100dvh - 28px\)[^}]*overflow:hidden/s);
  assert.match(css, /\.invoice-smart-review-body\s*\{[^}]*overflow:visible/s);
});

test('invoice table and search results scroll independently and checkout action stays aligned', () => {
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const editor = fs.readFileSync(new URL('../src/components/InvoiceAdjustment.jsx', import.meta.url), 'utf8');
  assert.match(css, /\.invoice-edit-lines\s*\{[^}]*overflow:auto/s);
  assert.match(css, /\.invoice-edit-search \.product-results\s*\{[^}]*overflow-y:auto/s);
  assert.match(css, /\.invoice-edit-lines \.cart-table th\s*\{[^}]*position:sticky/s);
  assert.match(css, /\.invoice-editor-actions\s*\{[^}]*grid-template-columns:minmax\(180px,1fr\) minmax\(220px,\.65fr\)/s);
  assert.match(editor, /className="invoice-edit-action"[\s\S]*?Review changes/);
  assert.match(editor, /e\.key==='F2'/);
  assert.match(editor, /e\.key==='F6'/);
  assert.match(editor, /dialog\.showModal\(\)/);
  assert.match(editor, /requestAnimationFrame\(\(\)=>reviewTrigger\.current\?\.focus/);
  assert.match(css, /@media \(max-width:1099px\), \(max-height:649px\)/);
});
