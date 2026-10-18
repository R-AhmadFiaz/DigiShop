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
  const reportMetric=label=>'(()=>{const dt=[...document.querySelectorAll(".report-metric dt")].find(e=>e.textContent==='+JSON.stringify(label)+');return dt?.nextElementSibling.textContent;})()';
  assert.equal(await evaluate(reportMetric('Net Sales')),reportFormats(reportEvidence.sales.revenueMinor));
  assert.equal(await evaluate(reportMetric('Operating Expenses')),reportFormats(reportEvidence.expenses.netMinor));
  const cashReady=reportEvidence.cashBank.status!=='UNAVAILABLE'&&reportEvidence.cashBank.entries.every(a=>Number.isSafeInteger(a.currentBalanceMinor)&&a.status!=='UNAVAILABLE');
  assert.equal(await evaluate(reportMetric('Cash & Bank')),cashReady?reportFormats(reportEvidence.cashBank.entries.reduce((n,a)=>n+a.currentBalanceMinor,0)):'Unavailable');
  const reportDir=path.join(frontend,'tests/artifacts/report-review');await fs.mkdir(reportDir,{recursive:true});
  const reportLayouts=[];
  for(const category of ['Sales','Expenses','Cash & Bank','Customers','Suppliers','Capital','Inventory']){
    await wait('(()=>{const b=[...document.querySelectorAll(".report-tabs button")].find(e=>e.textContent==='+JSON.stringify(category)+');if(!b)return false;b.click();return true;})()');
    assert.equal(await evaluate('document.querySelectorAll(".report-content").length'),1);
    assert.equal(await evaluate('document.querySelectorAll(".report-tabs [aria-pressed=true]").length'),1);
    assert.equal(await evaluate('document.querySelector(".report-tabs [aria-pressed=true]").textContent'),category);
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
  await evaluate('document.querySelector("#report-notes").open=true');
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
`;
