// Appended to the existing isolated real-browser runner with --screenshots.
export const screenshotChecks=String.raw`
  const layoutEvidence=[];
  const screenshotDir=path.join(frontend,'tests/artifacts/layout-review');
  await fs.mkdir(screenshotDir,{recursive:true});
  async function waitForTable(label){const selector='[aria-label="'+label+'"] tr[data-record-id]';await wait('!!document.querySelector('+JSON.stringify(selector)+')');}
  async function captureLayout(name,prepare){
    await prepare();
    for(const [width,height] of [[1366,900],[1920,1080],[390,844]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<650});
      await send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
      await evaluate('window.scrollTo(0,0)');await sleep(150);
      const metrics=await evaluate('({pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,scale:visualViewport.scale,tables:[...document.querySelectorAll(".record-register")].filter(e=>e.checkVisibility()).map(e=>({label:e.getAttribute("aria-label"),width:e.clientWidth,contentWidth:e.scrollWidth,height:e.clientHeight,contentHeight:e.scrollHeight,rows:e.querySelectorAll("tbody > tr").length}))})');
      assert.ok(metrics.pageWidth<=metrics.viewport+2,name+' has no page-level horizontal overflow at '+width);
      assert.ok(Math.abs(metrics.scale-1)<0.02,'Screenshots use normal zoom');
      for(const table of metrics.tables)assert.ok(table.contentHeight<=table.height+2,'No vertical table scrollbar: '+name+' / '+table.label);
      layoutEvidence.push({page:name,width,...metrics});
      await fs.writeFile(path.join(screenshotDir,'metrics.json'),JSON.stringify(layoutEvidence,null,2));
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      await fs.writeFile(path.join(screenshotDir,name+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
      if(width===1366){
        const layout=await send('Page.getLayoutMetrics');
        const full=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:Math.min(6000,Math.max(height,Math.ceil(layout.cssContentSize.height))),scale:1}});
        await fs.writeFile(path.join(screenshotDir,name+'-1366-full.png'),Buffer.from(full.data,'base64'));
      }
    }
  }
  await captureLayout('supplier-khata',async()=>{
    await navigation('/owner/accounts/suppliers/'+supplier._id);
    await waitForTable('Account statement');
    assert.ok(await evaluate('document.body.innerText.includes("Debt added")'));
    assert.equal(await evaluate('document.querySelector("#supplier-credit")'),null,'Zero credit creates no empty credit form');
  });
  await captureLayout('companies-suppliers',async()=>{await navigation('/owner/accounts/companies');await wait('!!document.querySelector("tr[data-record-id]")');});
  await captureLayout('supplier-purchases',async()=>{await navigation('/owner/purchases/'+postedPo._id);await waitForTable('Purchase activity register');});
  await captureLayout('supplier-returns',async()=>{
    await navigation('/owner/purchases/'+postedPo._id);await waitForTable('Purchase activity register');
    await click('Return goods');await wait('!!document.querySelector(".panel[aria-label] tbody")');
  });
  await captureLayout('financial-reports',async()=>{await navigation('/owner/reports');await wait('!!document.querySelector(".report-overview")');});
  await captureLayout('capital',async()=>{await navigation('/owner/partners');await waitForTable('Partner capital register');});
  await captureLayout('cash-bank',async()=>{
    await navigation('/owner/accounts/cash-bank');await fill('[aria-label="Search accounts"]',cash.name);
    const selector='tr[data-record-id="'+cash._id+'"]';await wait('!!document.querySelector('+JSON.stringify(selector)+')');
    await evaluate('document.querySelector('+JSON.stringify(selector)+').click()');await wait('!!document.querySelector(".record-balance")');
  });
  await login(zeroFixture.user.username);
  await captureLayout('customer-khata',async()=>{
    await navigation('/owner/customers');
    const selector='tr[data-record-id="'+posBuyer._id+'"]';await wait('!!document.querySelector('+JSON.stringify(selector)+')');
    await evaluate('document.querySelector('+JSON.stringify(selector)+').click()');
    await wait('!!document.querySelector("dialog .balance-strip")');
    await waitForTable('Customer invoice register');
  });
  await login(owner.username);
  await fs.writeFile(path.join(screenshotDir,'metrics.json'),JSON.stringify(layoutEvidence,null,2));
  pass('Screenshots captured for eight record views at 1366, 1920 and mobile widths; natural table height and page overflow verified');
`;
