// Appended to the existing real HTTP / disposable replica-set browser runner.
export const mobileChecks=String.raw`
  process.env.NODE_ENV='test';process.env.BUSINESS_ACCOUNTING_ENABLED='true';
  const menuClick=async label=>{await evaluate('document.querySelector('+JSON.stringify('[aria-label="'+label+'"]')+').click()');};
  await login(owner.username);
  for(const width of [320,375,390,768]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:true});
    await navigation('/owner/accounts/suppliers/'+supplier._id);
    await wait('!!document.querySelector(".mobile-brand-bar button")');
    await wait('!!document.querySelector("#supplier-payment")&&!!document.querySelector(".record-table tbody tr")');
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    const shots=path.join(frontend,'tests/artifacts/mobile-navigation');await fs.mkdir(shots,{recursive:true});
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(shots,'supplier-'+width+'.png'),Buffer.from(shot.data,'base64'));
    await menuClick('Open navigation');await wait('document.querySelector("#shop-navigation").open');
    assert.equal(await evaluate('document.body.style.overflow'),'hidden');assert.equal(await evaluate('document.documentElement.style.overflow'),'hidden');
    assert.equal(await evaluate('document.querySelector("#shop-navigation").contains(document.activeElement)'),true);
    assert.ok(await evaluate('document.querySelector("#shop-navigation").getBoundingClientRect().right<=innerWidth'));
    assert.ok(await evaluate('[...document.querySelectorAll("#shop-navigation a")].some(a=>a.textContent==="Suppliers")'));
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    assert.equal(await evaluate('document.querySelector("#shop-navigation").contains(document.activeElement)'),true);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await wait('!document.querySelector("#shop-navigation").open');
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Open navigation');
    await menuClick('Open navigation');await menuClick('Close navigation');await wait('!document.querySelector("#shop-navigation").open');
    await menuClick('Open navigation');
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:width-5,y:30,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:width-5,y:30,button:'left',clickCount:1});
    await wait('!document.querySelector("#shop-navigation").open');
    await menuClick('Open navigation');await evaluate('[...document.querySelectorAll("#shop-navigation a")].find(a=>a.pathname==="/owner/products").click()');
    await wait('location.pathname==="/owner/products"&&!document.querySelector("#shop-navigation").open');
    assert.notEqual(await evaluate('document.body.style.overflow'),'hidden');
  }
  pass('mobile drawer at 320/375/390/768: viewport, OWNER destinations, focus containment, Escape/focus restore, close, backdrop and navigation');
  await login(cashier.username);await menuClick('Open navigation');
  assert.equal(await evaluate('[...document.querySelectorAll("#shop-navigation a")].some(a=>a.pathname.startsWith("/owner"))'),false);
  assert.ok(await evaluate('[...document.querySelectorAll("#shop-navigation a")].some(a=>a.textContent==="POS")'));
  await menuClick('Close navigation');await login(owner.username);
  pass('cashier mobile navigation preserves its existing role destinations');
  await navigation('/owner/accounts/suppliers/'+supplier._id);
  await wait('!!document.querySelector("#supplier-payment")');
  assert.equal(await evaluate('document.body.textContent.includes("Find payment account")'),false);
  assert.ok(await evaluate('document.body.textContent.includes("Pay from (Cash / Bank)")'));
  for(const [account,note] of [[cash,''],[bank,'Bank transfer note']]){
    await evaluate('document.querySelector("#supplier-payment").open=true');
    const before=ok(await get('/accounts/financial/'+account._id)).balanceMinor;
    const debt=ok(await get('/accounts/suppliers/'+supplier._id+'/balance')).balanceMinor;
    await selectPaymentAccount(account._id);
    assert.equal(await evaluate('document.querySelector("#supplier-payment [name=reason]").required'),false);
    await label('Payment amount (PKR)','0.01');await label('Payment note',note);
    await click('Review supplier payment');await click('Confirm payment sent');
    await wait('!document.querySelector("dialog:not(.navigation-drawer)[open]")');
    assert.equal(ok(await get('/accounts/financial/'+account._id)).balanceMinor,before-1);
    assert.equal(ok(await get('/accounts/suppliers/'+supplier._id+'/balance')).balanceMinor,debt-1);
    const event=await SupplierSettlement.findOne({shopId:shop._id,supplierId:supplier._id,kind:'PAYMENT'}).sort({_id:-1}).lean();
    assert.equal(event.reason,note||'Supplier payment');assert.match(event.reference,/^SP-[1-9][0-9]*$/);
    assert.equal(await BusinessTransaction.countDocuments({shopId:shop._id,'source.referenceId':event._id}),1);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
  assert.ok(await evaluate('document.querySelector("#shop-navigation nav").getBoundingClientRect().width>0'));
  assert.equal(await evaluate('(()=>{const a=document.querySelector("#shop-navigation a");a.focus();return document.activeElement===a;})()'),true);
  pass('actual supplier route: one searchable picker, cash/bank balances, blank/supplied notes, SP references and one journal per confirmed payment');
`;
