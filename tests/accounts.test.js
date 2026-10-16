import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {MemoryRouter} from 'react-router-dom';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try {
  for(const [file,title] of [['Companies','Companies &amp; Suppliers'],['CashBank','Cash &amp; Bank'],['Transactions','Transactions']]) {
    const {default:Page}=await server.ssrLoadModule('/src/pages/owner/'+file+'.jsx');
    await test(title+' initial UI uses explicit loading and no fabricated balances',()=>{
      const html=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(Page)));
      assert.ok(html.includes(title));assert.match(html,/Loading/);
      assert.doesNotMatch(html,/PKR 0\.00|Revenue|Profit|Pay supplier|Record purchase/);
      if(file==='Companies')assert.match(html,/supplier details/);
      if(file==='CashBank')assert.match(html,/Live accounting is not enabled/);
      if(file==='Transactions')assert.match(html,/not a complete historical business ledger/);
    });
  }
} finally {await server.close();}
