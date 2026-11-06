import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
  const {productBrands,matchingProducts,completeProducts}=await server.ssrLoadModule('/src/api/productSearch.js');
  const {default:ProductFilters}=await server.ssrLoadModule('/src/components/ProductFilters.jsx');
  const {EntityForm}=await server.ssrLoadModule('/src/pages/owner/Companies.jsx');
  const products=[
    {_id:'coil',name:'3/29 Black Coil',brand:'Eagle',category:{_id:'cable',name:'Wire & Cables'},description:'90 metre model X-100',stockQuantity:10,retailPrice:4000,wholesalePrice:3900},
    {_id:'red',name:'Red Coil',brand:' EAGLE ',category:{_id:'cable',name:'Wire & Cables'},description:'2.5 mm'},
    {_id:'gm',name:'GM Cable',brand:'GM',category:{_id:'cable',name:'Wire & Cables'}},
    {_id:'bulb',name:'LED 12W',brand:'Philips',category:{_id:'light',name:'Lighting'}},
    {_id:'literal',name:'a.*[b]',brand:'Other',category:null}
  ];
  await test('partial text matches name, brand, category and stored model/size text without selecting filters',()=>{
    for(const [search,ids] of [['29 bl',['coil']],['eAgLe',['coil','red']],['WIRE &',['coil','red','gm']],['X-10',['coil']],['2.5',['red']],['90 EAGLE',['coil']]])assert.deepEqual(matchingProducts(products,{search}).map(p=>p._id),ids);
  });
  await test('category and brand combine with text and leave product identity/prices/stock intact',()=>{
    const before=JSON.stringify(products);
    assert.deepEqual(matchingProducts(products,{category:'cable',brand:'eagle'}).map(p=>p._id),['coil','red']);
    assert.deepEqual(matchingProducts(products,{category:'light',brand:'eagle'}),[]);
    assert.deepEqual(matchingProducts(products,{category:'cable',brand:'eagle',search:'black'}),[products[0]]);
    assert.equal(JSON.stringify(products),before);assert.equal(matchingProducts(products)[0],products[0]);
  });
  await test('brands come only from the category product data, deduplicate case and never infer supplier links',()=>{
    assert.deepEqual(productBrands(products,'cable'),[{value:'eagle',label:'Eagle'},{value:'gm',label:'GM'}]);
    assert.deepEqual(productBrands(products,'light'),[{value:'philips',label:'Philips'}]);
    assert.deepEqual(productBrands(products,'missing'),[]);
  });
  await test('regex-like text is literal and absent fields do not break search',()=>{
    assert.deepEqual(matchingProducts(products,{search:'.*['}).map(p=>p._id),['literal']);
    assert.equal(matchingProducts(products,{search:'^.*$'}).length,0);
    assert.equal(matchingProducts([{_id:'empty'}],{search:'unknown'}).length,0);
  });
  await test('complete results retain matches beyond the first page and reject partial responses',()=>{
    const many=Array.from({length:125},(_,i)=>({_id:String(i),name:'Cable '+i,brand:'GM'}));
    assert.equal(completeProducts({product:many}).length,125);
    assert.equal(matchingProducts(many,{search:'Cable 124'})[0]._id,'124');
    for(const result of [{product:null},{product:many.slice(0,20),pagination:{totalPages:7,recordCount:125}},{product:[],pagination:{totalPages:1,recordCount:5}}])assert.throws(()=>completeProducts(result),/Complete product results unavailable/);
  });
  await test('shared selectors show real brands/categories and a separate direct text search',()=>{
    const html=renderToStaticMarkup(createElement(ProductFilters,{search:'coil',onSearch:()=>{},category:'cable',onCategory:()=>{},brand:'eagle',onBrand:()=>{},categories:[{_id:'cable',name:'Wire & Cables'}],brands:productBrands(products,'cable')}));
    for(const word of ['All categories','All brands','Wire &amp; Cables','Eagle','GM','size/model','Search products'])assert.ok(html.includes(word),word);
    assert.ok(!html.includes('Philips'));
  });
  await test('ordinary supplier registration has three fields and no role controls; legacy registration remains accessible',()=>{
    const render=supplier=>renderToStaticMarkup(createElement(MemoryRouter,null,createElement(EntityForm,{supplier,onBusy:()=>{},onSaved:()=>{}})));
    const normal=render(true),legacy=render(false);
    for(const label of ['Supplier name','Phone (Optional)','Address (Optional)','Save supplier'])assert.ok(normal.includes(label),label);
    assert.equal((normal.match(/<input/g)||[]).length,3);assert.ok(!normal.includes('checkbox'));assert.ok(!normal.includes('Company'));
    for(const role of ['Company','Customer','Manufacturer','Other','Business partner'])assert.ok(legacy.includes(role),role);
  });
}finally{await server.close();}
