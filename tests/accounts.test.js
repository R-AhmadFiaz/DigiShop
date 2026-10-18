import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {MemoryRouter} from 'react-router-dom';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try {
  for(const [file,title] of [['Companies','Suppliers'],['CashBank','Cash &amp; Bank'],['Transactions','Transactions']]) {
    const {default:Page}=await server.ssrLoadModule('/src/pages/owner/'+file+'.jsx');
    await test(title+' initial UI uses explicit loading and no fabricated balances',()=>{
      const html=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(Page)));
      assert.ok(html.includes(title));assert.match(html,/Loading/);
      assert.doesNotMatch(html,/PKR 0\.00|Revenue|Profit|Pay supplier|Record purchase/);
      if(file==='Companies'){assert.match(html,/Add supplier/);assert.match(html,/Other business records \(Advanced\)/);}
      if(file==='CashBank')assert.match(html,/Confirm starting balances and activate money records/);
      if(file==='Transactions')assert.match(html,/Unchecked old records may be missing/);
    });
  }
} finally {await server.close();}
