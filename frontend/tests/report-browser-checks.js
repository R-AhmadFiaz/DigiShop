// Appended to the real Express + disposable loopback replica-set browser runner.
export const reportChecks=String.raw`
  await login(owner.username);
  await navigation('/owner/reports');await wait('!!document.querySelector(".report-overview")');
  const reportFrom=new Date().toISOString().slice(0,8)+'01';
  const reportTo=new Date().toISOString().slice(0,10);
  const reportEvidence=ok(await get('/accounts/reports?from='+reportFrom+'T00:00:00.000Z&to='+new Date(Date.parse(reportTo+'T00:00:00.000Z')+86400000).toISOString()));
  const reportCalls=()=>requests.filter(r=>r.method==='GET'&&r.path.startsWith('/api/v2/accounts/reports')).length;
  const reportCallsBefore=reportCalls();
  const reportFormats=n=>'PKR '+(n/100).toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
  const reportMetric=label=>'(()=>{const dt=[...document.querySelectorAll(".report-metric dt")].find(e=>e.firstChild.textContent==='+JSON.stringify(label)+');return dt?.nextElementSibling.textContent;})()';
  assert.equal(await evaluate(reportMetric('Net Sales')),reportFormats(reportEvidence.sales.revenueMinor));
  assert.equal(await evaluate(reportMetric('Operating Expenses')),reportFormats(reportEvidence.expenses.netMinor));
  const cashReady=reportEvidence.cashBank.status!=='UNAVAILABLE'&&reportEvidence.cashBank.entries.every(a=>Number.isSafeInteger(a.currentBalanceMinor)&&a.status!=='UNAVAILABLE');
  assert.equal(await evaluate(reportMetric('Cash & Bank')),cashReady?reportFormats(reportEvidence.cashBank.entries.reduce((n,a)=>n+a.currentBalanceMinor,0)):'Unavailable');
  const reportDir=path.join(frontend,'tests/artifacts/report-review');await fs.mkdir(reportDir,{recursive:true});
  const reportLayouts=[];
  for(const category of ['Sales','Expenses','Cash & Bank','Customers','Suppliers','Capital','Inventory']){
    await wait('(()=>{const b=[...document.querySelectorAll(".report-tabs [role=tab]")].find(e=>e.querySelector(".report-tab-label").textContent==='+JSON.stringify(category)+');if(!b)return false;b.click();return true;})()');
    assert.equal(await evaluate('document.querySelectorAll(".report-content").length'),1);
    assert.equal(await evaluate('document.querySelectorAll(".report-tabs [aria-selected=true]").length'),1);
    assert.equal(await evaluate('document.querySelector(".report-tabs [aria-selected=true] .report-tab-label").textContent'),category);
    const headings=await evaluate('[...document.querySelectorAll("#selected-report th")].map(e=>e.textContent)');
    if(category==='Capital'){assert.ok(headings.includes('Withdrawal'));assert.ok(!headings.includes('Money taken out'));}
    if(category==='Inventory'){assert.ok(await evaluate('document.querySelector("#selected-report").innerText.includes("Provisional")'));}
    if(category==='Sales')assert.equal(await evaluate('document.querySelector("#selected-report tbody tr:last-child").cells[1].textContent'),reportFormats(reportEvidence.sales.revenueMinor));
    if(category==='Customers'&&reportEvidence.customers.entries.length){
      const first=reportEvidence.customers.entries[0];
      assert.equal(await evaluate('document.querySelector("#selected-report tbody tr").cells[1].textContent'),reportFormats(first.debtMinor));
      await click('Customer Khata');await wait('!!document.querySelector("dialog .balance-strip")');const reportCustomerTable='dialog [aria-label="Customer invoice register"]';await wait('!!document.querySelector('+JSON.stringify(reportCustomerTable)+')');await click('Close');
    }
    for(const width of [1366,1920,768,390]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
      await evaluate(width<1000?'document.querySelector(".page-title").scrollIntoView({block:"start"})':'window.scrollTo(0,0)');await sleep(100);
      if(width===390){
        assert.equal(await evaluate('document.querySelector(".report-select").checkVisibility()'),true);
        assert.equal(await evaluate('document.querySelector(".report-select").value'),category);
        await fill('.report-select',category);assert.equal(await evaluate('document.querySelectorAll(".report-content").length'),1);
      }
      const metrics=await evaluate('({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,cells:[...document.querySelectorAll("#selected-report th,#selected-report td")].filter(e=>e.checkVisibility()).map(e=>getComputedStyle(e).textAlign),tables:[...document.querySelectorAll("#selected-report .record-register")].filter(e=>e.checkVisibility()).map(e=>({height:e.clientHeight,content:e.scrollHeight})),tabsScrollable:document.querySelector(".report-tabs").scrollWidth>document.querySelector(".report-tabs").clientWidth})');
      assert.equal(metrics.overflow,false,category+' has no page overflow at '+width);assert.ok(metrics.cells.every(v=>v==='center'));assert.ok(metrics.tables.every(t=>t.content<=t.height+2));
      reportLayouts.push({category,...metrics});
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(reportDir,category.toLowerCase().replaceAll(' & ','-')+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
      await evaluate('document.getElementById("selected-report").parentElement.scrollIntoView({block:"start"})');
      const detailShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(reportDir,category.toLowerCase().replaceAll(' & ','-')+'-table-'+width+'.png'),Buffer.from(detailShot.data,'base64'));
    }
  }
  assert.equal(reportCalls(),reportCallsBefore,'Switching reports and resizing never refetches financial data');
  await evaluate('document.getElementById("report-notes")||document.querySelector(".reports-notes-toggle").click()');await wait('!!document.getElementById("report-notes")');
  for(const phrase of ['Profit & Loss','UTC day boundaries','not used as historical cost'])assert.ok(await evaluate('document.querySelector("#report-notes").innerText.includes('+JSON.stringify(phrase)+')'));
  pass('Financial dashboard: seven exclusive report views, authoritative overview amounts, Customer Khata, Withdrawal, notes and provisional inventory; no category refetch');
  const statusRows=await PurchaseOrder.find({shopId:shop._id}).sort({_id:1}).lean();
  const foundStatuses=new Set();
  for(const order of statusRows){
    if(foundStatuses.has(order.status))continue;foundStatuses.add(order.status);
    await navigation('/owner/purchases/'+order._id);await wait('document.querySelector(".page-title")?.innerText.includes('+JSON.stringify(order.reference)+') && !!document.querySelector(".purchase-status")');
    const badge=await evaluate('({text:document.querySelector(".purchase-status").textContent,classes:document.querySelector(".purchase-status").className,weight:getComputedStyle(document.querySelector(".purchase-status")).fontWeight})');
    assert.ok(Number(badge.weight)>=600);
    const expected={CANCELLED:['Cancelled','danger'],PARTIALLY_RECEIVED:['Partially Received','primary'],RECEIVED:['Received','success'],DRAFT:['Pending · Draft','warning'],CONFIRMED:['Pending · Confirmed','warning']}[order.status];
    assert.equal(badge.text,expected[0]);assert.ok(badge.classes.includes('text-bg-'+expected[1]));
  }
  assert.ok(foundStatuses.has('CANCELLED'));
  await navigation('/owner/purchases');await wait('!!document.querySelector(".purchase-status.text-bg-danger")');
  for(const width of [1366,1920,768,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await evaluate(width<1000?'document.querySelector(".page-title").scrollIntoView({block:"start"})':'window.scrollTo(0,0)');await sleep(100);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(reportDir,'purchase-status-'+width+'.png'),Buffer.from(shot.data,'base64'));
  }
  await fs.writeFile(path.join(reportDir,'metrics.json'),JSON.stringify(reportLayouts,null,2));
  pass('Financial dashboard and purchase status screenshots at 390, 768, 1366 and 1920; centered tables, mobile scrolling, real status values and accessible cancelled purchases');
  // Dashboard summary uses the same authoritative report, without any detailed history.
  const dashboardLowProduct=ok(await browserHttp('POST','/products/create-product',{name:'Dashboard Low Stock Bulb',brand:'Dashboard Test',category:category._id,unit:'piece',costPrice:10,retailPrice:15,wholesalePrice:12,stockQuantity:0,minStockThreshold:2})).product;
  await navigation('/owner');await wait('document.querySelectorAll(".dashboard-summary-card").length===4 && !document.querySelector(".dashboard-finances").innerText.includes("Loading")');
  const dashDay=new Date().toISOString().slice(0,10),dashFrom=dashDay.slice(0,8)+'01';
  const dashEvidence=ok(await get('/accounts/reports?from='+dashFrom+'T00:00:00.000Z&to='+new Date(Date.parse(dashDay+'T00:00:00.000Z')+86400000).toISOString()));
  const dashMetric=label=>'[...document.querySelectorAll(".dashboard-summary-card")].find(a=>a.innerText.startsWith('+JSON.stringify(label)+')).querySelector("strong").textContent';
  assert.equal(await evaluate(dashMetric('Net Sales')),reportFormats(dashEvidence.sales.revenueMinor));
  assert.equal(await evaluate(dashMetric('Expenses')),reportFormats(dashEvidence.expenses.netMinor));
  assert.equal(await evaluate(dashMetric('Partner Capital')),reportFormats(dashEvidence.capital.balanceMinor));
  assert.equal(await evaluate(dashMetric('Cash & Bank')),reportFormats(dashEvidence.cashBank.entries.reduce((sum,a)=>sum+a.currentBalanceMinor,0)));
  assert.equal(await evaluate('document.querySelectorAll(".dashboard-finances table").length'),0);
  assert.ok(await evaluate('document.querySelector(".owner-welcome").innerText.includes("Welcome,")'));
  assert.ok(await evaluate('[...document.querySelectorAll("a")].some(a=>a.textContent.trim()==="New sale"&&a.pathname==="/owner/sales")'));
  const lowStockEvidence=ok(await get('/products/low-stock'));
  assert.ok(lowStockEvidence.Products.some(p=>String(p._id)===String(dashboardLowProduct._id)),'A real low-stock product is displayed, not only an empty fixture');
  await wait('!document.querySelector("main").innerText.includes("Loading")');
  const stockCells=await evaluate('[...document.querySelectorAll("main .panel tbody tr")].map(r=>[...r.cells].map(c=>c.textContent.trim()))');
  assert.deepEqual(stockCells.map(c=>[c[0],c[2]]).sort(),lowStockEvidence.Products.map(p=>[p.name,p.stockQuantity+' '+p.unit]).sort());
  const stockCalls=()=>requests.filter(r=>r.method==='GET'&&r.path==='/api/v2/products/low-stock').length;
  const beforeStockRefresh=stockCalls(),beforeReportRefresh=reportCalls();await click('Refresh');await wait('!document.querySelector("main").innerText.includes("Loading")');
  assert.equal(stockCalls(),beforeStockRefresh+1);assert.equal(reportCalls(),beforeReportRefresh,'Stock refresh does not refetch or modify financial records');
  for(const width of [1366,1920,768,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await evaluate(width<1000?'document.querySelector(".owner-welcome").scrollIntoView({block:"start"})':'window.scrollTo(0,0)');await sleep(100);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(reportDir,'owner-dashboard-'+width+'.png'),Buffer.from(shot.data,'base64'));
  }
  await navigation('/owner/reports');await wait('!!document.querySelector(".report-overview")');if(await evaluate('innerWidth<650'))await fill('.report-select','Capital');else await click('Capital');
  const capitalCells=await evaluate('[...document.querySelectorAll("#selected-report tbody tr")].filter(r=>r.cells.length===4).map(r=>[...r.cells].map(c=>c.textContent))');
  assert.deepEqual(capitalCells,dashEvidence.capital.entries.map(p=>[p.name,reportFormats(p.contributionsMinor),reportFormats(p.withdrawalsMinor),reportFormats(p.balanceMinor)]),'Only registered investors are rendered, never an inferred login identity');
  assert.ok(await evaluate('document.querySelector("#selected-report").innerText.includes("Registered investor")'));
  const cardCount=await evaluate('document.querySelectorAll(".report-overview .dashboard-summary-card").length');assert.equal(cardCount,0);
  delete process.env.BUSINESS_ACCOUNTING_ENABLED;
  await navigation('/owner');await wait('document.querySelectorAll(".dashboard-summary-card").length===4 && !document.querySelector(".dashboard-finances").innerText.includes("Loading")');
  assert.equal(await evaluate(dashMetric('Cash & Bank')),'Unavailable');assert.equal(await evaluate(dashMetric('Partner Capital')),'Unavailable');assert.equal(await evaluate(dashMetric('Expenses')),'Unavailable');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("main .panel tbody tr")].map(r=>[...r.cells].map(c=>c.textContent.trim()))'),stockCells);
  process.env.BUSINESS_ACCOUNTING_ENABLED='true';
  pass('Owner dashboard: four actual monthly/current totals, registered-only investor capital, no histories, correct New Sale/welcome, exact low-stock quantities and independent refresh; unavailable accounting preserves stock');
`;
