import {useState} from 'react';
import {Link} from 'react-router-dom';
import {api} from '../../api/client';
import {useLoad} from '../../api/hooks';
import {pkr,minorAmount,pakistanTime} from '../../api/purchases';
import {Field,Notice,PageTitle} from '../../components/Common';
import SupplierAction from '../../components/SupplierAction';
import AccountingActivation from '../../components/AccountingActivation';

const root='/accounts/existing-setup';
function Draft({setup,evidence,locked,onSaved,onEdit,success}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[errors,setErrors]=useState({});
  const input=setup?.input;
  const [cutoff,setCutoff]=useState(()=>new Date(new Date(input?.cutoffAt||Date.now()).getTime()+5*3600000).toISOString().slice(0,23));
  const [expected,setExpected]=useState(input?String(input.expectedNetAssetsMinor/100):'');
  async function save(event){
    event.preventDefault();if(busy||locked)return;setError('');setErrors({});
    const form=event.currentTarget,invalid={};
    for(const field of form.elements){if(field.willValidate&&!field.validity.valid)invalid[field.name]=field.validationMessage;if(field.required&&field.type==='text'&&!field.value.trim())invalid[field.name]='Enter a review note.';}
    const values=new FormData(form);
    function money(name,value){try{return minorAmount(value);}catch(e){invalid[name]=e.message;return null;}}
    const expectedValue=expected.trim(),absolute=expectedValue.startsWith('-')?expectedValue.slice(1):expectedValue;
    const expectedMinor=money('expected',absolute);
    const expectedNetAssetsMinor=expectedMinor===null?null:expectedMinor*(expectedValue.startsWith('-')?-1:1);
    const cash=evidence.cash.map(row=>({accountId:row._id,amountMinor:money('cash-'+row._id,values.get('cash-'+row._id))}));
    const suppliers=evidence.suppliers.filter(row=>!row.hasOpening).map(row=>({supplierId:row._id,otherOpeningMinor:money('other-'+row._id,values.get('other-'+row._id)),reviews:row.deliveries.map(receipt=>({receiptId:receipt._id,unpaidMinor:money('unpaid-'+receipt._id,values.get('unpaid-'+receipt._id)),reason:values.get('review-'+receipt._id)}))}));
    let cutoffAt;try{cutoffAt=new Date(cutoff+'+05:00').toISOString();if(Date.parse(cutoffAt)>Date.now())invalid.cutoff='Choose the current time or an earlier opening cutoff.';}catch{invalid.cutoff='Enter a valid opening cutoff.';}
    if(!String(values.get('reason')||'').trim())invalid.reason='Enter a short setup note, for example: New shop with no opening stock or money.';
    if(Object.keys(invalid).length){setErrors(invalid);setError('Draft not saved. Check the marked fields below.');return;}
    try{
      setBusy(true);const result=await api(root,{method:'PUT',body:{expectedRevision:setup?.revision??0,input:{cutoffAt,reason:values.get('reason').trim(),cash,suppliers,expectedNetAssetsMinor,acknowledgeLegacyCustomerBalances:values.get('customers')==='on',acknowledgeUnallocatedEquity:values.get('equity')==='on'}}});onSaved(result);
    }catch(e){setError(!e.status||e.status>=500?'Could not confirm whether the draft saved. Your entries are kept here. Reload to check the saved draft before trying again. '+e.message:'Draft not saved: '+e.message);if(/cutoff|timestamp/i.test(e.message))setErrors({cutoff:e.message});}finally{setBusy(false);}
  }
  const fieldError=name=>errors[name]&&<small className="text-danger d-block" role="alert">{errors[name]}</small>;
  return <form noValidate onSubmit={save} onChange={onEdit} aria-label="Opening setup draft"><fieldset disabled={busy||locked}>
    <h2 className="h5">Opening details</h2><p>Pause sales, deliveries and stock changes while reviewing. Save corrections freely until final confirmation. After confirmation, do not recreate openings.</p>
    <Field label="Opening cutoff (Pakistan time)"><input name="cutoff" type="datetime-local" step="0.001" className="form-control" value={cutoff} aria-invalid={!!errors.cutoff} onChange={e=>setCutoff(e.target.value)} required/>{fieldError('cutoff')}</Field><button type="button" className="btn btn-outline-secondary btn-sm mb-3" onClick={()=>{setCutoff(new Date(Date.now()+5*3600000).toISOString().slice(0,23));onEdit();}}>Use current time</button>
    <Field label="Setup note" hint="For a new shop, you can enter: New shop with no opening stock or money."><input name="reason" className="form-control" maxLength={300} defaultValue={input?.reason||''} aria-invalid={!!errors.reason} required/>{fieldError('reason')}</Field>
    <h3 className="h6 mt-3">Cash and bank balances</h3><p className="text-body-secondary">Enter verified money already held by the business. Existing confirmed openings must match; this is not new income or a partner investment.</p>
    {!evidence.cash.length&&<p><Link to="/owner/accounts/cash-bank">Create cash/bank accounts</Link> before saving an opening review.</p>}
    {evidence.cash.map(row=><Field key={row._id} label={row.name+' ('+row.kind+') — '+(row.status==='COMPLETE'?'Confirmed':row.declaredMinor!==null?'Saved — awaiting confirmation':'Enter opening balance')} hint="0 is valid if this account has no opening money."><input name={'cash-'+row._id} type="number" min="0" step="0.01" className="form-control" aria-invalid={!!errors['cash-'+row._id]} defaultValue={input?.cash.find(r=>r.accountId===row._id)?input.cash.find(r=>r.accountId===row._id).amountMinor/100:row.openingMinor===null?'':row.openingMinor/100} required/>{fieldError('cash-'+row._id)}</Field>)}
    <h3 className="h6 mt-3">Supplier amounts still owed</h3><p className="text-body-secondary">Review every existing delivery. Enter only the unpaid amount, using 0 if already settled externally. No historical payment is invented.</p>
    {evidence.suppliers.map(row=>row.hasOpening?<p key={row._id}>{row.name}: opening already confirmed ({row.status.toLowerCase()}). {row.status==='COMPLETE'?'It will be reused.':'Resolve reconciliation issues; do not create another opening.'}</p>:<section className="border rounded p-3 mb-3" key={row._id}><h4 className="h6">{row.name}</h4>
      <Field label="Other historical supplier debt (PKR)"><input name={'other-'+row._id} type="number" min="0" step="0.01" className="form-control" aria-invalid={!!errors['other-'+row._id]} defaultValue={input?.suppliers.find(r=>r.supplierId===row._id)?.otherOpeningMinor===undefined?'':input.suppliers.find(r=>r.supplierId===row._id).otherOpeningMinor/100} required/>{fieldError('other-'+row._id)}</Field>
      {row.deliveries.map(receipt=>{const review=input?.suppliers.find(r=>r.supplierId===row._id)?.reviews.find(r=>r.receiptId===receipt._id);return <div className="border-top pt-2" key={receipt._id}><p>{receipt.reference} · {pkr(receipt.totalMinor)} · {receipt.status} · {pakistanTime(receipt.occurredAt)}</p><Field label="Still unpaid for this delivery (PKR)"><input name={'unpaid-'+receipt._id} type="number" min="0" step="0.01" max={receipt.totalMinor/100} className="form-control" aria-invalid={!!errors['unpaid-'+receipt._id]} defaultValue={review?review.unpaidMinor/100:''} required/>{fieldError('unpaid-'+receipt._id)}</Field><Field label="Review note / external settlement explanation"><input name={'review-'+receipt._id} className="form-control" maxLength={300} aria-invalid={!!errors['review-'+receipt._id]} defaultValue={review?.reason||''} required/>{fieldError('review-'+receipt._id)}</Field></div>;})}
    </section>)}
    <Field label="Expected net business value after debts (PKR)" hint="Your verified stock value + cash/bank + customer debts, minus supplier debts and customer store credit. Use 0 for a new shop with no opening assets or debts. Negative values are allowed. This is not ownership allocation."><input name="expected" type="number" step="0.01" className="form-control" aria-invalid={!!errors.expected} value={expected} onChange={e=>setExpected(e.target.value)} required/>{fieldError('expected')}</Field>
    <label className="d-block mb-2"><input type="checkbox" name="customers" className="form-check-input me-2" aria-invalid={!!errors.customers} defaultChecked={input?.acknowledgeLegacyCustomerBalances} required/>Customer debts and store credit stay in the existing customer ledger. No second receivable or credit balance will be posted.{fieldError('customers')}</label>
    <label className="d-block mb-3"><input type="checkbox" name="equity" className="form-check-input me-2" aria-invalid={!!errors.equity} defaultChecked={input?.acknowledgeUnallocatedEquity} required/>Opening equity remains unallocated. Existing cash/bank funds must not be re-entered as partner investments.{fieldError('equity')}</label>
    <Notice error={error} success={success}/>
    <button className="btn btn-primary">{busy?'Saving...':'Save setup draft'}</button>
  </fieldset></form>;
}
function Review({evidence,confirmed,saved,reviewed}){
  const t=evidence.totals;
  return <>
    <h2 className="h5">{confirmed?'Confirmed opening snapshot':'Opening review'}</h2>
    <div className="table-responsive"><table className="table table-sm"><tbody>{[['Existing stock value',t.inventoryMinor],['Cash / bank',t.cashMinor],['Customer amounts owed to the shop',t.customerDebtMinor],['Total opening assets',t.assetsMinor],['Supplier amounts owed by the shop',t.supplierPayableMinor],['Customer store-credit liability',t.storeCreditMinor],['Total opening liabilities',t.liabilitiesMinor],['Journal-backed opening equity',t.journalBackedOpeningNetMinor],['Net business value including preserved customer balances',t.netAssetsMinor],['Unresolved difference',t.differenceMinor]].map(([label,value])=><tr key={label}><th>{label}</th><td>{pkr(value)}</td></tr>)}</tbody></table></div>
    <p className="text-body-secondary">These values describe the reviewed opening snapshot, not live stock valuation or profit. Net customer balances ({pkr(t.legacyNetCustomerMinor)}) stay in the existing customer ledger and are not duplicated in the journal. New cash/stock asset openings and supplier debt use unallocated opening equity; no partner investment is created.</p>
    <p>Stock: {confirmed?'Confirmed':reviewed?'Reviewed — awaiting confirmation':saved?'Ready for your review':'Not reviewed yet'} · Customer review: {evidence.customerStatus.toLowerCase()}</p>
    {!evidence.inventory.length&&<p>No products are recorded. Opening stock quantity and value are 0. You can review and confirm this empty inventory; do not add a dummy product.</p>}
    <details className="mb-3"><summary>Review existing stock ({evidence.inventory.length} products)</summary><div className="table-responsive"><table className="table table-sm"><thead><tr><th>Product</th><th>Existing quantity</th><th>Cost per unit</th><th>Opening value</th></tr></thead><tbody>{evidence.inventory.map(row=><tr key={row._id}><td>{row.name}</td><td>{row.quantity}</td><td>{pkr(row.unitCostMinor)}</td><td>{pkr(row.valueMinor)}</td></tr>)}</tbody></table></div><p>No stock quantities are added by this setup. Correct product details or stock in their existing screens before reviewing again.</p></details>
    <details className="mb-3"><summary>Customer debt and store-credit review ({evidence.customers.length})</summary><div className="table-responsive"><table className="table table-sm"><thead><tr><th>Customer</th><th>Debt</th><th>Store credit</th><th>Review</th></tr></thead><tbody>{evidence.customers.map(row=><tr key={row._id}><td>{row.name}</td><td>{pkr(row.debtMinor)}</td><td>{pkr(row.storeCreditMinor)}</td><td>{row.reconciled?'Preserved / reconciled':'Blocked — history needs review'}</td></tr>)}</tbody></table></div></details>
    {!confirmed&&evidence.blockers.length>0&&<div className="alert alert-warning"><strong>Setup is incomplete or blocked</strong><ul className="mb-0">{evidence.blockers.map(message=><li key={message}>{message}</li>)}</ul></div>}
  </>;
}
export default function ExistingSetup(){
  const view=useLoad(root),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmation,setConfirmation]=useState('');
  const [snapshot,setSnapshot]=useState(null),[success,setSuccess]=useState(''),[dirty,setDirty]=useState(false),[inventoryReviewed,setInventoryReviewed]=useState(false);
  const current=snapshot??view.data,confirmed=current?.setup?.state==='CONFIRMED';
  async function review(){if(busy||dirty)return;setBusy(true);setError('');try{const result=await api(root+'/preview',{method:'POST',body:{expectedRevision:current.setup.revision}});setSnapshot({setup:result.setup,evidence:result.evidence});setPreview(result);setConfirmation('');setInventoryReviewed(false);setSuccess('');}catch(e){setError(e.message);setPreview(null);}finally{setBusy(false);}}
  function edited(){setDirty(true);setSuccess('');setPreview(null);setInventoryReviewed(false);setConfirmation('');}
  function saved(result){setSnapshot(result);setDirty(false);setPreview(null);setSuccess('Draft saved. Next: click Review for confirmation below. No opening balances have been posted and accounting has not been activated.');}
  function changed(){setSnapshot(null);setSuccess('');setDirty(false);setPreview(null);setConfirmation('');setInventoryReviewed(false);view.reload();}
  return <>
    <PageTitle title="Existing Business Setup"/>
    <AccountingActivation onChanged={changed}/>
    <p className="text-body-secondary">For new shops and shops that already trade. A new shop can start with no products and PKR 0 in every account. Never create fake sales, purchases or investments for setup.</p>
    <p>1. Enter and save opening details. 2. Review and confirm the setup. 3. Review activation readiness above and activate separately when ready.</p>
    <Notice loading={view.loading&&!snapshot} error={view.error}/>
    {current&&<SupplierAction operation="existing-setup-confirmation" onChanged={changed}>{({prepare,locked})=><>
      {confirmed&&<div className="alert alert-success">Opening setup confirmed by {current.setup.confirmedByName} on {pakistanTime(current.setup.confirmedAt)}. These are preserved opening values, not current balances. Accounting activation is a separate step above. Corrections require separate reconciliation; do not repeat this setup.</div>}
      {!confirmed&&current.setup&&!success&&<p className="text-body-secondary">{dirty?'You have unsaved changes. Save the draft before reviewing.':preview?'Review the stock and balances below, then confirm if correct.':'A draft is saved, but setup is not confirmed. Next: Review for confirmation below.'}</p>}
      <Review evidence={preview?.evidence||current.evidence} confirmed={confirmed} saved={!!current.setup} reviewed={inventoryReviewed}/>
      {!confirmed&&<section className="panel"><Draft key={current.setup?.revision??'new'} setup={current.setup} evidence={current.evidence} locked={locked||busy} onSaved={saved} onEdit={edited} success={success}/>
        <Notice error={error}/>
        {current.setup&&<button className="btn btn-outline-primary mt-3" disabled={busy||locked||dirty} onClick={review}>{busy?'Reviewing...':'Review for confirmation'}</button>}
        {preview&&<div className="border-top mt-3 pt-3"><p>Preview expires after 5 minutes. Any relevant record change requires a fresh review. Confirmation posts openings atomically and cannot be undone here. It does not activate accounting.</p><label className="d-block mb-3"><input type="checkbox" name="inventoryReviewed" className="form-check-input me-2" checked={inventoryReviewed} disabled={locked} onChange={e=>setInventoryReviewed(e.target.checked)}/>I reviewed the opening stock shown above{preview.evidence.inventory.length?'':': no products, quantity 0 and value PKR 0'}.</label><Field label="Type CONFIRM EXISTING BUSINESS SETUP"><input className="form-control" value={confirmation} disabled={locked} onChange={e=>setConfirmation(e.target.value)}/></Field><button className="btn btn-primary" disabled={locked||!inventoryReviewed||preview.evidence.blockers.length>0||confirmation!=='CONFIRM EXISTING BUSINESS SETUP'} onClick={()=>prepare({path:root+'/confirm',title:'Confirm existing business openings',summary:`Net opening value: ${pkr(preview.evidence.totals.netAssetsMinor)}.\nExisting stock quantities, customer debt and store credit will NOT be increased. Cash/bank and supplier openings become immutable.\nThis is unallocated opening equity, not a partner investment.`,body:{expectedRevision:preview.expectedRevision,previewToken:preview.previewToken,requestKey:crypto.randomUUID(),confirmation}})}>Confirm reviewed setup</button></div>}
      </section>}
      <p className="mt-3"><Link to="/owner/products">Products</Link> · <Link to="/owner/stock">Stock</Link> · <Link to="/owner/customers">Customers</Link> · <Link to="/owner/accounts/cash-bank">Cash &amp; Bank</Link> · <Link to="/owner/accounts/companies">Companies &amp; Suppliers</Link> · <Link to="/owner/partners">Partners &amp; Capital</Link></p>
    </>}</SupplierAction>}
  </>;
}
