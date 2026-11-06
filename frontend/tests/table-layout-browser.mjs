// Local presentation fixture: actual shared React table and stylesheet; no API or database.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer as httpServer} from 'node:http';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const directory=path.resolve('tests/artifacts/table-alignment');
const profile=path.join(directory,'profile-'+process.pid);
await fs.mkdir(directory,{recursive:true});
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
const {default:RecordTable}=await vite.ssrLoadModule('/src/components/RecordTable.jsx');
const {activity}=await vite.ssrLoadModule('/src/api/purchases.js');
const columns=[{key:'date',label:'Date'},{key:'name',label:'Product'},{key:'quantity',label:'Quantity',numeric:true},{key:'amount',label:'Amount',numeric:true},{key:'action',label:'Action'},{key:'reference',label:'Reference'}];
const rows=[{_id:'one',date:'17 Oct 2026, 10:30 am',name:'Electrical copper cable with a long descriptive product name',quantity:1250,amount:'PKR 12,345,678.90',action:activity('PURCHASE_RECEIVED'),reference:'INV-102400'},
  {_id:'two',date:'18 Oct 2026, 11:00 am',name:'Coil',quantity:'—',amount:'—',action:activity('RESTOCK'),reference:'—'}];
const html=renderToStaticMarkup(createElement(RecordTable,{label:'Stock records alignment',columns,rows,onOpen:()=>{}}));
const css=await fs.readFile('node_modules/bootstrap/dist/css/bootstrap.min.css','utf8')+await fs.readFile('src/styles.css','utf8');
const raw='<div class="table-responsive"><table class="table"><thead><tr><th class="text-end">Invoice</th><th>Amount</th><th>Actions</th></tr></thead><tbody><tr><td class="text-start">INV-1</td><td class="text-end">PKR 8,000.00</td><td><div class="d-flex justify-content-end"><button class="btn btn-secondary">View</button></div></td></tr></tbody></table></div>';
const server=httpServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><main style="padding:16px;min-width:0">'+html+raw+'</main>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket;
try{
  let port;
  for(let n=0;n<100;n++){try{port=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await sleep(100);}}
  assert.ok(port,'Chrome debugging port available');
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json')).json();
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  let sequence=0;const pending=new Map();
  socket.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id){const p=pending.get(value.id);pending.delete(value.id);if(value.error)p.reject(value.error);else p.resolve(value.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
  await sleep(300);
  for(const width of [1366,1920,768,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    const result=await send('Runtime.evaluate',{expression:`JSON.stringify({cells:[...document.querySelectorAll('th,td')].map(e=>({text:e.innerText,align:getComputedStyle(e).textAlign,size:getComputedStyle(e).fontSize})),buttons:[...document.querySelectorAll('table .btn')].map(e=>({align:getComputedStyle(e).textAlign,wrapper:getComputedStyle(e.parentElement).justifyContent})),overflow:document.documentElement.scrollWidth>innerWidth})`,returnByValue:true});
    const evidence=JSON.parse(result.result.value);
    assert.ok(evidence.cells.length>15);
    for(const cell of evidence.cells)assert.equal(cell.align,'center',width+': '+cell.text);
    for(const button of evidence.buttons)assert.equal(button.align,'center');
    assert.equal(evidence.buttons.at(-1).wrapper,'center');
    if(evidence.overflow){const diagnostic=await send('Runtime.evaluate',{expression:'JSON.stringify({innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll("body *")].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right})).slice(0,8)})',returnByValue:true});console.log(diagnostic.result.value);}
    assert.equal(evidence.overflow,false,'Wide tables scroll within their wrapper');
    const shot=await send('Page.captureScreenshot',{format:'png'});
    await fs.writeFile(path.join(directory,width+'.png'),Buffer.from(shot.data,'base64'));
    console.log('PASS centered shared/raw tables, content fitting and screenshot at '+width+'px');
  }
}finally{socket?.close();chrome.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await vite.close();}
