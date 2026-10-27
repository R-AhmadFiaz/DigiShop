// Actual React, HTTP and transactions in the existing disposable replica-set runner.
export const unifiedPOSChecks=String.raw`
{
  process.env.NODE_ENV='test';process.env.BUSINESS_ACCOUNTING_ENABLED='true';
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
  await login(owner.username);
  const gridCategory=ok(await browserHttp('POST','/categories/create-category',{name:'Unified invoice category'})).category;
  const gridProducts=[];
  for(let i=1;i<=30;i++)gridProducts.push(ok(await browserHttp('POST','/products/create-product',{name:'Grid '+String(i).padStart(2,'0'),brand:'Unified',category:gridCategory._id,unit:'piece',costPrice:5,retailPrice:10,wholesalePrice:8,stockQuantity:3})).product);
  const gridBuyer=ok(await browserHttp('POST','/customers/create-customer',{name:'Grid customer',phoneNo:'03001230099'})).customer;
  await navigation('/owner/sales');await wait('!!document.querySelector(".pos-unified")');
  const gridKey=async(key,code=key,vk,modifiers=0)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{}),...(vk?{windowsVirtualKeyCode:vk}:{})});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers,...(vk?{windowsVirtualKeyCode:vk}:{})});};
  for(const p of gridProducts){
    await fill('[aria-label="Search products by name or brand"]',p.name);
    await wait('document.querySelectorAll(".product-result:not(:disabled)").length===1');
    await gridKey('Enter','Enter',13);await wait('document.activeElement.dataset.itemField==="quantity"');
    assert.equal(await evaluate('document.activeElement.value'),'1');
    await gridKey('Enter','Enter',13);assert.equal(await evaluate('document.activeElement.value'),'10');
    await gridKey('Enter','Enter',13);assert.equal(await evaluate('document.activeElement.value'),'0');
    await gridKey('Enter','Enter',13);
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Search products by name or brand');
  }
  assert.equal(await evaluate('document.querySelectorAll(".cart-table tbody tr:not(.pos-entry-row)").length'),30);
  const shots=path.join(frontend,'tests/artifacts/unified-pos');await fs.mkdir(shots,{recursive:true});
  for(const [width,height] of [[1280,720],[1366,768],[1920,1080]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(150);
    assert.ok(await evaluate('document.scrollingElement.scrollHeight<=innerHeight+2'),'No page-level vertical scrolling');
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'No horizontal page overflow');
    await evaluate('document.querySelector(".more-nav > summary").focus()');await gridKey('Enter','Enter',13);
    assert.equal(await evaluate('document.querySelector(".more-nav").open'),true);
    await gridKey('Tab','Tab',9);assert.ok(await evaluate('document.activeElement.matches(".navigation-overflow a")'));
    await gridKey('Escape','Escape',27);assert.equal(await evaluate('document.querySelector(".more-nav").open'),false);
    assert.ok(await evaluate('(()=>{const n=document.querySelector(".sidebar").getBoundingClientRect(),w=document.querySelector(".workspace").getBoundingClientRect();return n.width>innerWidth-40&&n.bottom<=w.top;})()'),'Shared navigation is above workspace');
    assert.ok(await evaluate('(()=>{const s=document.querySelector(".pos-search-panel").getBoundingClientRect(),i=document.querySelector(".pos-lines").getBoundingClientRect();return s.left>=i.right&&s.bottom<=innerHeight;})()'),'Search stays to the right of invoice');
    await gridKey('F6','F6',117);await gridKey('ArrowUp','ArrowUp',38);
    assert.equal(await evaluate('window.scrollY'),0);
    assert.ok(await evaluate('(()=>{const h=document.querySelector(".cart-table th").getBoundingClientRect(),g=document.querySelector(".pos-lines").getBoundingClientRect();return h.top>=g.top-1&&h.bottom<=g.bottom;})()'),'Invoice headings remain visible');
    assert.ok(await evaluate('document.querySelector(".pos-lines").scrollHeight>document.querySelector(".pos-lines").clientHeight'),'Only invoice grid grows');
    for(const selector of ['.pos-payments','.pos-checkout','button[form=sale-form]'])assert.ok(await evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()'),'Checkout remains visible: '+selector);
    await evaluate('document.querySelector(".pos-lines").scrollTop=0');assert.equal(await evaluate('window.scrollY'),0);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(shots,'invoice-30-'+width+'x'+height+'.png'),Buffer.from(shot.data,'base64'));
  }
  await fill('[aria-label="Quantity for Grid 01"]','0');await click('Complete sale');
  assert.ok(await evaluate('document.querySelector(".pos-error").textContent.includes("Quantities")'));
  assert.equal(await Order.countDocuments({shopId:shop._id,'items.productId':gridProducts[0]._id}),0);
  await fill('[aria-label="Quantity for Grid 01"]','1');await fill('[aria-label="Selling price for Grid 01"]','12');await fill('[aria-label="Discount per unit for Grid 01"]','1');
  await evaluate('document.querySelector('+JSON.stringify('[aria-label="Remove Grid 30"]')+').click()');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Search products by name or brand');
  await fill('[aria-label="Search products by name or brand"]','Grid 30');await wait('document.querySelectorAll(".product-result:not(:disabled)").length===1');
  await gridKey('Enter','Enter',13);await wait('document.activeElement.dataset.itemField==="quantity"');
  await gridKey('Enter','Enter',13);await gridKey('Enter','Enter',13);await gridKey('Enter','Enter',13);
  assert.equal(await evaluate('document.querySelectorAll(".cart-table tbody tr:not(.pos-entry-row)").length'),30);
  // Start at search and use native Tab/Enter through payment and customer selection.
  await gridKey('F2','F2',113);await gridKey('Escape','Escape',27);
  for(let n=0;n<12&&!await evaluate('document.activeElement.closest("label")?.textContent.startsWith("Amount paid")');n++)await gridKey('Tab','Tab',9);
  assert.ok(await evaluate('document.activeElement.closest("label")?.textContent.startsWith("Amount paid")'));
  await gridKey('a','KeyA',65,2);await send('Input.insertText',{text:'100'});await gridKey('Tab','Tab',9);
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Payment account');
  await gridKey('Home','Home',36);
  for(let n=0;n<10&&await evaluate('document.activeElement.value')!==String(cash._id);n++)await gridKey('ArrowDown','ArrowDown',40);
  assert.equal(await evaluate('document.activeElement.value'),String(cash._id));await gridKey('Tab','Tab',9);
  assert.equal(await evaluate('document.activeElement.textContent'),'Select customer');await gridKey('Enter','Enter',13);
  await wait('!!document.querySelector("dialog:not(.navigation-drawer)[open]")');
  for(let n=0;n<6&&await evaluate('document.activeElement.getAttribute("aria-label")')!=='Search customer by name or phone';n++)await gridKey('Tab','Tab',9);
  await send('Input.insertText',{text:'Grid customer'});await wait('document.querySelectorAll(".customer-result").length===1');
  for(let n=0;n<6&&!await evaluate('document.activeElement.classList.contains("customer-result")');n++)await gridKey('Tab','Tab',9);
  await gridKey('Enter','Enter',13);await wait('!document.querySelector("dialog:not(.navigation-drawer)[open]")');
  const before=ok(await api(owner,'GET','/accounts/financial/'+cash._id)).balanceMinor;
  for(let n=0;n<8&&await evaluate('document.activeElement.textContent')!=='Complete sale';n++)await gridKey('Tab','Tab',9);
  assert.equal(await evaluate('document.activeElement.textContent'),'Complete sale');await gridKey('Enter','Enter',13);await wait('!!document.querySelector(".receipt")');
  const saved=await Order.findOne({shopId:shop._id,'items.productId':gridProducts[0]._id}).lean();
  assert.equal(saved.items.length,30);assert.equal(saved.totalPrice,301);assert.equal(saved.paidAmount,100);assert.equal(saved.amountDue,201);
  assert.equal((await Customer.findById(gridBuyer._id)).remainingMoney,201);
  assert.equal(ok(await api(owner,'GET','/accounts/financial/'+cash._id)).balanceMinor,before+10000);
  for(const p of gridProducts)assert.equal((await Product.findById(p._id)).stockQuantity,2);
  pass('Desktop POS: 30 keyboard-entered rows, right search, top navigation, fixed checkout at 1280x720/1366x768/1920x1080, inline errors, row edits, keyboard partial payment/customer choice and persisted stock/debt/cash');
  await click('Next sale');
  for(const width of [390,768]){await send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:true});await sleep(100);assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));}
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
  const denseCategory=ok(await browserHttp('POST','/categories/create-category',{name:'Dense POS fixtures'})).category;
  const denseProducts=await Product.insertMany(Array.from({length:105},(_,i)=>({shopId:shop._id,name:'Dense '+String(i+1).padStart(3,'0'),slug:'dense-pos-'+i,brand:'Dense',category:denseCategory._id,unit:'piece',costPrice:5,retailPrice:10,wholesalePrice:8,stockQuantity:2})));
  // Remount to load the new fixtures, then use the actual autocomplete for all 100 rows.
  await navigation('/owner/sales');await wait('!!document.querySelector(".pos-search-panel")');
  await fill('[aria-label="Search products by name or brand"]','Dense');await wait('document.querySelectorAll(".product-result").length===105');
  assert.ok(await evaluate('document.querySelector(".product-results").scrollHeight>document.querySelector(".product-results").clientHeight'));
  for(let i=0;i<100;i++){
    await fill('[aria-label="Search products by name or brand"]',denseProducts[i].name);await wait('document.querySelectorAll(".product-result:not(:disabled)").length===1');
    await gridKey('Enter','Enter',13);await wait('document.activeElement.dataset.itemField==="quantity"');
    await gridKey('Enter','Enter',13);await gridKey('Enter','Enter',13);await gridKey('Enter','Enter',13);
    if([5,20,30,100].includes(i+1)){
      assert.equal(await evaluate('document.querySelectorAll(".quantity").length'),i+1);
      assert.ok(await evaluate('document.scrollingElement.scrollHeight<=innerHeight+2'));
      assert.ok(await evaluate('document.querySelector("button[form=sale-form]").getBoundingClientRect().bottom<=innerHeight'));
    }
  }
  await gridKey('F6','F6',117);await gridKey('Enter','Enter',13);
  assert.ok(await evaluate('(()=>{const f=document.activeElement.getBoundingClientRect(),g=document.querySelector(".pos-lines").getBoundingClientRect();return f.top>=g.top&&f.bottom<=g.bottom;})()'),'Focused last row visible in 100-line invoice');
  await gridKey('Escape','Escape',27);await gridKey('F2','F2',113);await fill('[aria-label="Search products by name or brand"]','Dense');await wait('document.querySelectorAll(".product-result").length===105');
  for(let n=0;n<104;n++)await gridKey('ArrowDown','ArrowDown',40);
  assert.ok(await evaluate('(()=>{const a=document.getElementById(document.querySelector(".product-filter-search").getAttribute("aria-activedescendant")).getBoundingClientRect(),r=document.querySelector(".product-results").getBoundingClientRect();return a.top>=r.top-1&&a.bottom<=r.bottom+1;})()'),'Highlighted suggestion is visible');
  assert.equal(await evaluate('window.scrollY'),0);
  const denseShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(shots,'invoice-100.png'),Buffer.from(denseShot.data,'base64'));
  pass('100 invoice rows and 105 suggestions independently scroll; 5/20/30/100 row checkout visibility, selected input and highlighted result stay inside workspace');
}
`;
