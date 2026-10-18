// Added to the existing real-HTTP/disposable-replica-set browser harness.
export const purchaseChecks=String.raw`
  await login(owner.username);
  const reviewOpening=ok(await get('/accounts/suppliers/'+supplier._id+'/balance')).balanceMinor;
  const reviewCoil=ok(await browserHttp('POST','/products/create-product',{name:'Purchase Review Copper Cable 3/29 Black Coil 90 metre pack',brand:'Review Wire',category:category._id,unit:'coil',costPrice:3000,retailPrice:4000,wholesalePrice:3900,stockQuantity:0,minStockThreshold:1})).product;
  const reviewBulb=ok(await browserHttp('POST','/products/create-product',{name:'Purchase Review LED Bulb',brand:'Review Lighting',category:category._id,unit:'pcs',costPrice:500,retailPrice:650,wholesalePrice:600,stockQuantity:0,minStockThreshold:1})).product;
  await navigation('/owner/purchases');await click('Create purchase order');await label('Find supplier','Integration Supplier');await sleep(300);await click('Integration Supplier');
  for(const [p,quantity,cost] of [[reviewCoil,10,'3000'],[reviewBulb,4,'500']]){
    await label('Find purchase products',p.name);await sleep(300);await click('Add '+p.name);
    await fill('[aria-label="Quantity for '+p.name+'"]',quantity);await fill('[aria-label="Unit cost for '+p.name+'"]',cost);
  }
  await click('Review purchase order');await record();
  let reviewPo=await PurchaseOrder.findOne({shopId:shop._id,'items.productId':reviewCoil._id}).lean();
  assert.equal(reviewPo.totalMinor,3200000);
  const reviewRow='[aria-label="Purchase order register"] tr[data-record-id="'+reviewPo._id+'"]';
  await wait('!!document.querySelector('+JSON.stringify(reviewRow)+')');
  assert.equal(await evaluate('document.querySelector('+JSON.stringify(reviewRow)+').querySelectorAll("a").length'),1);
  assert.equal(await evaluate('document.querySelector('+JSON.stringify(reviewRow)+').querySelectorAll("button").length'),0);
  await evaluate('document.querySelector('+JSON.stringify(reviewRow)+').querySelector("a").click()');
  const reviewProductsSelector='[aria-label="Purchase products"]';
  const reviewActivitySelector='[aria-label="Purchase activity register"]';
  await wait('!!document.querySelector('+JSON.stringify(reviewProductsSelector)+')');
  await click('Confirm order');await record();await wait('document.body.innerText.includes("Receive delivery")');
  async function reviewReceive(coils,bulbs){
    await fill('[aria-label="Delivered '+reviewCoil.name+'"]',coils);await fill('[aria-label="Delivered '+reviewBulb.name+'"]',bulbs);
    await click('Review delivered quantities');await record();
    const row=await GoodsReceipt.findOne({purchaseOrderId:reviewPo._id}).sort({_id:-1}).lean();
    await wait('document.body.innerText.includes('+JSON.stringify(row.reference)+')');return row;
  }
  const reviewFirst=await reviewReceive(5,2);
  const reviewSecond=await reviewReceive(3,2);
  async function reviewReturn(receipt,product,quantity){
    const selector='[aria-label="Purchase activity register"] tr[data-record-id="'+receipt._id+'"]';
    await wait('!!document.querySelector('+JSON.stringify(selector)+')');
    await evaluate('document.querySelector('+JSON.stringify(selector)+').querySelector("button").click()');
    await label('Return '+product.name,quantity);await label('Return reason','Supplier accepted actual goods in isolated purchase review');
    await click('Review return');await record();await wait('!document.querySelector('+JSON.stringify('section[aria-label="Purchase return"]')+')');
    return SupplierSettlement.findOne({receiptId:receipt._id,kind:'RETURN'}).sort({_id:-1}).lean();
  }
  const reviewReturnOne=await reviewReturn(reviewFirst,reviewCoil,2);
  const reviewReturnTwo=await reviewReturn(reviewFirst,reviewCoil,1);
  const reviewReturnThree=await reviewReturn(reviewSecond,reviewBulb,1);
  assert.deepEqual([reviewReturnOne.amountMinor,reviewReturnTwo.amountMinor,reviewReturnThree.amountMinor],[600000,300000,50000]);
  ok(await browserHttp('POST','/accounts/suppliers/'+supplier._id+'/settlements/'+reviewReturnOne._id+'/reverse',{requestKey:crypto.randomUUID(),reason:'Returned coils physically restored',occurredAt:new Date().toISOString(),confirmation:'CONFIRM SUPPLIER REVERSAL'}));
  await click('Refresh');
  await wait('(()=>{const labels=[...document.querySelectorAll(".balance-strip dt")];return labels.find(e=>e.textContent==="Net quantity kept")?.nextElementSibling.textContent==="10";})()');
  const reviewCells=await evaluate('[...document.querySelectorAll('+JSON.stringify(reviewProductsSelector+' tbody > tr[data-record-id]')+')].map(r=>[...r.cells].slice(0,5).map(c=>c.innerText))');
  assert.deepEqual(reviewCells.map(r=>r.slice(1)),[['10','8','1','7'],['4','4','1','3']]);
  assert.equal(await evaluate('document.querySelectorAll('+JSON.stringify(reviewActivitySelector+' tr[data-record-id]')+').length'),6);
  assert.ok(await evaluate('document.body.innerText.includes("Return corrected")'));
  const reviewReturnSelector=reviewActivitySelector+' tr[data-record-id="'+reviewReturnOne._id+'"]';
  assert.equal(await evaluate('document.querySelector('+JSON.stringify(reviewReturnSelector)+').querySelectorAll("button").length'),1,'Return rows have one details action');
  await evaluate('document.querySelector('+JSON.stringify(reviewReturnSelector)+').querySelector("button").click()');
  await wait('!!document.querySelector(".record-detail")');
  assert.ok(await evaluate('document.querySelector(".record-detail").innerText.includes('+JSON.stringify(reviewFirst.reference)+')'));
  await evaluate('document.querySelector('+JSON.stringify(reviewReturnSelector)+').querySelector("button").click()');
  const reviewDates=await evaluate('[...document.querySelectorAll('+JSON.stringify(reviewActivitySelector+' tbody > tr[data-record-id]')+')].map(r=>r.cells[0].innerText)');
  assert.equal(reviewDates.length,6);
  assert.equal((await Product.findById(reviewCoil._id)).stockQuantity,7);assert.equal((await Product.findById(reviewBulb._id)).stockQuantity,3);
  assert.equal(ok(await get('/accounts/suppliers/'+supplier._id+'/balance')).balanceMinor,reviewOpening+2250000);
  reviewPo=await PurchaseOrder.findById(reviewPo._id).lean();assert.deepEqual(reviewPo.items.map(i=>i.receivedQuantity),[8,4]);
  assert.equal(reviewPo.status,'PARTIALLY_RECEIVED');assert.equal(await GoodsReceipt.countDocuments({purchaseOrderId:reviewPo._id}),2);
  const reviewReturnRows=await SupplierSettlement.find({receiptId:{$in:[reviewFirst._id,reviewSecond._id]}}).lean();assert.equal(reviewReturnRows.length,4);
  pass('Purchase redesign: real multi-product order, two partial deliveries, three returns and reversal; received 12, returned 2, kept 10; exact original costs, stock and supplier debt');
  const reviewShots=path.join(frontend,'tests/artifacts/purchase-review');await fs.mkdir(reviewShots,{recursive:true});
  async function reviewCapture(name){
    for(const width of [1366,1920,768,390]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await evaluate(width<1000?'document.querySelector(".page-title").scrollIntoView({block:"start"})':'window.scrollTo(0,0)');await sleep(120);
      const layout=await evaluate('({overflow:document.documentElement.scrollWidth>innerWidth,cells:[...document.querySelectorAll(".record-register th,.record-register td")].filter(e=>e.checkVisibility()).map(e=>getComputedStyle(e).textAlign),tables:[...document.querySelectorAll(".record-register")].filter(e=>e.checkVisibility()).map(e=>({height:e.clientHeight,contentHeight:e.scrollHeight}))})');
      assert.equal(layout.overflow,false);assert.ok(layout.cells.every(a=>a==='center'));for(const table of layout.tables)assert.ok(table.contentHeight<=table.height+2);
      const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(reviewShots,name+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
    }
  }
  await reviewCapture('details');
  await navigation('/owner/purchases');
  await wait('(()=>{const r=document.querySelector('+JSON.stringify(reviewRow)+');return r?.cells[5].innerText==="2";})()');
  assert.equal(await evaluate('document.querySelectorAll('+JSON.stringify('[aria-label="Purchase order register"] tr[data-record-id]')+').length>1'),true);
  await reviewCapture('history');
  ok(await browserHttp('POST','/purchases/'+reviewPo._id+'/cancel',{requestKey:crypto.randomUUID(),expectedRevision:reviewPo.revision,reason:'Supplier will not deliver remaining two coils'}));
  await navigation('/owner/purchases/'+reviewPo._id);await wait('document.body.innerText.includes("Cancelled")');
  await wait('(()=>{const labels=[...document.querySelectorAll(".balance-strip dt")];return labels.find(e=>e.textContent==="Net quantity kept")?.nextElementSibling.textContent==="10";})()');
  assert.equal((await Product.findById(reviewCoil._id)).stockQuantity,7);assert.equal(ok(await get('/accounts/suppliers/'+supplier._id+'/balance')).balanceMinor,reviewOpening+2250000);
  pass('Purchase redesign: one View link, correct history totals, cancelled remaining order preserves deliveries/returns, centered desktop/tablet/mobile tables and screenshots');
`;
