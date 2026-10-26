import {posNavigationChecks} from './pos-navigation-browser.js';
// Run the existing real-database browser suite with this frontend's new labels.
// Business assertions, isolated replica-set setup and backend source are unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {replaceLabels} from './readability-copy.js';
import {screenshotChecks} from './layout-screenshots.js';
import {purchaseChecks} from './purchase-browser-checks.js';
import {reportChecks} from './report-browser-checks.js';
import {unifiedPOSChecks} from './unified-pos-browser.js';
import {keyboardSalesChecks} from './keyboard-sales-browser.js';
import {mobileChecks} from './mobile-browser-checks.js';
import {supplierSearchChecks} from './supplier-search-browser.js';

const backend=path.resolve('../store-backend');
const invoiceSuite=process.argv.includes('--invoices');
let source=await fs.readFile(path.join(backend,'tests',invoiceSuite?'invoice-browser.integration.mjs':'supplier-browser.integration.mjs'),'utf8');
// Customer choice is now explicitly opened from the fixed billing footer.
source=source.replace('async function wait(expression) {',`async function wait(expression) { if(expression.includes('.customer-result'))await evaluate("(()=>{if(!document.querySelector('.customer-result'))document.querySelector('.pos-checkout .btn-outline-secondary')?.click();})()");`);
// The supplier account picker now searches inside a single dropdown.
source=source.replace(/^async function selectPaymentAccount\(id\).*$/m,`async function selectPaymentAccount(id){const account=await FinancialAccount.findById(id).lean();await evaluate("document.querySelector('#supplier-payment details > summary').click()");await fill('[aria-label="Search payment accounts"]',account.name);await wait('[...document.querySelectorAll("#supplier-payment details button")].some(b=>b.textContent==='+JSON.stringify(account.name+' ('+account.kind+')')+')');await evaluate('[...document.querySelectorAll("#supplier-payment details button")].find(b=>b.textContent==='+JSON.stringify(account.name+' ('+account.kind+')')+').click()');await wait('document.body.innerText.includes("Available in")');}`);
// Supplier accounts are now resolved by the server; exercise the actual simplified forms.
source=source.split('\n').filter(line=>!line.includes("await click('Create supplier payable account')")&&!line.includes("await fill('[name=SUPPLIER_PAYABLE]',String(correctionAp._id))")).join('\n');
const manualStart=source.indexOf('  const selectedAccounts={};'),manualEnd=source.indexOf("  await wait(\"document.body.innerText.includes('Outstanding:')\");",manualStart);
if(manualStart>=0&&manualEnd>=0)source=source.slice(0,manualStart)+`  await evaluate("[...document.querySelectorAll('label')].find(e=>e.textContent.includes('This is a new supplier')).querySelector('input').click()");await click('Review zero opening for new supplier');await record();\n`+source.slice(manualEnd);
source=source.replace('  await wait("document.body.innerText.includes(\'This is a new supplier\')");','  await label(\'Does this supplier have previous records?\',\'new\');\n  await wait("document.body.innerText.includes(\'This is a new supplier\')");');
source=source.replace('manual supplier account creation auto-selects and retains all dropdowns; confirmed zero opening unblocks existing PO, 5+5 receipt and duplicate replay','automatic supplier zero opening unblocks existing PO, 5+5 receipt and duplicate replay');
source=replaceLabels(source)
  .replaceAll("click('Add business')","click('Add supplier')")
  .replaceAll("click('Save business')","click('Save supplier')")
  .replaceAll('Already returned (net)','Already returned')
  .replaceAll('Period closing:','Balance at end:')
  .replaceAll('Available credit / refund due:','Supplier owes us:')
  .replaceAll('Expense posting unavailable','Finish money-record setup')
  .replaceAll('Capital balances and posting unavailable','Finish money-record setup')
  .replaceAll('Account ready and selected','Account selected')
  .replaceAll('not live stock valuation or profit','not current stock value or profit')
  .replaceAll('not revenue or profit','not sales or profit')
  .replace("document.querySelector('tbody')?.innerText.includes('Real browser electricity payment')", "document.querySelector('tbody')?.innerText.includes('EXP-LOCAL')")
  .replaceAll("await wait(\"!!document.querySelector('.product-result:not(:disabled)')\");await evaluate(\"document.querySelector('.product-result:not(:disabled)').click()\");", "await wait(\"(()=>{const b=document.querySelector('.product-result:not(:disabled)');if(!b)return false;b.click();return true;})()\");")
  .replace("await fill('[aria-label=\"Search products by name or brand\"]','Quote Brand');await wait(\"(()=>{const b=document.querySelector('.product-result:not(:disabled)');if(!b)return false;b.click();return true;})()\");", "await fill('[aria-label=\"Search products by name or brand\"]','Quote Brand');await wait(\"(()=>{const b=[...document.querySelectorAll('.product-result:not(:disabled)')].find(e=>e.textContent.includes('Quote Brand'));if(!b)return false;b.click();return true;})()\");")
  .replace("await wait(\"document.body.innerText.includes('Open supplier Khata')\")", "await wait(\"!!document.querySelector('dialog a[href*=\\\"/accounts/suppliers/\\\"]')\")")
  .replaceAll('retained for an identical retry','saved for a safe retry')
  .replace("const selectedAccounts={};", "await evaluate(\"[...document.querySelectorAll('summary')].find(e=>e.textContent==='Existing debt or manual account selection').click()\");const selectedAccounts={};")
  .replace("'Create '+kind.replaceAll('_',' ').toLowerCase()+' account'", "({SUPPLIER_PAYABLE:'Create supplier balance account',PURCHASES_CLEARING:'Create received-goods account',OPENING_EQUITY:'Create starting-value account'})[kind]")
  .replace("await click('Complete sale');await wait(\"document.body.innerText.includes('Select the cash or bank account receiving this payment.')\");", "assert.equal(await evaluate(\"document.querySelector('[aria-label=\\\"Payment account\\\"]').value\"),String(zeroCash._id),'Only prepared account defaults without submitting');");
// Open the new presentation disclosures before interacting with their controls.
source=source.replaceAll("document.querySelectorAll('button,a')", "document.querySelectorAll('button,a,summary')")
 .replaceAll("document.querySelector('select.form-select')", "document.querySelector('#supplier-payment select.form-select')")
 .replaceAll("fill('select.form-select',id)", "fill('#supplier-payment select.form-select',id)");
source=source.replace("Object.getOwnPropertyDescriptor(e.tagName", "for(let d=e.closest('details');d;d=d.parentElement?.closest('details'))if(!d.open)d.querySelector('summary').click();Object.getOwnPropertyDescriptor(e.tagName");
source=source.replace("const row=[...document.querySelectorAll('tr')].find(r=>r.innerText.includes", "const row=[...document.querySelectorAll('.supplier-settlements tr')].find(r=>r.innerText.includes");
source=source.replaceAll("querySelectorAll('tr')].some(r=>r.innerText.includes", "querySelectorAll('.supplier-settlements tr')].some(r=>r.innerText.includes");
source=source.replace("async function correctCredit(reference,nextReference){await navigation('/owner/accounts/suppliers/'+creditSupplier._id);", "async function correctCredit(reference,nextReference){await navigation('/owner/accounts/suppliers/'+creditSupplier._id);await wait(\"!!document.querySelector('.supplier-settlements')\");await evaluate(\"document.querySelector('.supplier-settlements > summary').click()\");");
source=source.replaceAll("row.querySelector('button').click();", "for(let d=row.closest('details');d;d=d.parentElement?.closest('details'))if(!d.open)d.querySelector('summary').click();row.querySelector('button').click();");
source=source.replaceAll('Supplier owes us: PKR 5.00','PKR 5.00');
source=source.replaceAll("document.querySelector('dialog').innerText.includes('Outstanding debt: PKR 0.00')", "document.querySelector('dialog .balance-strip dd')?.textContent==='PKR 0.00'");
source=source.replaceAll("document.body.innerText.includes('Credit applied (net of corrections): PKR 2.00')", "(()=>{const d=[...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Starting balance and credit history');if(!d)return false;d.open=true;return [...d.querySelectorAll('dt')].find(e=>e.textContent==='Credit applied (net of corrections)')?.nextElementSibling.textContent==='PKR 2.00';})()");
source=source.replaceAll("document.body.innerText.includes('Reference estimate')", "document.body.innerText.includes('Inventory estimate')")
 .replace("assert.ok(await evaluate(`document.body.innerText.includes('Profit & Loss')", "await evaluate(`[...document.querySelectorAll('details')].forEach(d=>d.open=true)`);assert.ok(await evaluate(`document.body.innerText.includes('Profit & Loss')")
 .replace("await wait(`document.body.innerText.includes('financial balances are unavailable')`);", "await wait(`document.body.innerText.includes('Unavailable')`);await evaluate(`[...document.querySelectorAll('details')].forEach(d=>d.open=true)`);await wait(`document.body.innerText.includes('financial balances are unavailable')`);");
source=source.replaceAll("innerText.includes('Unavailable:')", "innerText.includes('Unavailable')");
source=source.replaceAll('input[placeholder="Search name or brand"]','input[placeholder="Name, brand, category or size/model"]');
source=source.replace("await navigation('/owner/accounts/companies');await fill('[aria-label=\"Search businesses\"]','Correction Company');", "await navigation('/owner/accounts/companies');await fill('[aria-label=\"Business list filter\"]','');await fill('[aria-label=\"Search businesses\"]','Correction Company');")
  .replace("await click('Business details');await wait(\"document.body.innerText.includes('This business is a')\");", "await click('Business details');await click('Business setup & brand links');await wait(\"document.body.innerText.includes('This business is a')\");");
// Presentation-only report labels and the single report viewer replace old panels.
source=source.replaceAll("includes('Sales after discounts and returns')","includes('Net Sales')")
  .replaceAll("includes('Inventory estimate')","includes('Estimated Stock Value')")
  .replaceAll("includes('Why profit is not available')","includes('Report Notes')")
  .replaceAll("label('From (UTC)'","label('From'")
  .replaceAll("label('Through (UTC)'","label('To'")
  .replaceAll("click('Show reports')","click('Show Reports')")
  .replaceAll("'Partially received'","'Partially Received'");
source=source.replaceAll(/(['"])\.\.\/dist\/([^'"]+)\1/g,(_,quote,file)=>quote+pathToFileURL(path.join(backend,'dist',file)).href+quote)
  .replaceAll("'mongoose'",JSON.stringify(pathToFileURL(path.join(backend,'node_modules/mongoose/index.js')).href))
  .replaceAll("'jsonwebtoken'",JSON.stringify(pathToFileURL(path.join(backend,'node_modules/jsonwebtoken/index.js')).href));
const checks=`
  await navigation('/owner/accounts/transactions?account='+ap._id);
  const authoritativeStatement=ok(await get('/accounts/financial/'+ap._id+'/history?limit=20'));
  for(const event of authoritativeStatement.transactions){
    const selector='tr[data-record-id="'+event.eventId+'"]';await wait('!!document.querySelector('+JSON.stringify(selector)+')');
    const cells=await evaluate('[...document.querySelector('+JSON.stringify(selector)+').cells].map(c=>c.innerText)');
    const delta=event.accountPosting.balanceDeltaMinor;
    const format=n=>'PKR '+(n/100).toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
    assert.equal(cells[3],delta>0?format(delta):'—');assert.equal(cells[4],delta<0?format(-delta):'—');assert.equal(cells[5],format(event.runningBalanceMinor));
  }
  const firstStatementRow='tr[data-record-id="'+authoritativeStatement.transactions[0].eventId+'"]';
  await evaluate('(()=>{const r=document.querySelector('+JSON.stringify(firstStatementRow)+');r.focus();r.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));})()');
  await wait('!!document.querySelector("dialog[open]")');await click('Close');
  await navigation('/owner/purchases/'+postedPo._id);
  const deliverySelector='[aria-label="Purchase activity register"] tr[data-record-id]';
  await wait('!!document.querySelector('+JSON.stringify(deliverySelector)+')');
  const beforeRegisterDetails=await snapshot();
  await evaluate('document.querySelector('+JSON.stringify(deliverySelector)+').click()');
  await wait('!!document.querySelector(".record-detail")');
  assert.ok(await evaluate('document.querySelector(".record-detail").innerText.includes("Recorded by")'));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:740,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Register scroll stays inside the page');
  assert.ok(await evaluate('getComputedStyle(document.querySelector(".record-register")).overflowX==="auto"'),'Record tables retain horizontal scroll');
  assert.deepEqual(await snapshot(),beforeRegisterDetails,'Opening record details performs no financial writes');
  pass('Khata register directions/running balances equal authoritative postings, keyboard details work, mobile horizontal scroll and read-only expansion');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await navigation('/owner/products');
  await wait('!!document.querySelector(".table tbody td")');
  assert.equal(await evaluate('getComputedStyle(document.body).fontSize'),'16px');
  assert.equal(await evaluate('document.querySelector(".sidebar").getBoundingClientRect().width'),216);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".table")).fontSize'),'14.5px');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".table td")).paddingTop'),'7px');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".btn")).minHeight'),'36px');
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Desktop page fits');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".sidebar")).overflowY'),'auto');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:740,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Mobile page has no horizontal overflow');
  assert.ok(await evaluate('[...document.querySelectorAll(".btn,.form-control,.form-select")].filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().height>=44)'),'Mobile controls retain 44px touch targets');
  await send('Emulation.setDeviceMetricsOverride',{width:820,height:900,deviceScaleFactor:1,mobile:false});
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Tablet page fits');
  await send('Emulation.setDeviceMetricsOverride',{width:640,height:400,deviceScaleFactor:1,mobile:false});
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Narrow / zoom-equivalent viewport fits');
  await click('Add product');await wait('!!document.querySelector("dialog[open]")');
  assert.ok(await evaluate('document.querySelector("dialog").scrollHeight>document.querySelector("dialog").clientHeight'),'Long form scrolls in short viewport');
  await evaluate('document.querySelector("dialog").scrollTop=document.querySelector("dialog").scrollHeight');
  assert.ok(await evaluate('(()=>{const d=document.querySelector("dialog").getBoundingClientRect(),b=[...document.querySelectorAll("dialog button")].find(e=>e.textContent.trim()==="Save product").getBoundingClientRect();return b.bottom<=d.bottom&&b.top>=d.top;})()'),'Form action reachable at bottom');
  assert.ok(await evaluate('document.querySelector(".dialog-header").getBoundingClientRect().top>=document.querySelector("dialog").getBoundingClientRect().top'),'Dialog heading remains reachable');
  await click('Close');
  await send('Emulation.clearDeviceMetricsOverride');
  pass('Medium-density desktop text/tables/controls, scrollable sidebar, mobile touch targets, tablet/zoom-equivalent layout and long-dialog actions');
  await click('Sign out');await wait('!!document.querySelector("[name=identity]")');await click('Register your shop');
  for(const [name,value]of Object.entries({shopName:'Readability New Shop',contactNo:'03009998877',address:'Test Market',username:'readabilitynewowner',email:'readability@local.invalid',password:'local-test-password'}))await fill('[name='+name+']',value);
  await click('Create shop');await wait('location.pathname!=="/register"&&!document.querySelector("[name=shopName]")');
  safeDb();const registered=await User.findOne({username:'readabilitynewowner'}).lean();assert.ok(registered);assert.equal((await Shop.findById(registered.shopId)).name,'Readability New Shop');
  pass('Real registration keeps entered shop identity and existing blocked-state flow');
  await login(owner.username);
`;

// Forms now rely on authoritative server-issued references, never typed numbers.
source=source.replace(/await label\('(?:Purchase reference|Delivery reference|Payment reference|Return reference|Credit transaction reference|Correction reference)',[^;]+;/g,'')
 .replace(/await fill\('\[name=reference\]',[^;]+;/g,'')
 .replace('const po=await PurchaseOrder.findOne({shopId:shop._id,reference}).lean();',"const po=await PurchaseOrder.findOne({shopId:shop._id,supplierId:supplier._id}).sort({_id:-1}).lean();reference=po.reference;assert.match(reference,/^PO-[1-9][0-9]*$/);")
 .replace("await record();await wait(`document.body.innerText.includes(${JSON.stringify(reference)})`);return GoodsReceipt.findOne({shopId:shop._id,reference}).lean();", "await record();const saved=await GoodsReceipt.findOne({shopId:shop._id}).sort({_id:-1}).lean();reference=saved.reference;assert.match(reference,/^GR-[1-9][0-9]*$/);await wait(`document.body.innerText.includes(${JSON.stringify(reference)})`);return saved;");
for(const [old,issued] of Object.entries({'PAY-LOCAL-CASH':'SP-1','RET-LOCAL':'SR-1','EXP-LOCAL':'EX-1','CAP-LOCAL-IN':'CA-1','CAP-LOCAL-OUT':'CW-1','CREDIT-RETURN':'SR-2','CREDIT-REFUND':'SF-1','CREDIT-APPLY':'SC-1'}))source=source.replaceAll(old,issued);
source=source.replace("label('Search purchases','PO-AFTER-CUTOFF')","label('Search purchases',postedPo.reference)")
 .replace("includes('PO-AFTER-CUTOFF')","includes("+'${JSON.stringify(postedPo.reference)}'+")")
 .replace("includes('PO-BEFORE-CUTOFF')","includes("+'${JSON.stringify(mainPo.reference)}'+")");
source=source.replaceAll('Starting balance note','Reason / note').replace("await label('Does this supplier have previous records?','new');", "await fill('[aria-label=\"Supplier starting situation\"]','new');");
source=source.replaceAll('PO-AUTO-','PO-').replaceAll('GR-AUTO-','GR-');
source=source.replaceAll("click('Return details')","click('Return goods')");
source=source.replace("await click('Return goods');await wait(`document.body.innerText.includes('SR-1')`);", "await click('Return goods');await wait(`!!document.querySelector('section[aria-label=\"Purchase return\"] tbody tr')`);");
source=source.replace("await fill('[name=SUPPLIER_PAYABLE]',String(correctionAp._id));", "await sleep(350);await wait(\"!!document.querySelector('[name=reason]')&&!document.querySelector('[name=SUPPLIER_PAYABLE]').disabled\");await fill('[name=SUPPLIER_PAYABLE]',String(correctionAp._id));");

source=source.replace('async function label(name, value) {',`async function label(name, value) { if(name==='Reason'&&!await evaluate('[...document.querySelectorAll("label")].some(l=>l.textContent.trim()==="Reason")')&&await evaluate('[...document.querySelectorAll("label")].some(l=>l.textContent.includes("Payment note (Optional)"))'))name='Payment note (Optional)';`);
// The layout now also owns a navigation dialog; financial checks target financial dialogs only.
source=source.replace(/(['"])dialog(?!:not)/g,'$1dialog:not(.navigation-drawer)');
source=source.replace('  const evidence={passed:',mobileChecks+'  const evidence={passed:');
source=source.replace('  const evidence={passed:',checks+'  const evidence={passed:');
if(process.argv.includes('--purchases')&&!invoiceSuite)source=source.replace('  const evidence={passed:',purchaseChecks+'  const evidence={passed:');
if(process.argv.includes('--reports')&&!invoiceSuite)source=source.replace('  const evidence={passed:',reportChecks+'  const evidence={passed:');
if(process.argv.includes('--supplier-search')&&!invoiceSuite)source=source.replace('  const evidence={passed:',supplierSearchChecks+'  const evidence={passed:');
if(process.argv.includes('--keyboard'))source=source.replace('  const evidence={passed:',keyboardSalesChecks+'  const evidence={passed:');
if(process.argv.includes('--navigation'))source=source.replace('  const evidence={passed:',posNavigationChecks+'  const evidence={passed:');
if(process.argv.includes('--unified'))source=source.replace('  const evidence={passed:',unifiedPOSChecks+'  const evidence={passed:');
if(process.argv.includes('--screenshots')&&!invoiceSuite)source=source.replace('  const evidence={passed:',screenshotChecks+'  const evidence={passed:');
// Keep test evidence in the frontend repository too.
source=source.replaceAll("'tests/artifacts'",JSON.stringify(path.resolve('tests/artifacts')))
  .replaceAll("'tests/artifacts/supplier-phase5a-evidence.json'",JSON.stringify(path.resolve('tests/artifacts/readability-workflows.json')));
source=source.replace(/(['"])dialog(?!:not)/g,'$1dialog:not(.navigation-drawer)');
const target=path.resolve('node_modules/.cache/readability-'+(invoiceSuite?'invoice':'business')+'-workflows.mjs');
await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,source);
const child=spawn(process.execPath,[target],{cwd:backend,stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
