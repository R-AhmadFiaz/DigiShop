import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
const source=path=>fs.readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
  const {pageNumber,clampedPage,pageRange}=await server.ssrLoadModule('/src/api/paging.js');
  const {Pagination}=await server.ssrLoadModule('/src/components/Common.jsx');
  const {default:CustomerFilter}=await server.ssrLoadModule('/src/components/CustomerFilter.jsx');
  const render=element=>renderToStaticMarkup(createElement(MemoryRouter,null,element));

  await test('page numbers from URLs are positive integers, otherwise page 1',()=>{
    for(const [value,expected] of [['3',3],['1',1],[null,1],['0',1],['-2',1],['2.5',1],['abc',1],['9007199254740993',1]])assert.equal(pageNumber(value),expected,String(value));
  });
  await test('out-of-range pages are corrected to the last page; valid or empty lists are left alone',()=>{
    assert.equal(clampedPage({currentPage:5,totalPages:3}),3);
    assert.equal(clampedPage({currentPage:4,totalPages:0}),1);
    assert.equal(clampedPage({currentPage:1,totalPages:0}),null);
    assert.equal(clampedPage({currentPage:3,totalPages:3}),null);
    assert.equal(clampedPage(undefined),null);
  });
  await test('ranges report the shown rows and the full total for every endpoint naming',()=>{
    assert.deepEqual(pageRange({currentPage:3,limit:20,recordCount:45},5),{first:41,last:45,total:45});
    assert.deepEqual(pageRange({currentPage:2,limit:20,orderCount:25}),{first:21,last:25,total:25});
    assert.deepEqual(pageRange({currentPage:1,limit:10,customerCount:45},10),{first:1,last:10,total:45});
    assert.equal(pageRange({currentPage:9,limit:20,recordCount:45}),null);
    assert.equal(pageRange({currentPage:1,limit:20,recordCount:0}),null);
  });
  await test('pager names its list, shows totals and first/last controls; hidden for one page or out of range',()=>{
    const html=render(createElement(Pagination,{label:'Products',pagination:{currentPage:2,limit:20,recordCount:45,totalPages:3},rows:20,onPage(){}}));
    assert.match(html,/aria-label="Products pages"/);assert.match(html,/Page 2 of 3/);assert.match(html,/21–40 of 45/);
    for(const name of ['First page of Products','Last page of Products'])assert.ok(html.includes(name),name);
    assert.equal(render(createElement(Pagination,{pagination:{currentPage:1,limit:20,recordCount:5,totalPages:1},onPage(){}})),'');
    assert.equal(render(createElement(Pagination,{pagination:{currentPage:7,limit:20,recordCount:45,totalPages:3},onPage(){}})),'');
  });
  await test('customer filter is a labelled, searchable combobox with an all-customers reset',()=>{
    const empty=render(createElement(CustomerFilter,{label:'Customer',value:'',onChange(){}}));
    assert.match(empty,/role="combobox"/);assert.match(empty,/All customers — type name or phone/);assert.match(empty,/>Customer</);
    const chosen=render(createElement(CustomerFilter,{label:'Customer',value:'abc',selectedName:'Customer 101 · 03210000101',onChange(){}}));
    assert.match(chosen,/Showing: Customer 101 · 03210000101/);assert.match(chosen,/All customers<\/button>/);
  });
  await test('POS, invoice editing and purchase creation keep the complete product catalogue',()=>{
    for(const file of ['components/POS.jsx','components/InvoiceAdjustment.jsx','pages/owner/Purchases.jsx']){
      const code=source(file);assert.match(code,/useProductSearch\(/,file);assert.doesNotMatch(code,/usePagedProducts/,file);
    }
    assert.match(source('api/productSearch.js'),/export function completeProducts/);
  });
  await test('Products, Stock levels, low stock, cashiers and admin shops request server pages',()=>{
    for(const file of ['pages/owner/Products.jsx','pages/owner/Stock.jsx'])assert.match(source(file),/usePagedProducts\(/,file);
    assert.match(source('pages/owner/Stock.jsx'),/lowStock:lowOnly/);
    assert.match(source('pages/owner/Dashboard.jsx'),/"\/products\/low-stock" \+ query\(\{ page: lowPage, limit: 10 \}\)/);
    assert.match(source('pages/owner/Staff.jsx'),/"\/users\/cashiers" \+ query\(\{ page, limit: 20 \}\)/);
    assert.match(source('pages/admin/Shops.jsx'),/"\/admin\/shops" \+ query\(\{ page, limit: 20, search: term \}\)/);
    assert.match(source('pages/owner/ExistingSetup.jsx'),/function SnapshotTable/);
  });
  await test('cash and bank lists are filtered by the server before paging, never thinned in the browser',()=>{
    const cash=source('pages/owner/CashBank.jsx'),pay=source('components/SupplierPayment.jsx');
    assert.match(cash,/kind:'CASH,BANK'/);assert.doesNotMatch(cash,/\.filter\(a=>\['CASH','BANK'\]/);
    assert.match(pay,/kind:'CASH,BANK',ready:'true'/);assert.doesNotMatch(pay,/\.filter\(a=>\['CASH','BANK'\]/);
    assert.match(source('components/AccountingActivation.jsx'),/kind=CASH,BANK&limit=100/);
  });
  await test('customer filters no longer depend on a first page of 100 customers',()=>{
    for(const file of ['pages/owner/CustomerServices.jsx','pages/owner/Sales.jsx']){
      const code=source(file);assert.doesNotMatch(code,/limit:100/,file);assert.match(code,/<CustomerFilter /,file);
    }
    assert.match(source('pages/owner/Sales.jsx'),/includeCustomer/);
    assert.doesNotMatch(source('pages/owner/CustomerServices.jsx'),/Â|â€/);
  });
  await test('list positions are kept in the URL and no list wipes other URL state',()=>{
    for(const file of ['pages/owner/Products.jsx','pages/owner/Stock.jsx','pages/Customers.jsx','pages/owner/Purchases.jsx','pages/owner/Companies.jsx','pages/owner/CashBank.jsx','pages/owner/Expenses.jsx','pages/owner/Partners.jsx','pages/owner/Staff.jsx','pages/admin/Shops.jsx','pages/owner/Dashboard.jsx','pages/owner/Transactions.jsx','pages/owner/SupplierDetails.jsx','pages/owner/PurchaseDetails.jsx','components/TransactionHistory.jsx']){
      const code=source(file);assert.match(code,/usePageParam\(/,file);assert.doesNotMatch(code,/setParams\(\{/,file);
    }
  });
}finally{await server.close();}
