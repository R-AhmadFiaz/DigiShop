// Run the existing real-database browser suite with this frontend's new labels.
// Business assertions, isolated replica-set setup and backend source are unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {replaceLabels} from './readability-copy.js';

const backend=path.resolve('../store-backend');
const invoiceSuite=process.argv.includes('--invoices');
let source=await fs.readFile(path.join(backend,'tests',invoiceSuite?'invoice-browser.integration.mjs':'supplier-browser.integration.mjs'),'utf8');
source=replaceLabels(source)
  .replaceAll('Already returned (net)','Already returned')
  .replaceAll('Period closing:','Balance at end:')
  .replaceAll('Available credit / refund due:','Supplier owes us:')
  .replaceAll('Expense posting unavailable','Finish money-record setup')
  .replaceAll('Capital balances and posting unavailable','Finish money-record setup')
  .replaceAll('Account ready and selected','Account selected')
  .replaceAll('not live stock valuation or profit','not current stock value or profit')
  .replaceAll('not revenue or profit','not sales or profit')
  .replaceAll("await wait(\"!!document.querySelector('.product-result:not(:disabled)')\");await evaluate(\"document.querySelector('.product-result:not(:disabled)').click()\");", "await wait(\"(()=>{const b=document.querySelector('.product-result:not(:disabled)');if(!b)return false;b.click();return true;})()\");")
  .replace("await wait(\"document.body.innerText.includes('Open supplier Khata')\")", "await wait(\"!!document.querySelector('dialog a[href*=\\\"/accounts/suppliers/\\\"]')\")")
  .replaceAll('retained for an identical retry','saved for a safe retry')
  .replace("const selectedAccounts={};", "await evaluate(\"[...document.querySelectorAll('summary')].find(e=>e.textContent==='Existing debt or manual account selection').click()\");const selectedAccounts={};")
  .replace("'Create '+kind.replaceAll('_',' ').toLowerCase()+' account'", "({SUPPLIER_PAYABLE:'Create supplier balance account',PURCHASES_CLEARING:'Create received-goods account',OPENING_EQUITY:'Create starting-value account'})[kind]")
  .replace("await click('Complete sale');await wait(\"document.body.innerText.includes('Select the cash or bank account receiving this payment.')\");", "assert.equal(await evaluate(\"document.querySelector('[aria-label=\\\"Payment account\\\"]').value\"),String(zeroCash._id),'Only prepared account defaults without submitting');");
source=source.replaceAll(/(['"])\.\.\/dist\/([^'"]+)\1/g,(_,quote,file)=>quote+pathToFileURL(path.join(backend,'dist',file)).href+quote)
  .replaceAll("'mongoose'",JSON.stringify(pathToFileURL(path.join(backend,'node_modules/mongoose/index.js')).href))
  .replaceAll("'jsonwebtoken'",JSON.stringify(pathToFileURL(path.join(backend,'node_modules/jsonwebtoken/index.js')).href));
const checks=`
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await navigation('/owner/products');
  assert.ok(await evaluate('parseFloat(getComputedStyle(document.body).fontSize)>=16'));
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".sidebar")).overflowY'),'auto');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:740,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Mobile page has no horizontal overflow');
  await send('Emulation.setDeviceMetricsOverride',{width:640,height:400,deviceScaleFactor:1,mobile:false});
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Narrow / zoom-equivalent viewport fits');
  await click('Add product');await wait('!!document.querySelector("dialog[open]")');
  assert.ok(await evaluate('document.querySelector("dialog").scrollHeight>document.querySelector("dialog").clientHeight'),'Long form scrolls in short viewport');
  await evaluate('document.querySelector("dialog").scrollTop=document.querySelector("dialog").scrollHeight');
  assert.ok(await evaluate('(()=>{const d=document.querySelector("dialog").getBoundingClientRect(),b=[...document.querySelectorAll("dialog button")].find(e=>e.textContent.trim()==="Save product").getBoundingClientRect();return b.bottom<=d.bottom&&b.top>=d.top;})()'),'Form action reachable at bottom');
  assert.ok(await evaluate('document.querySelector(".dialog-header").getBoundingClientRect().top>=document.querySelector("dialog").getBoundingClientRect().top'),'Dialog heading remains reachable');
  await click('Close');
  await send('Emulation.clearDeviceMetricsOverride');
  pass('Readable body text, scrollable desktop sidebar, mobile/zoom-equivalent layout and long-dialog actions');
  await click('Sign out');await wait('!!document.querySelector("[name=identity]")');await click('Register your shop');
  for(const [name,value]of Object.entries({shopName:'Readability New Shop',contactNo:'03009998877',address:'Test Market',username:'readabilitynewowner',email:'readability@local.invalid',password:'local-test-password'}))await fill('[name='+name+']',value);
  await click('Create shop');await wait('location.pathname!=="/register"&&!document.querySelector("[name=shopName]")');
  safeDb();const registered=await User.findOne({username:'readabilitynewowner'}).lean();assert.ok(registered);assert.equal((await Shop.findById(registered.shopId)).name,'Readability New Shop');
  pass('Real registration keeps entered shop identity and existing blocked-state flow');
  await login(owner.username);
`;
source=source.replace('  const evidence={passed:',checks+'  const evidence={passed:');
// Keep test evidence in the frontend repository too.
source=source.replaceAll("'tests/artifacts'",JSON.stringify(path.resolve('tests/artifacts')))
  .replaceAll("'tests/artifacts/supplier-phase5a-evidence.json'",JSON.stringify(path.resolve('tests/artifacts/readability-workflows.json')));
const target=path.resolve('node_modules/.cache/readability-'+(invoiceSuite?'invoice':'business')+'-workflows.mjs');
await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,source);
const child=spawn(process.execPath,[target],{cwd:backend,stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
