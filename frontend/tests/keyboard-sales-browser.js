export const keyboardSalesChecks=String.raw`
  process.env.NODE_ENV='test';process.env.BUSINESS_ACCOUNTING_ENABLED='true';
  await login(owner.username);
  const keyboardCategory=ok(await browserHttp('POST','/categories/create-category',{name:'Keyboard sale category'})).category;
  const keyboardProduct=ok(await browserHttp('POST','/products/create-product',{name:'Keyboard Cable',brand:'Keyboard',category:keyboardCategory._id,unit:'coil',costPrice:2500,retailPrice:4000,wholesalePrice:3500,stockQuantity:20})).product;
  ok(await browserHttp('POST','/products/create-product',{name:'Keyboard Extra',brand:'Keyboard',category:keyboardCategory._id,unit:'coil',costPrice:1,retailPrice:10,wholesalePrice:8,stockQuantity:10}));
  const keyPress=async(key,code=key,vk)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{}),...(vk?{windowsVirtualKeyCode:vk}:{})});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,...(vk?{windowsVirtualKeyCode:vk}:{})});};
  for(const actor of [owner,cashier]){
    await login(actor.username);await navigation(actor.role==='OWNER'?'/owner/sales':'/cashier/pos');
    await wait('!!document.querySelector(".product-filter-search")');
    if(actor.role==='CASHIER')await fill('[aria-label="Sale type"]','WHOLESALE');
    await keyPress('F2','F2',113);
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Search products by name or brand');
    await send('Input.insertText',{text:'Keyboard'});await wait('document.querySelectorAll(".product-result").length===2');
    await keyPress('ArrowDown','ArrowDown',40);await keyPress('ArrowUp','ArrowUp',38);await keyPress('Enter','Enter',13);
    await wait('document.activeElement.getAttribute("aria-label")==="Quantity for Keyboard Cable"');
    assert.equal(await evaluate('document.activeElement.value'),'1');await send('Input.insertText',{text:'2'});
    await keyPress('Enter','Enter',13);assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Selling price for Keyboard Cable');
    assert.equal(Number(await evaluate('document.activeElement.value')),actor.role==='CASHIER'?3500:4000);
    await send('Input.insertText',{text:'3900'});await keyPress('Enter','Enter',13);
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Discount per unit for Keyboard Cable');
    assert.equal(await evaluate('document.activeElement.value'),'0');await send('Input.insertText',{text:'200'});await keyPress('Enter','Enter',13);
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Search products by name or brand');
    await keyPress('Tab','Tab',9);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Search products by name or brand');
    await keyPress('Escape','Escape',27);assert.equal(await evaluate('document.querySelector("#pos-suggestions").hidden'),true);
    await keyPress('F2','F2',113);assert.equal(await evaluate('document.querySelector("#pos-suggestions").hidden'),false);
    await fill('#sale-form select:not([aria-label])','PERCENTAGE');await label('Percent','10');
    await fill('[aria-label="Payment account"]',String(cash._id));
    const before=(await Product.findById(keyboardProduct._id)).stockQuantity,cashBefore=ok(await api(owner,'GET','/accounts/financial/'+cash._id)).balanceMinor;
    // Native Enter on the checkout button; no click handler or request is mocked.
    assert.equal(await evaluate('document.querySelector("#sale-form").checkValidity()'),true);await evaluate('document.querySelector("button[form=sale-form]").focus()');await keyPress('Enter','Enter',13);
    await wait('!!document.querySelector(".receipt")');
    const saved=await Order.findOne({shopId:shop._id,createdBy:actor._id,'items.productId':keyboardProduct._id}).sort({_id:-1}).lean();
    assert.equal(saved.totalPrice,6660);assert.equal(saved.items[0].unitPrice,3700);assert.equal(saved.items[0].itemDiscount,200);assert.equal(saved.items[0].sellingPrice,3900);
    assert.equal((await Product.findById(keyboardProduct._id)).stockQuantity,before-2);assert.equal(ok(await api(owner,'GET','/accounts/financial/'+cash._id)).balanceMinor,cashBefore+666000);
    assert.equal((await Product.findById(keyboardProduct._id)).retailPrice,4000);assert.equal((await Product.findById(keyboardProduct._id)).costPrice,2500);
    assert.ok(await evaluate('document.querySelector(".receipt").textContent.includes("discount 200.00")'));
    if(actor.role==='CASHIER'){const found=ok(await get('/products/search-product?search=Keyboard')).product;assert.ok(found.every(p=>!Object.hasOwn(p,'costPrice')));}
  }
  await login(owner.username);pass('OWNER and CASHIER keyboard sale: F2, arrows, quantity/rate/discount Enter flow, retail/wholesale defaults, custom net rates, invoice discount, stock/cash and receipt attribution');
`;
