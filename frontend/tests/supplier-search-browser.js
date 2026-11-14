// Real browser/HTTP checks appended only to the disposable local replica-set runner.
export const supplierSearchChecks=String.raw`
  const searchField=label=>'document.querySelector('+JSON.stringify('[aria-label="'+label+'"]')+')';
  const searchValue=label=>evaluate(searchField(label)+'.value');
  const searchOptions=label=>evaluate('[...'+searchField(label)+'.options].map(o=>o.textContent)');
  async function searchFill(selector,value){
    await wait('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');return e&&(e.tagName!=="SELECT"||[...e.options].some(o=>o.value==='+JSON.stringify(String(value))+'));})()');
    return fill(selector,value);
  }
  await login(owner.username);await navigation('/owner/accounts/companies');await click('Add supplier');
  assert.equal(await evaluate('document.querySelectorAll("dialog input[type=checkbox]").length'),0);
  assert.equal(await evaluate('document.querySelectorAll("dialog input").length'),3);
  await searchFill('dialog [name=name]','Search Test Supplier');await searchFill('dialog [name=phoneNo]','03009990001');await searchFill('dialog [name=address]','Test market');await click('Save supplier');
  await wait('!document.querySelector("dialog[open]")');await searchFill('[aria-label="Search businesses"]','Search Test Supplier');await sleep(350);
  const simpleSupplier=await BusinessEntity.findOne({shopId:shop._id,name:'Search Test Supplier'}).lean();assert.deepEqual(simpleSupplier.roles,['SUPPLIER']);
  await click('View supplier');await wait('document.body.innerText.includes("Test market")');
  assert.ok(await evaluate('document.body.innerText.includes("03009990001")'));
  assert.equal(await evaluate('document.body.innerText.includes("Brand associations")'),false);
  assert.ok(await evaluate('document.body.innerText.includes("Supplier balance unavailable")'));
  await click('Business setup (Advanced)');await wait('!!document.querySelector("dialog[open]")');await click('Business setup & brand links');await wait('!!'+searchField('Role Supplier'));
  assert.equal(await evaluate(searchField('Role Supplier')+'.checked'),true);
  assert.ok(await evaluate('document.querySelector("dialog").innerText.includes("Associated products & stock")'));
  await click('Close');await click('Add supplier');await searchFill('dialog [name=name]','Search Test Supplier');await click('Save supplier');await wait('document.querySelector("dialog").innerText.includes("already exists")');
  assert.equal(await BusinessEntity.countDocuments({shopId:shop._id,name:'Search Test Supplier'}),1);await click('Close');
  pass('Supplier simplification: three-field Supplier-only form, contact-first Khata, unavailable debt is not zero, duplicate identity rejected, advanced roles/brand links preserved');

  const searchCableCategory=ok(await browserHttp('POST','/categories/create-category',{name:'Search Cable Category'})).category;
  const searchLightCategory=ok(await browserHttp('POST','/categories/create-category',{name:'Search Lighting Category'})).category;
  const searchCoil=ok(await browserHttp('POST','/products/create-product',{name:'Search 3/29 Black Coil',brand:'Eagle',description:'90 metre model EC-100',category:searchCableCategory._id,unit:'coil',costPrice:3000,retailPrice:4000,wholesalePrice:3900,stockQuantity:10,minStockThreshold:2})).product;
  ok(await browserHttp('POST','/products/create-product',{name:'Search LED 12W',brand:'Philips',category:searchLightCategory._id,unit:'piece',costPrice:300,retailPrice:500,wholesalePrice:450,stockQuantity:10,minStockThreshold:1}));
  for(let i=1;i<=24;i++)ok(await browserHttp('POST','/products/create-product',{name:'Search Page Product '+String(i).padStart(2,'0'),brand:'GM',category:searchCableCategory._id,unit:'coil',costPrice:1,retailPrice:2,wholesalePrice:1.5,stockQuantity:10,minStockThreshold:0}));
  await navigation('/owner/sales');await wait('!!document.querySelector(".pos-grid")');
  await searchFill('[aria-label="POS category filter"]',searchCableCategory._id);await wait('document.querySelectorAll(".product-result").length===25');
  assert.deepEqual(await searchOptions('POS brand filter'),['All brands','Eagle','GM']);
  await searchFill('[aria-label="POS brand filter"]','eagle');await searchFill('[aria-label="Search products by name or brand"]','ec-10');
  await wait('document.querySelectorAll(".product-result").length===1');
  assert.ok(await evaluate('document.querySelector(".product-result").innerText.includes("Search Cable Category")'));
  await evaluate('document.querySelector(".product-result").click()');await label('Amount paid','100');await searchFill('[aria-label="Sale type"]','WHOLESALE');
  const paidValue='[...document.querySelectorAll("#sale-form label")].find(l=>l.textContent.trim().startsWith("Amount paid")).querySelector("input").value';
  await searchFill('[aria-label="POS category filter"]',searchLightCategory._id);await searchFill('[aria-label="Search products by name or brand"]','12w');await wait('document.querySelectorAll(".product-result").length===1');
  assert.equal(await searchValue('POS brand filter'),'');
  assert.deepEqual(await searchOptions('POS brand filter'),['All brands','Philips']);
  assert.equal(await searchValue('Quantity for Search 3/29 Black Coil'),'1');assert.equal(await evaluate(paidValue),'100');
  await searchFill('[aria-label="POS category filter"]',searchCableCategory._id);await searchFill('[aria-label="POS brand filter"]','eagle');await searchFill('[aria-label="Search products by name or brand"]','29 bl');
  await click('Products');await wait('!document.querySelector(".pos-grid")');await click('Sales');await wait('!!document.querySelector(".pos-grid")');
  await wait(searchField('POS category filter')+'.value==='+JSON.stringify(String(searchCableCategory._id)));await wait(searchField('POS brand filter')+'.value==="eagle"');
  assert.equal(await searchValue('POS category filter'),String(searchCableCategory._id));assert.equal(await searchValue('POS brand filter'),'eagle');assert.equal(await evaluate(paidValue),'100');
  assert.equal(await searchValue('Sale type'),'WHOLESALE');assert.equal(await searchValue('Quantity for Search 3/29 Black Coil'),'1');
  await searchFill('[aria-label="POS category filter"]','');await searchFill('[aria-label="Search products by name or brand"]','search lighting category');await wait('document.querySelectorAll(".product-result").length===1');
  await searchFill('[aria-label="Search products by name or brand"]','.*[');await wait('document.querySelectorAll(".product-result").length===0');
  assert.equal((await Product.findById(searchCoil._id)).stockQuantity,10);
  pass('Shared POS: case-insensitive partial model/category text, category-scoped brands, retail/wholesale and manual paid amount/cart unchanged, draft restores brand/category and literal regex text is safe');

  await navigation('/owner/purchases?create=1');await searchFill('[aria-label="Purchase category filter"]',searchCableCategory._id);await label('Find purchase products','Search');
  await wait('document.body.innerText.includes("Page 1 of 2")');const beforePaging=await PurchaseOrder.countDocuments({shopId:shop._id});
  await evaluate('(()=>{const buttons=[...document.querySelectorAll("form button")].filter(b=>b.textContent.trim()==="Next");buttons.at(-1).click();})()');await wait('document.body.innerText.includes("Page 2 of 2")');assert.equal(await PurchaseOrder.countDocuments({shopId:shop._id}),beforePaging);
  await click('Add Search Page Product 24');assert.equal(await searchValue('Quantity for Search Page Product 24'),'1');
  await searchFill('[aria-label="Purchase brand filter"]','eagle');await wait('document.body.innerText.includes("Add Search 3/29 Black Coil")');assert.equal(await searchValue('Quantity for Search Page Product 24'),'1');
  await navigation('/owner/products');await searchFill('[aria-label="Search products"]','EC-100');await wait('document.querySelectorAll("tbody tr").length===1&&document.querySelector("tbody tr").innerText.includes("Search 3/29 Black Coil")');
  await click('Add product');await searchFill('dialog [name=name]','Search UI Product');await searchFill('dialog [name=brand]','Independent Brand');await searchFill('dialog [name=category]',searchLightCategory._id);await searchFill('dialog [name=unit]','piece');await searchFill('dialog [name=description]','Model UI-50');await searchFill('dialog [name=costPrice]','10');await searchFill('dialog [name=retailPrice]','20');await click('Save product');await wait('!document.querySelector("dialog[open]")');
  const uiProduct=await Product.findOne({shopId:shop._id,name:'Search UI Product'}).lean();assert.equal(uiProduct.brand,'Independent Brand');assert.equal(String(uiProduct.category),String(searchLightCategory._id));
  await searchFill('[aria-label="Search products"]','UI-50');await wait('document.querySelector("tbody").innerText.includes("Search UI Product")');
  await navigation('/owner/stock');await searchFill('[aria-label="Stock category filter"]',searchCableCategory._id);await searchFill('[aria-label="Stock brand filter"]','eagle');await searchFill('[aria-label="Search stock"]','ec-10');await wait('document.querySelector("tbody").innerText.includes("Search 3/29 Black Coil")');assert.ok(await evaluate('document.querySelector("tbody").innerText.includes("10")'));
  pass('Purchases and product registration: all 25 matches reachable, page buttons never submit a purchase, filters preserve order rows/cost entry; independent product brand/category/model and stock search stay accurate');

  await login(cashier.username);await wait('!!document.querySelector(".pos-grid")');await searchFill('[aria-label="POS category filter"]',searchCableCategory._id);await searchFill('[aria-label="POS brand filter"]','eagle');await searchFill('[aria-label="Search products by name or brand"]','29');await wait('document.querySelectorAll(".product-result").length===1');
  const cashierProducts=ok(await get('/products/search-product?category='+searchCableCategory._id)).product;assert.ok(cashierProducts.every(p=>!Object.hasOwn(p,'costPrice')));
  assert.equal(await evaluate('[...document.querySelectorAll(".sidebar a")].some(a=>a.pathname==="/owner/accounts/companies")'),false);
  const shots=path.join(frontend,'tests/artifacts/supplier-search-review');await fs.mkdir(shots,{recursive:true});
  for(const width of [1366,1920,768,390]){await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await evaluate('document.querySelector(".pos-grid").scrollIntoView({block:"start"})');await sleep(100);assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(shots,'cashier-pos-'+width+'.png'),Buffer.from(shot.data,'base64'));}
  await login(owner.username);
  pass('Cashier uses shared category/brand/text search without cost prices or supplier management; responsive two-panel POS checked at 390/768/1366/1920');
`;
