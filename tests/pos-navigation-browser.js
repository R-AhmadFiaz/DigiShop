// Real browser checks injected into the disposable MongoDB integration runner.
export const posNavigationChecks=String.raw`
{
  process.env.NODE_ENV='test';process.env.BUSINESS_ACCOUNTING_ENABLED='true';
  await login(owner.username);
  const navCategory=ok(await browserHttp('POST','/categories/create-category',{name:'Navigation fixtures'})).category;
  const navProducts=await Product.insertMany(Array.from({length:105},(_,i)=>({shopId:shop._id,name:'NavItem '+String(i+1).padStart(3,'0'),slug:'nav-item-'+i,brand:'Navigation',category:navCategory._id,unit:'piece',costPrice:5,retailPrice:10,wholesalePrice:8,stockQuantity:i===104?0:20})));
  const navKey=async(key,vk,modifiers=0)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,modifiers,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{}),windowsVirtualKeyCode:vk});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,modifiers,windowsVirtualKeyCode:vk});};
  for(const actor of [owner,cashier]){
    await login(actor.username);await navigation(actor.role==='OWNER'?'/owner/sales':'/cashier/pos');
    await wait('!!document.querySelector(".product-filter-search")');
    await navKey('F2',113);await send('Input.insertText',{text:'NavItem'});
    await wait('document.querySelectorAll(".product-result").length===105');
    assert.equal(await evaluate('[...document.querySelectorAll(".product-result")].every(p=>p.tabIndex===-1)'),true);
    await navKey('ArrowDown',40);assert.equal(await evaluate('document.activeElement.classList.contains("product-filter-search")'),true);
    await navKey('Tab',9);assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'POS category filter');
    await navKey('Tab',9,8);assert.equal(await evaluate('document.activeElement.classList.contains("product-filter-search")'),true);
    await navKey('Escape',27);assert.equal(await evaluate('document.querySelector("#pos-suggestions").hidden'),true);
    for(let i=0;i<7;i++){
      await navKey('F2',113);await send('Input.insertText',{text:navProducts[i].name});await wait('document.querySelectorAll(".product-result").length===1');
      await navKey('Enter',13);await wait('document.activeElement.dataset.itemField==="quantity"');
      await navKey('Tab',9);assert.equal(await evaluate('document.activeElement.dataset.itemField'),'price');
      await navKey('Tab',9);assert.equal(await evaluate('document.activeElement.dataset.itemField'),'discount');
      await navKey('Enter',13);assert.equal(await evaluate('document.activeElement.classList.contains("product-filter-search")'),true);
    }
    assert.equal(await evaluate('document.querySelectorAll(".quantity").length'),7);
    await navKey('F6',117);assert.equal(await evaluate('document.activeElement.classList.contains("pos-lines")'),true);
    await navKey('ArrowDown',40);await navKey('ArrowUp',38);await navKey('Enter',13);
    await navKey('Delete',46);assert.equal(await evaluate('document.querySelectorAll(".quantity").length'),7);assert.equal(await evaluate('!!document.querySelector("dialog[open]:not(.navigation-drawer)")'),false);await fill('.pos-row-selected .quantity','2');await navKey('Escape',27);
    assert.equal(await evaluate('document.querySelector(".pos-row-selected .quantity").value'),'1');
    assert.equal(await evaluate('document.activeElement.classList.contains("pos-lines")'),true);
    await navKey('Enter',13);await fill('.pos-row-selected .quantity','2');await navKey('Tab',9);await navKey('Tab',9);await navKey('Enter',13);
    await navKey('F6',117);await navKey('Delete',46);await wait('!!document.querySelector("dialog[open]:not(.navigation-drawer)")');
    assert.equal(await evaluate('document.querySelectorAll(".quantity").length'),7);await navKey('Escape',27);await wait('document.activeElement.classList.contains("pos-lines")');
    await navKey('Delete',46);await click('Remove item');await wait('document.querySelectorAll(".quantity").length===6');
    await navKey('F2',113);await send('Input.insertText',{text:'NavItem 105'});await wait('document.querySelectorAll(".product-result").length===1');await navKey('Enter',13);assert.equal(await evaluate('document.querySelectorAll(".quantity").length'),6);
    await navKey('F4',115);assert.equal(await evaluate('document.activeElement.getAttribute("aria-keyshortcuts")'),'F4');
    await fill('[aria-keyshortcuts="F4"]','0');await navKey('F10',121);
    assert.equal(await evaluate('!!document.querySelector("dialog[open]:not(.navigation-drawer)")'),false);
    assert.ok(await evaluate('document.querySelector(".pos-error").textContent.toLowerCase().includes("customer")'));
    await fill('[aria-keyshortcuts="F4"]','60');await fill('[aria-label="Payment account"]',String(cash._id));
    const navCount=await Order.countDocuments({shopId:shop._id}),navCash=ok(await api(owner,'GET','/accounts/financial/'+cash._id)).balanceMinor;
    await navKey('F10',121);await wait('!!document.querySelector("dialog[open]:not(.navigation-drawer)")');
    await navKey('F10',121);assert.equal(await Order.countDocuments({shopId:shop._id}),navCount);
    await click('Back to invoice');await navKey('F10',121);
    await evaluate('(()=>{const b=[...document.querySelectorAll("dialog[open] button")].find(b=>b.textContent==="Confirm sale");b.click();b.click();})()');
    await wait('!!document.querySelector(".receipt")');assert.equal(await Order.countDocuments({shopId:shop._id}),navCount+1);
    assert.equal(ok(await api(owner,'GET','/accounts/financial/'+cash._id)).balanceMinor,navCash+6000);
    const navOrder=await Order.findOne({shopId:shop._id,createdBy:actor._id}).sort({_id:-1}).lean();assert.equal(navOrder.totalPrice,60);assert.equal(navOrder.items.length,6);
  }
  await login(owner.username);pass('OWNER/CASHIER: 105 suggestions skip Tab; seven keyboard products; F6 row navigation, Escape rollback, confirmed Delete; F4 and validated/confirmed F10 with persisted single sale and cash');
}
`;
