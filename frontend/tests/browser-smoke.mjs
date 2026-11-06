let nextSubscriptionFailure = false;
let ownerDisplayName = "owner";
let accountingActivationState='DISABLED',accountingActivationRevision=0;
const accountingActivationRequests=[];
// Optional browser smoke test. Requires installed Chrome and a frontend at localhost:5173.
// Authenticated workflows use isolated contract responses. The final anonymous check contacts the live backend without modifying shop records.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = path.resolve("node_modules/.cache/store-browser-"+process.pid);
const portProbe=net.createServer();
await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve));
const debugPort=portProbe.address().port;
await new Promise(resolve=>portProbe.close(resolve));
fs.mkdirSync(profile, { recursive: true });
const chrome = spawn(
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port="+debugPort,
    "--user-data-dir=" + profile,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
let socket;
const pending = new Map();
let sequence = 0,
  role = null;
let expireAccess = false,
  failRefresh = false,
  nextFailure = null;
const calls = [],
  errors = [],
  liveResponses = [];
const product = {
  _id: "product-one",
  name: "Copper Cable",
  brand: "Local Wire",
  category: { _id: "category-one", name: "Wiring" },
  unit: "meter",
  costPrice: 30,
  retailPrice: 50,
  wholesalePrice: 40,
  stockQuantity: 20,
  minStockThreshold: 5,
};
const customer = {
  _id: "customer-one",
  name: "Ali",
  phoneNo: "03001234567",
  address: "Market",
  remainingMoney: 10,
  storeCreditBalanceMinor: 4000,
};
let invoice = {
  _id: "invoice-one",
  type: "INVOICE",
  invoiceNo: "INV-1",
  createdByName: "ali",
  items: [{ productId: product._id, quantity: 1, unitPrice: 50 }],
  subtotal: 50,
  discountAmount: 0,
  totalPrice: 50,
  paidAmount: 50,
  amountDue: 0,
  saleType: "RETAIL",
  status: "PENDING",
  createdAt: new Date().toISOString(),
};
let quotation;
let financialPreview = null, failFinancialResponse = false, incompleteFinancialResponse = false, staleFinancialPreview = false;
const financialEvents = [];
const posCreditRequests = new Map();
let slowCategorySearch = false;
const cashiers = [];
const stockLogs = [];
const businessEntities = [], businessBrands = [];
const financialAccounts = [{_id:'cash-account',name:'Counter cash',kind:'CASH',isActive:true}];
let allowAccountBalance=false, denyAccounts=false;
const purchaseOrders=[],goodsReceipts=[],supplierSettlements=[];
let supplierReady=false,supplierPayableMinor=5000,supplierCashMinor=125000,loseSupplierResponse=false;
function purchaseContract(endpoint,request,body,url){
  if(role!=='OWNER')return {status:403,message:'Owner shop access required'};
  const parts=endpoint.split('/'),po=purchaseOrders.find(p=>p._id===parts[2]);
  if(endpoint==='/purchases/'&&request.method==='POST'){
    const prior=purchaseOrders.find(p=>p.requestKey===body.requestKey);if(prior)return {data:{purchaseOrder:prior,replayed:true}};
    const items=body.items.map(r=>({...r,name:product.name,brand:product.brand,unit:product.unit,totalMinor:r.quantity*r.unitCostMinor,receivedQuantity:0}));
    const record={...body,reference:body.reference||'PO-'+(purchaseOrders.length+1),_id:'purchase-'+(purchaseOrders.length+1),supplierName:businessEntities.find(e=>e._id===body.supplierId).name,createdAt:new Date().toISOString(),items,totalMinor:items.reduce((n,r)=>n+r.totalMinor,0),revision:0,status:'DRAFT'};purchaseOrders.push(record);return {data:{purchaseOrder:record,replayed:false}};
  }
  if(endpoint==='/purchases/'){const entries=purchaseOrders.filter(p=>(!url.searchParams.get('supplierId')||p.supplierId===url.searchParams.get('supplierId'))&&(!url.searchParams.get('q')||p.reference.includes(url.searchParams.get('q')))&&(!url.searchParams.get('status')||p.status===url.searchParams.get('status')));return {data:{entries,pagination:{currentPage:1,totalPages:1,recordCount:entries.length}}};}
  if(!po)return {status:404,message:'Purchase order not found in shop'};
  if(parts[3]==='receipts'&&request.method==='GET')return {data:{entries:goodsReceipts.filter(r=>r.purchaseOrderId===po._id).toReversed(),pagination:{currentPage:1,totalPages:1}}};
  if(parts[3]==='receipts'){
    const existing=goodsReceipts.find(r=>r.requestKey===body.requestKey);if(existing)return {data:{receipt:existing,purchaseOrder:po,replayed:true}};
    if(body.expectedRevision!==po.revision)return {status:409,message:'Purchase changed; reload before receiving'};const items=body.items.map(r=>{const line=po.items.find(i=>i.productId===r.productId);assert.ok(r.quantity<=line.quantity-line.receivedQuantity);line.receivedQuantity+=r.quantity;return {...r,name:line.name,unitCostMinor:line.unitCostMinor,totalMinor:r.quantity*line.unitCostMinor};});
    const receipt={_id:'receipt-'+(goodsReceipts.length+1),...body,reference:body.reference||'GR-'+(goodsReceipts.length+1),items,purchaseOrderId:po._id,purchaseReference:po.reference,supplierId:po.supplierId,totalMinor:items.reduce((n,r)=>n+r.totalMinor,0),occurredAt:new Date().toISOString(),createdByName:'Receiving Owner',accountingStatus:supplierReady?'POSTED':'DEFERRED'};
    goodsReceipts.push(receipt);product.stockQuantity+=items.reduce((n,r)=>n+r.quantity,0);if(supplierReady)supplierPayableMinor+=receipt.totalMinor;po.revision++;po.status=po.items.every(i=>i.quantity===i.receivedQuantity)?'RECEIVED':'PARTIALLY_RECEIVED';return {data:{receipt,purchaseOrder:po,replayed:false}};
  }
  if(request.method==='POST'){if(body.expectedRevision!==po.revision)return {status:409,message:'Purchase changed; reload before continuing'};po.revision++;po.status=parts[3]==='confirm'?'CONFIRMED':'CANCELLED';}
  return {data:{purchaseOrder:po}};
}
const shops = [
  {
    _id: "shop-one",
    name: "Hardware Shop",
    ownerId: { username: "owner", email: "owner@example.test" },
    contactNo: "03001234567",
    address: "Market",
    subscriptionActive: false,
    subscriptionExpiry: null,
  },
];
function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function mock(event) {
  const request = event.request,
    url = new URL(request.url),
    endpoint = url.pathname.replace("/api/v2", "");
  // Keep isolated browser workflows on the test API even when the developer's
  // running Vite server is configured for a different local backend port.
  if (url.pathname === "/src/api/client.js") {
    const source = await (await fetch(request.url)).text();
    await send("Fetch.fulfillRequest", {
      requestId: event.requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "text/javascript" }],
      body: Buffer.from(source.replace(/"VITE_API_BASE_URL":\s*"[^"]*"/, '"VITE_API_BASE_URL":"http://localhost:3000/api/v2"')).toString("base64"),
    });
    return;
  }
  calls.push({
    role,
    method: request.method,
    endpoint,
    query: url.search,
    body: request.postData,
  });
  let status = 200,
    data = {},
    message = "";
  const body = request.postData?.startsWith("{")
    ? JSON.parse(request.postData)
    : {};
  if (request.method === "OPTIONS") status = 204;
  else if (nextSubscriptionFailure && endpoint === "/categories/") {
    status = 403;
    message = "Subscription expired or inactive";
  } else if (nextFailure === endpoint) {
    nextFailure = null;
    status = 403;
    message = "Subscription inactive";
  } else if (endpoint === "/users/current-user" && expireAccess) {
    status = 401;
    message = "Access token expired";
  } else if (
    role &&
    role !== "ADMIN" &&
    shops[0].isActive === false &&
    (!endpoint.startsWith("/users/") || endpoint === "/users/register-staff")
  ) {
    status = 403;
    message = "Shop has been deactivated. Contact administrator.";
  } else if (endpoint === '/accounts/activation') {
    data={state:accountingActivationState,revision:accountingActivationRevision,permitted:true,history:[],cutoffAt:null};
  } else if (endpoint.startsWith('/accounts/activation/')) {
    if(endpoint.endsWith('/preview'))data={ready:true,blockers:[],previewToken:'activation-preview',expiresAt:new Date(Date.now()+300000).toISOString()};
    else {accountingActivationRequests.push({endpoint,body});accountingActivationState=endpoint.endsWith('/prepare')?'PREPARING':endpoint.endsWith('/pause')?'PAUSED':'ACTIVE';accountingActivationRevision++;data={state:accountingActivationState,revision:accountingActivationRevision};}
  } else if(endpoint==='/accounts/existing-setup') {
    status=409;message='Opening setup requires owner review';
  } else if (endpoint === "/users/current-user") {
    if (role)
      data = {
        shopActive: role === "ADMIN" || shops[0].isActive !== false,
        ...(role !== "ADMIN" ? { shopName: shops[0].name, shopAddress: shops[0].address, shopContactNo: shops[0].contactNo } : {}),
        ...(role === "OWNER"
          ? { subscriptionExpiry: shops[0].subscriptionExpiry }
          : {}),
        user: {
          username:
            role === "OWNER"
              ? ownerDisplayName
              : role === "CASHIER"
                ? "ali"
                : role.toLowerCase(),
          email: "counter@example.test",
          role,
        },
      };
    else {
      status = 400;
      message = "Token is not provided";
    }
  } else if (endpoint === "/users/refresh-token") {
    if (role && !failRefresh) expireAccess = false;
    else {
      status = 400;
      message = "Could not recieve Refresh Token";
    }
  } else if (endpoint === "/users/login") {
    role = (body.username || "").toUpperCase();
    data = {
      shopActive: role === "ADMIN" || shops[0].isActive !== false,
      ...(role !== "ADMIN" ? { shopName: shops[0].name, shopAddress: shops[0].address, shopContactNo: shops[0].contactNo } : {}),
      ...(role === "OWNER"
        ? { subscriptionExpiry: shops[0].subscriptionExpiry }
        : {}),
      user: {
        username: role === "CASHIER" ? "ali" : body.username,
        role,
        email: "counter@example.test",
      },
    };
  } else if (endpoint === "/users/register") {
    role = "OWNER";
    data = {
      username: "registered",
      email: "registered@example.test",
      role,
      shopName: "Registered shop",
    };
  } else if (endpoint === "/users/logout") {
    role = null;
  } else if (endpoint === "/products/search-product") {
    const category = url.searchParams.get("category");
    const search = url.searchParams.get("search");
    data = {
      product: (!category || category === product.category._id) &&
        (!search || new RegExp(search, "i").test(product.name) || new RegExp(search, "i").test(product.brand)) ? [
        role === "CASHIER"
          ? Object.fromEntries(
              Object.entries(product).filter(([k]) => k !== "costPrice"),
            )
          : product,
      ] : [],
    };
    if (slowCategorySearch && category === "category-one") await sleep(450);
  } else if (endpoint === "/products/low-stock")
    data = {
      counts: product.stockQuantity <= product.minStockThreshold ? 1 : 0,
      Products:
        product.stockQuantity <= product.minStockThreshold ? [product] : [],
    };
  else if (endpoint === "/categories/")
    data = { categories: [product.category, { _id: "category-two", name: "Lighting" }] };
  else if(endpoint.startsWith('/purchases/')){const result=purchaseContract(endpoint,request,body,url);data=result.data;status=result.status||200;message=result.message||'';}
  else if (endpoint.startsWith('/accounts/')) {
    if(role!=='OWNER' || denyAccounts){status=403;message='Owner shop access required';}
    else if(endpoint==='/accounts/entities' && request.method==='POST'){
      data={...body,_id:'entity-'+(businessEntities.length+1),revision:0,...(body.customerId?{name:customer.name,phoneNo:customer.phoneNo}:{} )};businessEntities.push(data);
    } else if(endpoint==='/accounts/entities'){
      const entries=businessEntities.filter(e=>!url.searchParams.get('q') || e.name.toLowerCase().includes(url.searchParams.get('q').toLowerCase()));data={entries,pagination:{currentPage:1,totalPages:1}};
    } else if(/^\/accounts\/entities\/[^/]+$/.test(endpoint))data=businessEntities.find(e=>e._id===endpoint.split('/')[3]);
    else if(endpoint==='/accounts/brands' && request.method==='POST'){data={...body,_id:'brand-'+(businessBrands.length+1)};businessBrands.push(data);}
    else if(endpoint==='/accounts/brands')data={entries:businessBrands,pagination:{currentPage:1,totalPages:1}};
    else if(/^\/accounts\/brands\/[^/]+\/entities$/.test(endpoint)){data=businessBrands.find(b=>b._id===endpoint.split('/')[3]);assert.deepEqual(data.entityIds,body.expectedEntityIds);data.entityIds=body.entityIds;}
    else if(endpoint.startsWith('/accounts/suppliers/')){
      const supplierId=endpoint.split('/')[3];
      if(endpoint.endsWith('/reconciliation'))data={authoritative:supplierReady,cutover:supplierReady?{cutoffAt:'2026-01-01T00:00:00.000Z'}:null,balanceMinor:supplierReady?supplierPayableMinor:null,issues:[]};
      else if(!supplierReady){status=409;message='Supplier accounting is disabled; authoritative payable unavailable';}
      else if(endpoint.endsWith('/balance'))data={authoritative:true,balanceMinor:supplierPayableMinor,accountId:'supplier-payable',currency:'PKR'};
      else if(endpoint.endsWith('/settlements'))data={entries:supplierSettlements.filter(e=>!url.searchParams.get('sourceId')||e.receiptId===url.searchParams.get('sourceId')),pagination:{currentPage:1,totalPages:1},allocation:'UNAPPLIED_SUPPLIER_LEVEL'};
      else {
        const previous=supplierSettlements.find(e=>e.requestKey===body.requestKey);
        if(previous){assert.equal(previous.requestKey,body.requestKey);data={settlement:previous,replayed:true};}
        else if(endpoint.endsWith('/payments')){
          if(body.amountMinor>supplierPayableMinor){status=409;message='Supplier payment exceeds outstanding payable';}
          else if(body.amountMinor>supplierCashMinor){status=409;message='Insufficient cash or bank funds';}
          else {supplierCashMinor-=body.amountMinor;supplierPayableMinor-=body.amountMinor;const e={...body,reference:body.reference||'SP-1',_id:'supplier-payment-'+(supplierSettlements.length+1),supplierId,kind:'PAYMENT',items:[],createdByName:'Paying Owner'};supplierSettlements.push(e);data={settlement:e,replayed:false};if(loseSupplierResponse){loseSupplierResponse=false;await send('Fetch.failRequest',{requestId:event.requestId,errorReason:'ConnectionReset'});return;}}
        } else if(endpoint.endsWith('/returns')){
          const receipt=goodsReceipts.find(r=>r._id===body.receiptId);const items=body.items.map(i=>({...i,name:product.name,unitCostMinor:receipt.items[0].unitCostMinor})),amountMinor=items.reduce((n,i)=>n+i.quantity*i.unitCostMinor,0);
          if(amountMinor>supplierPayableMinor){status=409;message='Return exceeds remaining supplier payable; supplier refund-due/credit workflow is not supported';}
          else {supplierPayableMinor-=amountMinor;product.stockQuantity-=items.reduce((n,i)=>n+i.quantity,0);const e={...body,reference:body.reference||'SR-1',_id:'supplier-return-'+(supplierSettlements.length+1),supplierId,kind:'RETURN',items,amountMinor,receiptReference:receipt.reference,createdByName:'Returning Owner'};supplierSettlements.push(e);data={settlement:e,replayed:false};}
        }
      }
    }
    else if(endpoint==='/accounts/transactions'||/^\/accounts\/transactions\/[^/]+$/.test(endpoint)){
      if(!supplierReady&&!allowAccountBalance){status=409;message='Accounting is disabled; posted test journal register is unavailable';}
      else {const entries=supplierSettlements.map(e=>({eventId:e._id,eventType:'SUPPLIER_'+e.kind,sourceDocument:{reference:e.reference,receiptId:e.receiptId},occurredAt:e.occurredAt,recordedAt:e.occurredAt,actor:{name:e.createdByName,role:'OWNER'},amountMinor:e.amountMinor,postings:[{accountId:'cash-account',account:{name:'Counter cash',kind:'CASH'},debitMinor:0,creditMinor:e.kind==='PAYMENT'?e.amountMinor:0,moneyOutMinor:e.kind==='PAYMENT'?e.amountMinor:null,moneyInMinor:null}],businessAction:{items:e.items},reversedBy:[]}));data=endpoint==='/accounts/transactions'?{entries,pagination:{currentPage:1,totalPages:1},coverage:{complete:false}}:{transaction:entries.find(e=>e.eventId===endpoint.split('/')[3]),originalTransaction:null};}
    }
    else if(endpoint==='/accounts/financial' && request.method==='POST'){status=409;message='Accounting is disabled; live balances and financial mutations are unavailable';}
    else if(endpoint==='/accounts/financial')data={entries:financialAccounts,pagination:{currentPage:1,totalPages:1},livePostingEnabled:false};
    else if(/^\/accounts\/customers\/[^/]+\/history$/.test(endpoint))data={customer:{_id:customer._id,name:customer.name,phoneNo:customer.phoneNo,address:customer.address},position:{debtMinor:1000,storeCreditMinor:4000,reconciled:true,issues:[],asOf:'2026-01-01T00:00:00.000Z'},coverage:{complete:true,journalEventsDeduplicated:true},entries:[{eventId:'customer-sale',type:'INVOICE',activity:'Invoice created',occurredAt:'2026-01-01T10:00:00.000Z',invoiceNo:'INV-1',orderId:invoice._id,amountMinor:5000,debtEffectMinor:1000,creditEffectMinor:null,details:{reason:'Sale',actor:'Original Seller',cashReceivedMinor:4000}}],pagination:{currentPage:1,limit:20,recordCount:1,totalPages:1}};
    else if(endpoint==='/accounts/customers/activity'){
      const service=url.searchParams.get('service'),payment={eventId:'customer-payment',type:'PAYMENT',activity:'Payment received',occurredAt:'2026-01-01T11:00:00.000Z',customerId:customer._id,customerName:customer.name,customerPhone:customer.phoneNo,availableCreditMinor:4000,invoiceNo:'INV-1',orderId:invoice._id,amountMinor:1000,debtEffectMinor:-1000,creditEffectMinor:null,transactionIds:['payment-journal'],accounts:[{_id:'cash-account',name:'Counter cash',kind:'CASH'}],details:{reason:'Payment received',actor:'Ali',cashReceivedMinor:1000}},returned={eventId:'customer-return',type:'RETURN',activity:'Product return',occurredAt:'2026-01-02T11:00:00.000Z',customerId:customer._id,customerName:customer.name,customerPhone:customer.phoneNo,availableCreditMinor:4000,invoiceNo:'INV-1',orderId:invoice._id,amountMinor:500,debtEffectMinor:-500,creditEffectMinor:null,transactionIds:[],accounts:[{_id:'cash-account',name:'Counter cash',kind:'CASH'}],details:{reason:'Return accepted',actor:'Ali',cashRefundMinor:500,products:[{productId:product._id,name:product.name,quantity:1,condition:'RESTOCK'}]}},credit={...payment,eventId:'customer-credit',type:'CREDIT',activity:'Store credit issued',amountMinor:500,creditEffectMinor:500,details:{reason:'Refund issued as store credit',actor:'Ali',creditIssuedMinor:500},transactionIds:[]};
      const invoiceActivity={...payment,eventId:'customer-invoice',type:'INVOICE',activity:'Invoice created',amountMinor:5000,details:{reason:'Invoice created',actor:'Ali'}},entries=service==='INVOICES'?[invoiceActivity]:service==='PAYMENTS'?[payment]:service==='RETURNS'?[returned]:service==='REFUNDS'?[returned]:service==='CREDIT'?[credit]:[invoiceActivity,payment,returned,credit];data={filterCustomer:url.searchParams.has('customerId')?{_id:customer._id,name:customer.name,phoneNo:customer.phoneNo}:null,coverage:{complete:true,limitedBy:'NONE'},entries,pagination:{currentPage:Number(url.searchParams.get('page')||1),limit:20,recordCount:entries.length,totalPages:1}};
    }
    else if(endpoint.endsWith('/reconciliation'))data={debtMinor:1000,storeCreditMinor:4000,reconciled:true,issues:[]};
    else if(endpoint.endsWith('/history')){
      if(!allowAccountBalance){status=409;message='Prepared cash/bank cutover required; balance unavailable';}
      else data={balanceMinor:125000,currency:'PKR',rangeOpeningBalanceMinor:0,rangeClosingBalanceMinor:5000,transactions:[{eventId:'tx-'+(url.searchParams.get('page')||1),eventType:'INVOICE_RECEIPT',occurredAt:'2026-01-01T10:00:00.000Z',sourceDocument:{invoiceNo:'INV-1',orderId:invoice._id},actor:{name:'Original Seller'},amountMinor:5000,runningBalanceMinor:url.searchParams.get('q')?null:5000}],pagination:{currentPage:Number(url.searchParams.get('page')||1),totalPages:2}};
    } else if(endpoint==='/accounts/financial/cash-account'){
      if(!allowAccountBalance&&!supplierReady){status=409;message='Accounting is disabled; live balances and financial mutations are unavailable';}
      else data={account:financialAccounts[0],authority:'JOURNAL',balanceMinor:supplierReady?supplierCashMinor:125000,currency:'PKR',livePostingEnabled:false};
    } else {status=404;message='Account not found in shop';}
  }
  else if (endpoint === "/customers/" || endpoint === "/customers")
    data = {
      customers: [customer],
      pagination: { currentPage: 1, totalPages: 1 },
    };
  else if (endpoint === "/customers/create-customer") {
    await sleep(250);
    data = { customer: { ...customer, ...body } };
  } else if (endpoint === "/orders/payment-accounts") {
    data = {accountingEnabled:false,accounts:[]};
  } else if (endpoint === "/orders/create-order") {
    if (body.creditAmount) {
      assert.ok(body.customerId);
      assert.match(body.requestKey, /^[\w-]{8,100}$/);
      if (posCreditRequests.has(body.requestKey)) {
        data = posCreditRequests.get(body.requestKey);
        await send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: "Access-Control-Allow-Origin", value: "http://localhost:5173" }, { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify({ data })).toString("base64") });
        return;
      }
    }
    assert.ok(["NONE", "FIXED", "PERCENTAGE"].includes(body.discountType));
    assert.ok(Number.isFinite(body.paidAmount));
    invoice = {
      ...invoice,
      items: body.items.map((item) => ({
        ...item,
        unitPrice: body.saleType === "WHOLESALE" ? 40 : 50,
      })),
      saleType: body.saleType,
      subtotal: body.items.reduce(
        (sum, i) =>
          sum + i.quantity * (body.saleType === "WHOLESALE" ? 40 : 50),
        0,
      ),
      createdByName: role === "CASHIER" ? "ali" : ownerDisplayName,
      paidAmount: body.paidAmount + (body.creditAmount || 0),
      customerId: body.customerId,
    };
    invoice.discountAmount =
      body.discountType === "FIXED"
        ? body.discountValue
        : body.discountType === "PERCENTAGE"
          ? (invoice.subtotal * body.discountValue) / 100
          : 0;
    invoice.totalPrice = invoice.subtotal - invoice.discountAmount;
    invoice.amountDue = invoice.totalPrice - invoice.paidAmount;
    invoice.items = invoice.items.map((item, index) => ({ ...item, lineId: `line-${index}`, name: product.name, brand: product.brand, unit: product.unit }));
    invoice.discountType = body.discountType;
    invoice.discountValue = body.discountValue;
    invoice.revision = 0;
    invoice.status = "PENDING";
    invoice.originalSnapshot = { ...invoice, originalSnapshot: undefined };
    if (body.creditAmount) {
      customer.storeCreditBalanceMinor -= body.creditAmount * 100;
      invoice.settlementState = { cashNetMinor: body.paidAmount * 100, creditNetMinor: body.creditAmount * 100 };
      posCreditRequests.set(body.requestKey, structuredClone(invoice));
    }
    data = invoice;
    if (body.creditAmount && failFinancialResponse) { failFinancialResponse = false; await send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" }); return; }
  } else if (endpoint === "/orders/")
    data = { orders: [invoice], pagination: { currentPage: 1, totalPages: 1 } };
  else if (endpoint === "/orders/" + invoice._id)
    data = {
      order: {
        ...invoice,
        items: invoice.items.map((item, index) => ({ ...item, lineId: item.lineId || `legacy-${index}`, productId: product })),
        customerId: invoice.customerId ? customer : null,
      },
      originalSnapshot: invoice.originalSnapshot || null,
      eligibility: { revision: invoice.revision || 0, adjustmentEligible: invoice.status !== "CANCELLED", paymentEligible: invoice.amountDue > 0 && !!invoice.customerId, cancellationEligible: invoice.status === "PENDING" },
    };
  else if (endpoint === `/orders/${invoice._id}/history`) {
    const matching = financialEvents.filter(e => e.orderId === invoice._id && (!url.searchParams.get("requestKey") || e.requestKey === url.searchParams.get("requestKey")));
    const page = Number(url.searchParams.get("page") || 1), limit = Number(url.searchParams.get("limit") || 20);
    data = { history: matching.slice((page - 1) * limit, page * limit), revision: invoice.revision || 0, pagination: { currentPage: page, totalPages: Math.ceil(matching.length / limit), recordCount: matching.length } };
  } else if (/\/(adjustments|payments|cancellations)(\/preview)?$/.test(endpoint)) {
    assert.equal(role, "OWNER");
    const kind = endpoint.includes("/payments") ? "PAYMENT" : endpoint.includes("/cancellations") ? "CANCELLATION" : "ADJUSTMENT";
    if (endpoint.endsWith("/preview")) {
      if (staleFinancialPreview) { status = 409; message = "Invoice changed; reload before preview"; staleFinancialPreview = false; }
      else {
        const before = { items: invoice.items, totalMinor: invoice.totalPrice * 100, subtotalMinor: invoice.subtotal * 100, discountMinor: invoice.discountAmount * 100, settledMinor: invoice.paidAmount * 100, dueMinor: invoice.amountDue * 100 };
        data = financialPreview || { revision: invoice.revision || 0, before, proposed: { ...before, items: [], totalMinor: 0, subtotalMinor: 0, discountMinor: 0, settledMinor: 0, dueMinor: 0 }, movements: [], requirements: { refundMinor: invoice.paidAmount * 100, creditRestoreMinor: 0, cashRefundMaximumMinor: invoice.paidAmount * 100 }, settlement: { cashRefundMinor: invoice.paidAmount * 100, cashReceivedMinor: 0, creditRedeemedMinor: 0, creditIssuedMinor: 0 }, canSubmit: true, confirmationToken: "a".repeat(64), validationMessage: null };
      }
    } else {
      assert.equal(body.confirmationToken, "a".repeat(64));
      const old = financialEvents.find(e => e.requestKey === body.requestKey);
      if (old) data = { event: old };
      else {
        const proposed = financialPreview?.proposed || { items: [], totalMinor: 0, subtotalMinor: 0, discountMinor: 0, settledMinor: 0, dueMinor: 0 };
        const eventRecord = { _id: "event-" + financialEvents.length, kind, orderId: invoice._id, revisionBefore: invoice.revision || 0, revisionAfter: (invoice.revision || 0) + 1, requestKey: body.requestKey, createdByName: "owner", reason: body.reason, occurredAt: new Date().toISOString(), after: proposed, before: financialPreview?.before, movements: financialPreview?.movements || [], financial: financialPreview?.settlement || {} };
        financialEvents.unshift(eventRecord);
        Object.assign(invoice, { items: proposed.items, revision: eventRecord.revisionAfter, subtotal: proposed.subtotalMinor / 100, totalPrice: proposed.totalMinor / 100, discountAmount: proposed.discountMinor / 100, paidAmount: proposed.settledMinor / 100, amountDue: proposed.dueMinor / 100 });
        if (kind === "CANCELLATION") { invoice.status = "CANCELLED"; invoice.cancellationMode = "SETTLED"; }
        data = { event: eventRecord };
      }
      if (failFinancialResponse) { failFinancialResponse = false; await send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" }); return; }
      if (incompleteFinancialResponse) { incompleteFinancialResponse = false; data = {}; }
    }
  }
  else if (endpoint === "/orders/" + invoice._id + "/cancel") {
    invoice.status = "CANCELLED";
    data = { orderInDb: invoice };
  } else if (endpoint === "/orders/" + invoice._id + "/status") {
    invoice.status = "DELIVERED";
    data = invoice;
  } else if (endpoint === "/orders/quotation") {
    quotation = {
      ...invoice,
      _id: "quote-one",
      type: "QUOTATION",
      createdByName: role === "CASHIER" ? "ali" : ownerDisplayName,
      invoiceNo: "",
      status: "DRAFT",
      paidAmount: 0,
      amountDue: 0,
    };
    data = { quotation };
  } else if (endpoint === "/orders/quote-one") {
    invoice = {
      ...quotation,
      _id: "invoice-two",
      type: "INVOICE",
      invoiceNo: "INV-2",
      status: "PENDING",
      paidAmount: body.paidAmount,
      amountDue: quotation.totalPrice - body.paidAmount,
    };
    data = { createOrder: invoice };
  } else if (endpoint === "/orders/stocklogs")
    data = {
      logs: stockLogs,
      pagination: {
        currentPage: Number(url.searchParams.get("page") || 1),
        totalPages: 2,
      },
    };
  else if (endpoint.endsWith("/adjust-stock")) {
    product.stockQuantity += body.quantityDelta;
    stockLogs.push({
      _id: "log-" + stockLogs.length,
      productId: product,
      quantityDelta: body.quantityDelta,
      reason: body.reason,
      createdAt: new Date().toISOString(),
    });
    data = { updatestock: product, stockLog: [] };
  } else if (endpoint === "/products/create-product") {
    data = { product: { ...product, ...body, _id: "new-product" } };
  } else if (endpoint === "/products/product-one") {
    Object.assign(product, { ...body, category: body.category ? { ...product.category, _id: body.category } : product.category });
    data = { updatedProduct: product };
  } else if (endpoint === "/categories/create-category")
    data = { category: { ...body, _id: "new-category" } };
  else if (endpoint === "/users/register-staff") {
    const cashier = { _id: "cashier-one", username: "newcounter", email: "newcounter@example.test" };
    cashiers.push(cashier);
    data = { cashier };
  }
  else if (endpoint === "/users/cashiers") data = { cashiers };
  else if (endpoint.startsWith("/users/cashiers/")) {
    const target = cashiers.find(cashier => cashier._id === endpoint.split("/")[3]);
    if (!target) { status = 404; message = "Cashier not found"; }
    else if (request.method === "DELETE") cashiers.splice(cashiers.indexOf(target), 1);
    else if (!endpoint.endsWith("/reset-password")) {
      Object.assign(target, body);
      data = { cashier: target };
    }
  }
  else if (endpoint === "/ai/query") {
    await sleep(300);
    data = { action: "checkStock", question: body.text || "Copper cable stock", answer: "Copper Cable has 20 meters in stock.", data: [] };
  }
  else if (endpoint === "/users/change-password") data = {};
  else if (endpoint === "/users/profile" || endpoint === "/users/shop-details") {
    if (endpoint === "/users/shop-details") {
      shops[0].name = body.shopName;
      shops[0].address = body.address;
      shops[0].contactNo = body.contactNo;
    }
    data = {
      user: { username: body.username || (role === "OWNER" ? ownerDisplayName : role === "CASHIER" ? "ali" : "admin"), email: body.email || "counter@example.test", role },
      shopActive: true,
      ...(role !== "ADMIN" ? { shopName: shops[0].name, shopAddress: shops[0].address, shopContactNo: shops[0].contactNo } : {}),
      ...(role === "OWNER" ? { subscriptionExpiry: shops[0].subscriptionExpiry } : {}),
    };
  }
  else if (endpoint === "/admin/shops") data = { shops };
  else if (request.method === "DELETE" && /^\/admin\/shops\/[^/]+$/.test(endpoint)) {
    const index = shops.findIndex(shop => shop._id === endpoint.split("/")[3]);
    if (index < 0) { status = 404; message = "Shop not found"; }
    else if (shops[index].isActive !== false) { status = 403; message = "Deactivate the shop before deleting it"; }
    else shops.splice(index, 1);
  }
  else if (
    /^\/admin\/shops\/[^/]+\/(activate|extend|deactivate|reactivate)$/.test(
      endpoint,
    )
  ) {
    const parts = endpoint.split("/"),
      target = shops.find((shop) => shop._id === parts[3]),
      action = parts[4];
    if (action === "deactivate" || action === "reactivate")
      target.isActive = action === "reactivate";
    else {
      const base =
        action === "extend"
          ? Math.max(
              Date.now(),
              new Date(target.subscriptionExpiry || 0).getTime(),
            )
          : Date.now();
      target.subscriptionActive = true;
      target.subscriptionExpiry = new Date(base + 2592000000).toISOString();
    }
    data = { shop: { ...target, ownerId: "unpopulated-owner" } };
  } else {
    status = 404;
    message = "Unknown test endpoint";
  }
  await send("Fetch.fulfillRequest", {
    requestId: event.requestId,
    responseCode: status,
    responseHeaders: [
      { name: "Content-Type", value: "application/json" },
      { name: "Access-Control-Allow-Origin", value: "http://localhost:5173" },
      { name: "Access-Control-Allow-Credentials", value: "true" },
      { name: "Access-Control-Allow-Headers", value: "Content-Type" },
      { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,DELETE,OPTIONS" },
    ],
    body:
      status === 204
        ? ""
        : Buffer.from(
            JSON.stringify(
              status >= 400 ? { message } : { data, messege: "OK" },
            ),
          ).toString("base64"),
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails)
    throw Error(
      result.exceptionDetails.text +
        " " +
        JSON.stringify(result.exceptionDetails.exception),
    );
  return result.result.value;
}
async function wait(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(expression)) return;
    await sleep(80);
  }
  throw Error(
    "Timed out: " +
      expression +
      "\n" +
      (await evaluate("document.body.innerText")) + "\nBrowser errors: " + JSON.stringify(errors),
  );
}
async function assertReceiptShop() {
  const identity = await evaluate(`(() => {
    const header = document.querySelector(".receipt").firstElementChild;
    return {
      name: header.querySelector("h2")?.textContent,
      details: [...header.querySelectorAll("p")].map(p => p.textContent),
      visible: getComputedStyle(header).visibility,
      isShopHeader: header.classList.contains("receipt-shop")
    };
  })()`);
  assert.deepEqual(identity, {
    name: shops[0].name,
    details: [shops[0].address, "Phone: " + shops[0].contactNo],
    visible: "visible",
    isShopHeader: true,
  });
}
const click = async (text) => {
  await wait(
    '(()=>{const el=[...document.querySelectorAll("button,a,summary")].find(e=>e.textContent.trim()===' +
      JSON.stringify(text) +
      "&&e.getClientRects().length&&!e.disabled);if(!el)return false;el.click();return true;})()",
  );
};
const fill = async (selector, value) => {
  await wait("!!document.querySelector(" + JSON.stringify(selector) + ")");
  // A select can render before its asynchronously loaded options arrive.
  await wait(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el && (el.tagName !== "SELECT" || [...el.options].some(option => option.value === ${JSON.stringify(value)})); })()`);
  return evaluate(
    "(()=>{const el=document.querySelector(" +
      JSON.stringify(selector) +
      ');for(let d=el.closest("details");d;d=d.parentElement?.closest("details"))if(!d.open)d.querySelector("summary").click();const proto=el.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value").set.call(el,' +
      JSON.stringify(value) +
      ');el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));})()',
  );
};
async function fillLabel(label, value) {
  const selector = await evaluate(
    '(()=>{const el=[...document.querySelectorAll("label")].find(e=>e.textContent.trim().startsWith(' +
      JSON.stringify(label) +
      '));const input=el.querySelector("input");input.id="smoke-field";return "#smoke-field";})()',
  );
  await fill(selector, value);
  await evaluate(
    'document.querySelector("#smoke-field").removeAttribute("id")',
  );
}
async function screenshot(name) {
  fs.mkdirSync("tests/artifacts", { recursive: true });
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(
    "tests/artifacts/" + name + ".png",
    Buffer.from(shot.data, "base64"),
  );
}
async function login(as) {
  await wait('!!document.querySelector("[name=identity]")');
  await fill("[name=identity]", as.toLowerCase());
  await fill("[name=password]", "test-password");
  await click("Sign in");
  await wait('!!document.querySelector(".sidebar")');
}
try {
  let pages;
  for (let i = 0; i < 100; i++) {
    try {
      pages = await (await fetch("http://localhost:"+debugPort+"/json")).json();
      break;
    } catch {
      await sleep(100);
    }
  }
  const debuggerUrl=new URL(pages.find((p)=>p.type==="page").webSocketDebuggerUrl);
  debuggerUrl.hostname="127.0.0.1";
  socket = new WebSocket(debuggerUrl);
  await new Promise((resolve) =>
    socket.addEventListener("open", resolve, { once: true }),
  );
  socket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const promise = pending.get(message.id);
      if (promise) {
        pending.delete(message.id);
        message.error
          ? promise.reject(Error(message.error.message))
          : promise.resolve(message.result);
      }
    } else if (message.method === "Page.javascriptDialogOpening" && message.params.type === "beforeunload") {
      await send("Page.handleJavaScriptDialog", { accept: true });
    } else if (message.method === "Fetch.requestPaused") {
      try {
        await mock(message.params);
      } catch (error) {
        // Route changes abort GETs; Chrome can discard their interception first.
        if (/Invalid InterceptionId/i.test(error.message)) return;
        errors.push(error.message);
        try {
          await send("Fetch.failRequest", {
            requestId: message.params.requestId,
            errorReason: "Failed",
          });
        } catch (failure) {
          if (!/Invalid InterceptionId/i.test(failure.message))
            errors.push(failure.message);
        }
      }
    } else if (message.method === "Network.responseReceived") {
      if (
        message.params.response.url.startsWith("http://localhost:3000/api/v2/")
      )
        liveResponses.push(message.params.response);
    } else if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.text);
    else if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params.type === "error"
    )
      errors.push(message.params.args.map((a) => a.value).join(" "));
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Fetch.enable", {
    patterns: [{ urlPattern: "http://localhost:3000/api/v2/*" }, { urlPattern: "http://localhost:5173/src/api/client.js*" }],
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: "http://localhost:5173" });
  await login("CASHIER");
  assert.equal(await evaluate('document.querySelector(".accounts-nav")'),null);
  assert.equal(await evaluate('[...document.querySelectorAll(".sidebar a")].some(a=>a.textContent==="Purchases")'),false);
  await send('Page.navigate',{url:'http://localhost:5173/owner/accounts/companies'});
  await wait('location.pathname === "/cashier/pos"');
  assert.ok(!calls.some(c=>c.role==='CASHIER'&&c.endpoint.startsWith('/accounts/')));
  await wait('!!document.querySelector(".product-result")');
  assert.deepEqual(
    await evaluate(
      '[...document.querySelectorAll(".sidebar nav a")].map(e=>e.textContent)',
    ),
    ["POS", "Customer accounts", "Quotations", "AI Assistant"],
  );
  assert.ok(
    !(await evaluate(
      '/cost|profit|margin/i.test(document.querySelector(".workspace").innerText)',
    )),
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".cashier-welcome .text-body-secondary").textContent',
    ),
    "Hardware Shop",
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".sidebar-account,.sidebar-identity")',
    ),
    null,
  );
  await screenshot("cashier-pos");
  assert.equal(
    await evaluate('document.querySelector(".brand-name").textContent'),
    "DigiShop",
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".cashier-welcome strong").textContent',
    ),
    "Ali",
  );
  assert.equal(
    await evaluate('document.querySelector(".header-actions a").textContent'),
    "Account",
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".cashier-welcome strong").textContent',
    ),
    "Ali",
  );
  assert.ok(
    !(await evaluate(
      'document.querySelector(".cashier-welcome").textContent.includes("Owner")',
    )),
  );
  expireAccess = true;
  await send("Page.reload");
  await sleep(300);
  await wait('!!document.querySelector(".product-result")');
  assert.ok(
    calls.some(
      (c) => c.role === "CASHIER" && c.endpoint === "/users/refresh-token",
    ),
  );
  await fill('[aria-label="Search products by name or brand"]', "Missing product");
  await evaluate(
    `document.querySelector('[aria-label="Search products by name or brand"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
  );
  assert.equal(
    await evaluate('document.querySelectorAll(".cart-table .quantity").length'),
    0,
    "Enter must not add a product that does not match the current text",
  );
  await fill('[aria-label="Search products by name or brand"]', "Cable");
  await sleep(350);
  await send("Page.navigate", { url: "http://localhost:5173/owner/products" });
  await wait(
    'location.pathname === "/cashier/pos" && !!document.querySelector(".product-result")',
  );
  await evaluate('document.querySelector(".product-result").click()');
  const paymentInput = '[...document.querySelectorAll("label")].find(e=>e.textContent.includes("Amount paid")).querySelector("input")';
  assert.equal(await evaluate(paymentInput + '.value'), "50");
  await fill('[aria-label="Quantity for Copper Cable"]', "2");
  assert.equal(await evaluate(paymentInput + '.value'), "100");
  await fillLabel("Amount paid", "");
  assert.equal(await evaluate(paymentInput + '.value'), "");
  const beforeBlankCheckout = calls.filter(c => c.endpoint === "/orders/create-order").length;
  await click("Complete sale");
  await wait('document.body.innerText.includes("Amount paid must be between zero and the sale total.")');
  assert.equal(calls.filter(c => c.endpoint === "/orders/create-order").length, beforeBlankCheckout);
  await click("Customers");
  await click("POS");
  await wait('!!document.querySelector(".cart-table .quantity")');
  assert.equal(await evaluate(paymentInput + '.value'), "", "Manual blank survives navigation");
  await fillLabel("Amount paid", "0");
  await fill('[aria-label="Quantity for Copper Cable"]', "1");
  assert.equal(await evaluate(paymentInput + '.value'), "0");
  await evaluate("window.confirm = () => false");
  await click("Customers");await click("Customer accounts");
  await wait('location.pathname === "/cashier/customers"');
  await click("POS");
  await wait('!!document.querySelector(".cart-table .quantity")');
  assert.equal(
    await evaluate('document.querySelector(".cart-table .quantity").value'),
    "1",
    "Counter cart survives navigation",
  );
  await fillLabel("Amount paid", "20");
  await click("Customers");
  await click("POS");
  await wait('!!document.querySelector(".cart-table .quantity")');
  assert.equal(await evaluate(paymentInput + '.value'), "20", "Manual partial payment survives navigation");
  await click("Select customer");
  await wait('!!document.querySelector(".customer-result")');
  await click("New customer");
  await fill("[name=name]", "New buyer");
  await fill("[name=phoneNo]", "03001234567");
  await click("Save customer");
  assert.equal(
    await evaluate(
      '[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="Complete sale").disabled',
    ),
    true,
    "Sale must wait for customer creation",
  );
  await wait('document.body.innerText.includes("New buyer")');
  await fill('[aria-label="Search products by name or brand"]', "Cable");
  await sleep(350);
  const saleBeforeCategory = await evaluate(`JSON.stringify({
    cart: document.querySelector(".cart-table").innerText,
    quantity: document.querySelector(".cart-table .quantity").value,
    paid: ${paymentInput}.value,
    saleType: document.querySelector('[aria-label="Sale type"]').value,
    discount: document.querySelector(".row select").value,
    total: document.querySelector(".sale-total").innerText,
    customer: document.body.innerText.includes("New buyer")
  })`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="POS category filter"]').value`), "");
  await fill('[aria-label="POS category filter"]', "category-two");
  await wait('document.body.innerText.includes("No matching products.")');
  const saleAfterCategory = await evaluate(`JSON.stringify({
    cart: document.querySelector(".cart-table").innerText,
    quantity: document.querySelector(".cart-table .quantity").value,
    paid: ${paymentInput}.value,
    saleType: document.querySelector('[aria-label="Sale type"]').value,
    discount: document.querySelector(".row select").value,
    total: document.querySelector(".sale-total").innerText,
    customer: document.body.innerText.includes("New buyer")
  })`);
  assert.equal(saleAfterCategory, saleBeforeCategory);
  await click("Customers");
  await click("POS");
  await wait('!!document.querySelector(".cart-table .quantity")');
  await wait(`!!document.querySelector('[aria-label="POS category filter"] option[value="category-two"]')`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="POS category filter"]').value`), "category-two");
  slowCategorySearch = true;
  await fill('[aria-label="POS category filter"]', "category-one");
  await sleep(30);
  await fill('[aria-label="POS category filter"]', "category-two");
  await sleep(550);
  assert.equal(await evaluate('document.querySelectorAll(".product-result").length'), 0, "An older category response cannot replace the current result");
  slowCategorySearch = false;
  await fill('[aria-label="POS category filter"]', "category-one");
  await wait('!!document.querySelector(".product-result")');
  assert.ok(calls.some(c => c.role === "CASHIER" && c.endpoint === "/products/search-product" && c.query.includes("category=category-one")));
  await fill('[aria-label="POS category filter"]', "");
  await wait('!!document.querySelector(".product-result")');
  assert.equal(
    calls.filter((c) => c.endpoint === "/orders/create-order").length,
    0,
    "Customer form must not submit sale",
  );
  await click("Complete sale");
  await wait('document.body.innerText.includes("Sale completed.")');
  assert.equal(invoice.paidAmount, 20);
  assert.equal(invoice.amountDue, 30);
  assert.ok(
    await evaluate(
      'document.querySelector(".receipt").innerText.includes("New buyer")',
    ),
  );
  assert.ok(await evaluate('document.querySelector(".receipt").innerText.includes("Sold by: Ali")'));
  await assertReceiptShop();
  await screenshot("receipt");
  await send("Emulation.setEmulatedMedia", { media: "print" });
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector(".sidebar")).visibility',
    ),
    "hidden",
  );
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector(".receipt")).visibility',
    ),
    "visible",
  );
  assert.ok(await evaluate('document.querySelector(".receipt").innerText.includes("Sold by: Ali")'));
  await assertReceiptShop();
  const printed = await send("Page.printToPDF", { printBackground: false });
  fs.writeFileSync(
    "tests/artifacts/receipt-print.pdf",
    Buffer.from(printed.data, "base64"),
  );
  assert.ok(Buffer.from(printed.data, "base64").length > 1500);
  await send("Emulation.setEmulatedMedia", { media: "" });
  await evaluate("window.print = () => { window.auditPrinted = true; }");
  await click("Print receipt");
  assert.equal(await evaluate("window.auditPrinted"), true);
  for (const [saleType, discountType, discountValue, expected] of [
    ["RETAIL", "NONE", 0, 50],
    ["WHOLESALE", "NONE", 0, 40],
    ["RETAIL", "FIXED", 10, 40],
    ["RETAIL", "PERCENTAGE", 10, 45],
  ]) {
    await click("Next sale");
    await wait('!!document.querySelector(".product-result:not(:disabled)")');
    await fill('[aria-label="Sale type"]', saleType);
    await wait('!!document.querySelector(".product-result:not(:disabled)")');
    await evaluate('document.querySelector(".product-result").click()');
    await evaluate(
      'document.querySelector(".row select").id = "discount-test"',
    );
    await fill("#discount-test", discountType);
    if (discountType !== "NONE")
      await fillLabel(
        discountType === "PERCENTAGE" ? "Percent" : "Amount",
        String(discountValue),
      );
    await click("Complete sale");
    await wait('document.body.innerText.includes("Sale completed.")');
    assert.equal(invoice.totalPrice, expected);
    assert.equal(invoice.paidAmount, expected);
    assert.equal(invoice.amountDue, 0);
  }
  await click("Next sale");
  await wait('!!document.querySelector(".product-result:not(:disabled)")');
  await evaluate('document.querySelector(".product-result").click()');
  await fillLabel("Amount paid", "0");
  const writesBefore = calls.filter(
    (c) => c.endpoint === "/orders/create-order",
  ).length;
  await click("Complete sale");
  await wait('document.body.innerText.includes("Select or create a customer")');
  assert.equal(
    calls.filter((c) => c.endpoint === "/orders/create-order").length,
    writesBefore,
  );
  await click("Select customer");await wait('!!document.querySelector(".customer-result")');await evaluate('document.querySelector(".customer-result").click()');
  nextFailure = "/orders/create-order";
  await click("Complete sale");
  await wait('document.body.innerText.includes("active subscription")');
  assert.ok(
    await evaluate('!!document.querySelector(".cart-table .quantity")'),
    "Rejected sales keep the cart",
  );
  await click("Complete sale");
  await wait('document.body.innerText.includes("Sale completed.")');
  // Cashier credit redemption preserves cash-only checkout and recovers a lost
  // response by replaying the identical idempotent request, not a new sale.
  await click("Next sale");
  await wait('!!document.querySelector(".product-result:not(:disabled)")');
  await evaluate('document.querySelector(".product-result").click()');
  await click("Select customer");
  await wait('!!document.querySelector(".customer-result")');
  await evaluate('document.querySelector(".customer-result").click()');
  await fillLabel("Store credit to use", "40");
  assert.equal(await evaluate(paymentInput + '.value'), "10");
  failFinancialResponse = true;
  const walletBeforeSale = customer.storeCreditBalanceMinor;
  await click("Complete sale");
  await wait('document.body.innerText.includes("Retry same sale")');
  await send("Page.reload"); await sleep(250);
  await click("Retry same sale");
  await wait('document.body.innerText.includes("Sale completed.")');
  const creditWrites = calls.filter(c => c.endpoint === "/orders/create-order" && c.method === "POST" && JSON.parse(c.body).creditAmount);
  assert.equal(creditWrites.length, 2);
  assert.deepEqual(JSON.parse(creditWrites[0].body), JSON.parse(creditWrites[1].body));
  assert.equal(customer.storeCreditBalanceMinor, walletBeforeSale - 4000);
  assert.equal(invoice.paidAmount, 50);
  assert.ok(await evaluate('document.querySelector(".receipt").innerText.includes("Net store-credit settlement")'));
  assert.equal(await evaluate('[...document.querySelectorAll("button")].some(b => b.textContent === "Return / change invoice")'), false);
  await click("Customers");await click("Customer accounts");
  await wait('!!document.querySelector("table")');
  await fill('[aria-label="Search customer by name or phone"]', "0300");
  await sleep(350);
  assert.ok(
    calls.some(
      (c) =>
        c.role === "CASHIER" &&
        c.endpoint === "/customers/" &&
        c.query.includes("search=0300"),
    ),
  );
  await screenshot("cashier-customers");
  await click("POS");
  await wait('!!document.querySelector(".receipt")');
  await click("AI Assistant");
  await wait('document.body.innerText.includes("Speak")');
  assert.equal(await evaluate('document.querySelector("input[type=file]")'), null);
  await evaluate('navigator.mediaDevices.getUserMedia = async () => { throw new Error("Permission denied"); }');
  await click("Speak");
  await wait('document.body.innerText.includes("Microphone access was not available")');
  await fill('[aria-label="Ask about your shop"]', "How many bulbs?");
  await click("Send");
  await wait('document.body.innerText.includes("Processing...")');
  await wait('document.body.innerText.includes("Copper Cable has 20 meters")');
  assert.ok(calls.some(c=>c.endpoint==="/ai/query" && c.method==="POST" && c.body && JSON.parse(c.body).text==="How many bulbs?"));
  await fill('[aria-label="Ask about your shop"]', "Stock again?");
  await wait('document.querySelector("input[placeholder]").value === "Stock again?" && !document.querySelector("input[placeholder]").disabled');
  await evaluate('document.querySelector("input[placeholder]").focus()');
  await send("Input.dispatchKeyEvent", {type:"keyDown", key:"Enter", code:"Enter", windowsVirtualKeyCode:13, nativeVirtualKeyCode:13, text:"\r", unmodifiedText:"\r"});
  await send("Input.dispatchKeyEvent", {type:"keyUp", key:"Enter", code:"Enter", windowsVirtualKeyCode:13});
  await wait('document.querySelectorAll(".assistant-exchange").length===2');
  nextFailure = "/ai/query";
  await fill('[aria-label="Ask about your shop"]', "Stock?");
  await click("Send");
  await wait('!!document.querySelector("[role=alert]")');
  await evaluate('navigator.mediaDevices.getUserMedia = async () => { window.aiAudioContext = new AudioContext(); const destination=window.aiAudioContext.createMediaStreamDestination(); const oscillator=window.aiAudioContext.createOscillator(); oscillator.connect(destination); oscillator.start(); await window.aiAudioContext.resume(); window.aiRecordedStream=destination.stream; return destination.stream; }');
  await click("Speak");
  await wait('document.body.innerText.includes("Listening...")');
  await sleep(250);
  await click("Stop and send");
  await wait('document.querySelectorAll(".assistant-exchange").length===3');
  assert.ok(await evaluate('window.aiRecordedStream.getTracks().every(track=>track.readyState==="ended")'));
  await evaluate('window.aiAudioContext.close()');
  assert.ok(calls.some(c=>c.endpoint==="/ai/query" && c.body?.includes('name="audio"')));
  await screenshot("voice-stock");
  await click("Quotations");
  await wait('!!document.querySelector(".product-result")');
  await evaluate('document.querySelector(".product-result").click()');
  const quotationCartBefore = await evaluate('document.querySelector(".cart-table").innerText');
  await fill('[aria-label="POS category filter"]', "category-two");
  await wait('document.body.innerText.includes("No matching products.")');
  assert.equal(await evaluate('document.querySelector(".cart-table").innerText'), quotationCartBefore);
  await fill('[aria-label="POS category filter"]', "category-one");
  await wait('!!document.querySelector(".product-result")');
  await click("Create quotation");
  await wait('document.body.innerText.includes("Quotation saved")');
  assert.ok(await evaluate('document.querySelector(".receipt").innerText.includes("Created by: Ali")'));
  await assertReceiptShop();
  await click("Make sale");
  await wait('!!document.querySelector("dialog[open]")');
  await click("Close");
  await click("This session (1)");
  await click("Make sale");
  await wait('!!document.querySelector("dialog[open]")');
  await click("Complete sale");
  await wait('!document.querySelector("dialog[open]")');
  await wait('document.body.innerText.includes("INV-2")');
  assert.ok(await evaluate('document.querySelector(".receipt").innerText.includes("Sold by: Ali")'));
  await assertReceiptShop();
  assert.ok(
    !calls.some(
      (c) =>
        c.role === "CASHIER" &&
        (c.endpoint === "/orders/" ||
          c.endpoint === "/orders/stocklogs" ||
          c.endpoint.startsWith("/admin/")),
    ),
  );
  await click("Account");
  await wait('!!document.querySelector("[name=oldPassword]")');
  assert.equal(await evaluate('document.querySelector("[name=shopName]")'), null);
  await fill("[name=username]", "ali updated");
  await fill("[name=email]", "ali.updated@example.test");
  await click("Save account");
  await wait('document.body.innerText.includes("Account updated.")');
  assert.ok(await evaluate('document.body.innerText.includes("ali updated | ali.updated@example.test")'));
  await click("POS");
  await wait('document.querySelector(".cashier-welcome")?.textContent.includes("Ali Updated")');
  await click("Account");
  await fill("[name=username]", "ali");
  await fill("[name=email]", "counter@example.test");
  await click("Save account");
  await wait('document.body.innerText.includes("ali | counter@example.test")');
  await click("Sign out");
  await login("OWNER");
  await wait('!!document.querySelector(".owner-welcome")');
  assert.equal(
    await evaluate('document.querySelector(".owner-welcome p").textContent'),
    "Welcome, Owner",
  );
  assert.equal(
    await evaluate('document.querySelector(".owner-welcome h1").textContent'),
    "Hardware Shop",
  );
  assert.equal(
    await evaluate("document.documentElement.dataset.bsTheme"),
    "light",
  );
  assert.equal(
    await evaluate("getComputedStyle(document.body).backgroundColor"),
    "rgb(247, 250, 249)",
  );
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector(".panel")).backgroundColor',
    ),
    "rgb(255, 255, 255)",
  );
  await screenshot("owner-dashboard-light");
  assert.equal(
    await evaluate('document.querySelector(".header-actions a").textContent'),
    "Account",
  );
  ownerDisplayName = "rana usama fiaz";
  const previousShopName = shops[0].name;
  shops[0].name = "Rana Electric Store";
  await send("Page.reload");
  await wait(
    'document.querySelector(".owner-welcome strong")?.textContent==="Rana Usama Fiaz"',
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".owner-welcome strong").textContent',
    ),
    "Rana Usama Fiaz",
  );
  assert.equal(
    await evaluate('document.querySelector(".owner-welcome h1").textContent'),
    "Rana Electric Store",
  );
  assert.ok(!(await evaluate('document.body.innerText.includes("Your shop")')));
  assert.equal(
    await evaluate(
      'document.querySelector(".sidebar-account,.sidebar-identity")',
    ),
    null,
  );
  assert.equal(
    await evaluate(
      '[...document.querySelectorAll(".sidebar a")].some(e=>e.textContent==="Account")',
    ),
    false,
  );
  const headerBoxes = await evaluate(
    '(()=>{const name=document.querySelector(".owner-welcome p").getBoundingClientRect(), buttons=[...document.querySelectorAll(".header-actions .btn")].map(e=>{const r=e.getBoundingClientRect();return {top:r.top,left:r.left,height:r.height};});return {name:{top:name.top,right:name.right},buttons};})()',
  );
  assert.equal(headerBoxes.buttons[0].top, headerBoxes.buttons[1].top);
  assert.equal(headerBoxes.buttons[0].height, headerBoxes.buttons[1].height);
  assert.ok(headerBoxes.buttons[0].left >= headerBoxes.name.right);
  await screenshot("owner-identity");
  shops[0].name = previousShopName;
  ownerDisplayName = "owner";
  await click("Products");
  await wait('document.body.innerText.includes("Copper Cable")');
  const frozenNow = await evaluate("new Date(2026,9,1,12).getTime()");
  const clockScript = await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "Date.now = () => " + frozenNow,
  });
  for (const [days, expected] of [
    [4, ""],
    [3, "in 3 days"],
    [2, "in 2 days"],
    [1, "tomorrow"],
    [0.05, "today"],
    [-1, ""],
  ]) {
    shops[0].subscriptionExpiry = new Date(
      frozenNow + days * 86400000,
    ).toISOString();

    await send("Page.reload");
    await sleep(300);
    if (days < 0) {
      await wait('document.body.innerText.includes("Renew Subscription")');
      await wait('document.querySelector("section.panel img")?.naturalWidth>0');
      await screenshot("expired-owner-renewal-qr");
      assert.equal(await evaluate('document.querySelector(".sidebar")'), null);
      assert.ok(
        await evaluate('document.body.innerText.includes("PKR 8,000")'),
      );
      await send("Page.bringToFront");
      await send("Emulation.setFocusEmulationEnabled", { enabled: true });
      await send("Browser.grantPermissions", {
        origin: "http://localhost:5173",
        permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
      });
      const blockedCalls = calls.length;
      await click("Copy");
      await wait('document.body.innerText.includes("Copied")');
      assert.equal(
        calls.length,
        blockedCalls,
        "Expired Owner payment view makes no business requests",
      );
      await click("Sign out");
      await wait('!!document.querySelector("[name=identity]")');
      await fill("[name=identity]", "owner");
      await fill("[name=password]", "test-password");
      await click("Sign in");
      await wait('document.body.innerText.includes("Renew Subscription")');
      assert.equal(await evaluate('document.querySelector(".sidebar")'), null);
      continue;
    }
    await wait('document.body.innerText.includes("Copper Cable")');
    if (expected) {
      await wait(
        'document.querySelector(".alert-warning")?.innerText.includes(' +
          JSON.stringify(expected) +
          ")",
      );
      assert.ok(
        await evaluate(
          '[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="Add product"&&!e.disabled)',
        ),
        "Warning must not block owner actions",
      );
    } else
      assert.equal(
        await evaluate('document.querySelector(".alert-warning")'),
        null,
      );
  }
  await send("Page.removeScriptToEvaluateOnNewDocument", {
    identifier: clockScript.identifier,
  });
  shops[0].subscriptionExpiry = new Date(
    Date.now() + 2 * 86400000,
  ).toISOString();
  await send("Page.reload");
  await sleep(300);
  await wait(
    'document.querySelector(".alert-warning")?.innerText.includes("in 2 days")',
  );
  await screenshot("owner-subscription-warning");
  const paymentCallsStart = calls.length,
    expiryBeforePayment = shops[0].subscriptionExpiry;
  await click("Renew Subscription");
  await wait('location.pathname==="/owner/renew"');
  if(process.env.DIGISHOP_CUSTOMER_HISTORY_ONLY!=='1'){
    for (const text of [
      "PKR 8,000",
      "30 Days",
      "Meezan Bank",
      "RANA AHMAD FIAZ",
      "00300111791703",
      "Shop Name",
    ])
      assert.ok(
        await evaluate(
          "document.body.innerText.includes(" + JSON.stringify(text) + ")",
        ),
        'Renewal information: '+text,
      );
  }
  if(process.env.DIGISHOP_CUSTOMER_HISTORY_ONLY!=='1'){
  const paymentLink = new URL(
    await evaluate(
      '[...document.querySelectorAll("a")].find(e=>e.textContent==="Send Payment Proof on WhatsApp").href',
    ),
  );
  assert.equal(paymentLink.pathname, "/923004061677");
  assert.ok(paymentLink.searchParams.get("text").includes("Shop Name:"));
  await send("Browser.grantPermissions", {
    origin: "http://localhost:5173",
    permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
  });
  await send("Page.bringToFront");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await click("Copy");
  await wait('document.body.innerText.includes("Copied")');
  assert.equal(
    await evaluate("navigator.clipboard.readText()"),
    "00300111791703",
  );
  assert.ok(fs.existsSync("public/subscription-payment-qr.jpg"));
  await wait('document.querySelector("section.panel img")?.naturalWidth>0');
  await evaluate(
    '[...document.querySelectorAll("a")].find(e=>e.textContent==="Send Payment Proof on WhatsApp").addEventListener("click", e=>e.preventDefault(), {once:true})',
  );
  await click("Send Payment Proof on WhatsApp");
  assert.equal(shops[0].subscriptionExpiry, expiryBeforePayment);
  assert.equal(
    calls.length,
    paymentCallsStart,
    "Payment view and Copy make no API requests",
  );
  await screenshot("owner-renewal");
  }

  await click("Sign out");
  await login("CASHIER");
  await wait('!!document.querySelector(".product-result")');
  assert.equal(
    await evaluate('document.querySelector(".alert-warning")'),
    null,
    "Cashier POS has no renewal warning",
  );
  await click("Sign out");
  shops[0].subscriptionExpiry = null;
  shops[0].subscriptionActive = false;
  for (const [id, name, days, manual, owner, contact] of [
    ["expired", "Expired Electrical", -1, true, "renewowner", "111222"],
    ["soon", "Soon Hardware", 2, true, "soonowner", "333444"],
    ["healthy", "Healthy Electrical", 18, false, "healthyowner", "555666"],
  ])
    shops.push({
      _id: id,
      name,
      contactNo: contact,
      ownerId: { username: owner, email: owner + "@example.test" },
      isActive: manual,
      subscriptionActive: true,
      subscriptionExpiry: new Date(Date.now() + days * 86400000).toISOString(),
    });
  shops[0].subscriptionExpiry = null;
  shops[0].subscriptionActive = false;
  shops[0].subscriptionExpiry = null;
  shops[0].subscriptionActive = false;
  await login("ADMIN");
  assert.equal(await evaluate('document.querySelector(".accounts-nav")'),null);
  assert.equal(await evaluate('[...document.querySelectorAll(".sidebar a")].some(a=>a.textContent==="Purchases")'),false);
  await wait('document.body.innerText.includes("Hardware Shop")');
  assert.equal(
    await evaluate('document.querySelector(".alert-warning")'),
    null,
    "Admin has no renewal warning",
  );
  await click("Sign out");
  shops[0].subscriptionExpiry = new Date(
    Date.now() + 30 * 86400000,
  ).toISOString();
  await login("OWNER");
  // Owner Accounts contract checks. These responses are isolated browser fixtures,
  // not evidence that live accounting has been enabled.
  await send('Page.navigate',{url:'http://localhost:5173/owner/existing-setup'});
  await wait('document.body.innerText.includes("Status: DISABLED")');
  await fillLabel('Reason','Verified opening records');
  await fillLabel('Type PREPARE ACCOUNTING to confirm','PREPARE ACCOUNTING');
  await click('Start setup');await wait('!!document.querySelector("dialog[open]")');
  await click('Confirm and record');await wait('document.body.innerText.includes("Status: PREPARING")');
  await click('Check setup');await wait('document.body.innerText.includes("Ready for explicit confirmation")');
  await fillLabel('Reason','Confirm reviewed starting point');
  await fillLabel('Type ACTIVATE ACCOUNTING to activate, or PREPARE ACCOUNTING to revise the starting point','ACTIVATE ACCOUNTING');
  await click('Activate accounting');await click('Confirm and record');await wait('document.body.innerText.includes("Status: ACTIVE")');
  assert.equal(accountingActivationRequests.filter(r=>r.endpoint.endsWith('/confirm')).length,1);
  assert.equal(accountingActivationRequests.at(-1).body.previewToken,'activation-preview');
  await fillLabel('Reason','Pause for owner review');await fillLabel('Type PAUSE ACCOUNTING to confirm','PAUSE ACCOUNTING');
  await click('Pause money records');await click('Confirm and record');await wait('document.body.innerText.includes("Status: PAUSED")');
  await click('Check setup');await wait('document.body.innerText.includes("Ready for explicit confirmation")');
  await fillLabel('Reason','Resume after review');await fillLabel('Type ACTIVATE ACCOUNTING to confirm','ACTIVATE ACCOUNTING');
  await click('Resume accounting');await click('Confirm and record');await wait('document.body.innerText.includes("Status: ACTIVE")');
  await send('Page.navigate',{url:'http://localhost:5173/owner/dashboard'});
  await wait('!!document.querySelector(".accounts-nav summary")');
  await evaluate('document.querySelector(".accounts-nav summary").click()');
  await click('Suppliers');
  await wait('document.body.innerText.includes("No suppliers found.")');
  await click('Add supplier');
  await fill('[name=name]','Eagle Cables');await fill('[name=phoneNo]','03009876543');await fill('[name=address]','Main market');
  await click('Save supplier');await wait('!document.querySelector("dialog[open]")');await wait('document.body.innerText.includes("Eagle Cables")');
  assert.deepEqual(JSON.parse(calls.filter(c=>c.endpoint==='/accounts/entities'&&c.method==='POST').at(-1).body).roles,['SUPPLIER']);
  await fill('[aria-label="Search businesses"]','Eagle');await sleep(300);
  await fill('[aria-label="Business list filter"]','');await click('Business details');await click('Business setup & brand links');await wait('document.body.innerText.includes("Brand associations")');
  await fill('[name=brandName]','Eagle');await click('Add brand association');await wait('document.body.innerText.includes("Eagle")&&document.body.innerText.includes("Linked")');
  await click('Unlink');await wait('document.body.innerText.includes("Brand unlinked.")');await click('Link brand');await wait('document.body.innerText.includes("Brand linked.")');
  await click('Close');await click('Customers');await click('Customer accounts');await wait('!![...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Receive Payment")');
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Receive Payment").focus()');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait('document.body.innerText.includes("Balances checked as of")&&document.body.innerText.includes("Invoice created")');
  assert.ok(await evaluate('document.querySelector("dialog[open]").innerText.includes("40.00")'));
  assert.ok(await evaluate('document.querySelector("dialog[open]").innerText.includes("Customer owes us")&&document.querySelector("dialog[open]").innerText.includes("Available store credit")'));
  assert.ok(await evaluate('!!(document.querySelector("dialog[open]").querySelector("a[href*=invoice]")||document.querySelector("dialog[open]").querySelector("a[href*=sales]"))'));
  assert.ok(calls.some(c=>c.endpoint==='/accounts/customers/customer-one/history'&&c.method==='GET'));
  assert.ok(!calls.some(c=>c.endpoint==='/accounts/customers/customer-one/history'&&c.method!=='GET'));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await wait('!document.querySelector("dialog[open]")');
  const restoredFocus=await evaluate('document.activeElement.outerHTML');
  assert.ok(restoredFocus.includes('Receive Payment'),'Escape closes customer details and restores focus to its opener: '+restoredFocus);
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Receive Payment").focus()');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait('document.body.innerText.includes("Balances checked as of")&&document.body.innerText.includes("Invoice created")');
  for(const [width,height] of [[1366,768],[1440,900],[1600,900]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    assert.ok(await evaluate('(()=>{const r=document.querySelector("dialog[open]").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()'),`Customer account dialog fits ${width}x${height}`);
    assert.ok(await evaluate('document.querySelector(".record-register").clientWidth<=document.querySelector(".record-register").parentElement.clientWidth+1'),`Customer history stays contained at ${width}x${height}`);
    assert.ok(await evaluate('(()=>{const t=document.querySelector(".customer-activity-table"),r=t.tBodies[0].rows[0],c=[...r.cells];return t&&c.length===6&&t.tHead.rows[0].cells[5].textContent==="View"&&[c[0],c[2],c[3],c[5]].every(x=>x.scrollWidth<=x.clientWidth+2)&&c[4].getBoundingClientRect().right<=c[5].getBoundingClientRect().left+1})()'),`Customer history financial values and View column stay aligned at ${width}x${height}`);
    assert.ok(await evaluate('document.querySelector(".navigation-drawer nav").scrollWidth<=document.querySelector(".navigation-drawer nav").clientWidth+1'),`Main navigation fits ${width}x${height}`);
  }
  /* eslint-disable no-useless-escape */
  await evaluate('[...document.querySelectorAll(".customer-history-main .record-actions button")].at(-1).focus()');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait('!!document.querySelector(\".customer-record-inspector\")');
  assert.ok(await evaluate('document.querySelector(\".customer-record-inspector\").innerText.includes(\"Invoice created\")&&document.querySelector(\".customer-record-inspector\").innerText.includes(\"INV-1\")'));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await wait('!document.querySelector(\".customer-record-inspector\")');
  await wait('document.activeElement.textContent.trim().includes("View")');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await wait('!document.querySelector(\"dialog[open]\")');
  await evaluate('document.querySelector(\".customer-nav summary\").focus()');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40,nativeVirtualKeyCode:40});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  await wait('document.querySelector(\".customer-nav\").open');
  await evaluate('document.querySelector(\".customer-nav .navigation-overflow a\").focus()');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40,nativeVirtualKeyCode:40});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  await wait('document.activeElement.textContent.includes(\"Customer invoices\")');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40,nativeVirtualKeyCode:40});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  await wait('document.activeElement.textContent.includes(\"Customer activity\")');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait('location.pathname===\"/owner/customers/activity\"&&document.body.innerText.includes(\"Customer activity\")');
  await wait('document.querySelectorAll(\".record-register tbody tr\").length===4');
  for(const [width,height] of [[1366,768],[1440,900],[1600,900]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    assert.ok(await evaluate('(()=>{const t=document.querySelector(\".customer-activity-table\");return t&&[...t.tBodies[0].rows].every(r=>{const c=[...r.cells];return [c[0],c[2],c[3],c[5]].every(x=>x.scrollWidth<=x.clientWidth+2)&&c[4].getBoundingClientRect().right<=c[5].getBoundingClientRect().left+1&&c[4].getBoundingClientRect().height<=48})})()'),`Global customer activity aligns amounts without overlap at ${width}x${height}`);
  }
  assert.ok(await evaluate('!document.querySelector(\".secondary-navigation\")&&document.querySelector(\".customer-nav summary\").getAttribute(\"aria-current\")===\"page\"'));
  await evaluate('(()=>{const s=document.querySelector(\"[aria-label=\\\"Filter customer records by customer\\\"]\");s.value=\"customer-one\";s.dispatchEvent(new Event(\"change\",{bubbles:true}));return true})()');
  for(let attempt=0;attempt<100&&!calls.some(c=>c.endpoint==='/accounts/customers/activity'&&c.query.includes('customerId=customer-one'));attempt++)await sleep(80);
  assert.ok(calls.some(c=>c.endpoint==='/accounts/customers/activity'&&c.query.includes('customerId=customer-one')),'Customer activity filters by the selected customer');
  const firstRow=await evaluate('document.querySelector(\".record-register tbody tr.record-clickable\").getAttribute(\"data-record-id\")');
  await evaluate('document.querySelector(\".record-register tbody tr.record-clickable\").focus()');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40,nativeVirtualKeyCode:40});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  assert.notEqual(await evaluate('document.activeElement.getAttribute(\"data-record-id\")'),firstRow,'ArrowDown moves through customer activity rows');
  await evaluate('(()=>{const s=document.querySelector(\"[aria-label=\\\"Filter customer record type\\\"]\");s.value=\"PAYMENTS\";s.dispatchEvent(new Event(\"change\",{bubbles:true}));return true})()');
  await wait('document.body.innerText.includes(\"Payment received\")');
  await fill('[aria-label=\"Search customer records\"]','INV-1');await sleep(350);
  assert.ok(calls.some(c=>c.endpoint==='/accounts/customers/activity'&&c.query.includes('q=INV-1')),'Customer activity search reaches the authoritative filtered read');
  for(const [type,label] of [['INVOICES','Invoice created'],['RETURNS','Product return'],['REFUNDS','Product return'],['CREDIT','Store credit issued']]){
    await evaluate('(()=>{const s=document.querySelector(\"[aria-label=\\\"Filter customer record type\\\"]\");s.value='+JSON.stringify(type)+';s.dispatchEvent(new Event(\"change\",{bubbles:true}));return true})()');
    await wait('document.body.innerText.includes('+JSON.stringify(label)+')');
    for(let attempt=0;attempt<100&&!calls.some(c=>c.endpoint==='/accounts/customers/activity'&&c.query.includes('service='+type));attempt++)await sleep(80);
    assert.ok(calls.some(c=>c.endpoint==='/accounts/customers/activity'&&c.query.includes('service='+type)),'Customer service filter requests '+type);
    assert.equal(await evaluate('document.querySelectorAll(\".record-register tbody tr.record-clickable\").length'),1,'The selected service shows each authoritative source event once');
  }
  await evaluate('(()=>{const s=document.querySelector(\"[aria-label=\\\"Filter customer record type\\\"]\");s.value=\"PAYMENTS\";s.dispatchEvent(new Event(\"change\",{bubbles:true}));return true})()');
  await wait('document.body.innerText.includes(\"Payment received\")');
  for(let attempt=0;attempt<100&&!calls.some(c=>c.endpoint==='/accounts/customers/activity'&&c.query.includes('service=PAYMENTS'));attempt++)await sleep(80);
  assert.ok(calls.some(c=>c.endpoint==='/accounts/customers/activity'&&c.query.includes('service=PAYMENTS')));
  await evaluate('[...document.querySelectorAll(\".record-actions button.record-view-action\")].at(-1).focus()');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait('!!document.querySelector(\".customer-record-inspector\")');
  assert.ok(await evaluate('document.querySelector(\".customer-record-inspector\").innerText.includes(\"Payment received\")&&document.querySelector(\".customer-record-inspector\").innerText.includes(\"Counter cash\")'));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await wait('!document.querySelector(\".customer-record-inspector\")');
  await wait('document.activeElement.textContent.trim().includes("View")');
  assert.ok(!calls.some(c=>c.endpoint==='/accounts/customers/activity'&&c.method!=='GET'),'Customer activity performs no financial writes');
  await evaluate('document.querySelector(\".customer-nav summary\").focus()');
  for(let index=0;index<2;index++){await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40,nativeVirtualKeyCode:40});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});}
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32,nativeVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await wait('location.pathname===\"/owner/customers/invoices\"&&document.body.innerText.includes(\"Invoice\")');
  await evaluate('history.back()');await wait('location.pathname===\"/owner/customers/activity\"');
  await evaluate('history.forward()');await wait('location.pathname===\"/owner/customers/invoices\"');
  await evaluate('document.querySelector(\".customer-nav summary\").click()');
  assert.ok(await evaluate('document.querySelector(\".customer-nav\").open'));
  await evaluate('document.dispatchEvent(new PointerEvent(\"pointerdown\",{bubbles:true}))');
  assert.ok(await evaluate('!document.querySelector(\".customer-nav\").open'),'Outside pointer closes Customers dropdown');
  /* eslint-enable no-useless-escape */
  if(process.env.DIGISHOP_CUSTOMER_HISTORY_ONLY==='1'){
    await new Promise(resolve=>process.stdout.write('Customer navigation mocked browser passed: Customers dropdown destinations, keyboard navigation, Escape focus restoration, service filters and search, contextual details, browser back/forward, no financial writes, and 1366x768 / 1440x900 / 1600x900 containment.\n',resolve));
    if(socket?.readyState===1)await send('Browser.close');
    chrome.kill();process.exit(0);
  }
  await click('Close');
  await click('Suppliers');await fill('[aria-label="Search businesses"]','');await click('Other business records (Advanced)');await click('Add other business');
  const customerCreatesBefore=calls.filter(c=>c.endpoint==='/customers/create-customer').length;
  await evaluate('[...document.querySelectorAll("dialog label")].find(label=>label.textContent.trim()==="Customer").querySelector("input").click()');
  await wait('[...document.querySelectorAll("dialog button")].some(b=>b.textContent.includes("Ali ·"))');
  await evaluate('[...document.querySelectorAll("dialog button")].find(b=>b.textContent.includes("Ali ·")).click()');
  await click('Save business');await wait('!document.querySelector("dialog[open]")');
  const linkedBusiness=JSON.parse(calls.filter(c=>c.endpoint==='/accounts/entities'&&c.method==='POST').at(-1).body);assert.equal(linkedBusiness.customerId,customer._id);assert.ok(!Object.hasOwn(linkedBusiness,'name'));assert.equal(calls.filter(c=>c.endpoint==='/customers/create-customer').length,customerCreatesBefore);
  // Supplier purchasing and accounting are contract fixtures only; never sent to a database.
  const stockBeforePurchases=product.stockQuantity;
  await click('Purchases');await wait('document.body.innerText.includes("No purchase orders found")');
  await click('Create purchase order');await fillLabel('Find supplier','Eagle');await sleep(300);await click('Eagle Cables');
  await click('Add Copper Cable');await fill('[aria-label="Quantity for Copper Cable"]','5');await fill('[aria-label="Unit cost for Copper Cable"]','10.00');
  await click('Review purchase order');assert.equal(purchaseOrders.length,0);await click('Confirm and record');await wait('document.body.innerText.includes("PO-1") && !document.querySelector("dialog[open]")');
  assert.equal(purchaseOrders[0].items[0].unitCostMinor,1000);assert.equal(product.stockQuantity,stockBeforePurchases);
  await click('View');await wait('document.body.innerText.includes("Confirm order")');purchaseOrders[0].revision++;await click('Confirm order');await click('Confirm and record');await wait('document.body.innerText.includes("Purchase changed")');await click('Refresh current data');await wait('document.body.innerText.includes("Confirm order")');await click('Confirm order');await click('Confirm and record');await wait('document.body.innerText.includes("Receive delivery")');
  await fill('[aria-label="Delivered Copper Cable"]','1');await click('Review delivered quantities');assert.equal(goodsReceipts.length,0);await click('Confirm and record');await wait('document.body.innerText.includes("GR-1")');
  assert.equal(product.stockQuantity,stockBeforePurchases+1);assert.equal(goodsReceipts[0].accountingStatus,'DEFERRED');
  await click('Return goods');await wait('document.body.innerText.includes("Check this old delivery")');assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Review return").matches(":disabled")'),true);await click('Close return details');
  supplierReady=true;financialAccounts[0].cashCutoverId='prepared-cutover';
  await fill('[aria-label="Delivered Copper Cable"]','2');await click('Review delivered quantities');await click('Confirm and record');await wait('document.body.innerText.includes("GR-2")');assert.equal(goodsReceipts.length,2);
  await click('Supplier Khata');await wait('document.body.innerText.includes("Outstanding: PKR 70.00")');
  await fill('#supplier-payment select.form-select','cash-account');await wait('document.body.innerText.includes("Available in Counter cash")');await fillLabel('Payment amount (PKR)','999');await fillLabel('Payment note','Actual supplier payment');
  await click('Review supplier payment');await wait('document.body.innerText.includes("no greater than the outstanding payable")');assert.equal(supplierSettlements.length,0);
  supplierCashMinor=1;await fillLabel('Payment amount (PKR)','10');await click('Review supplier payment');await click('Confirm payment sent');await wait('document.body.innerText.includes("Insufficient cash or bank funds")');assert.equal(supplierSettlements.length,0);supplierCashMinor=125000;
  await click('Refresh current data');await wait('document.body.innerText.includes("Outstanding: PKR 70.00")');await fill('#supplier-payment select.form-select','cash-account');await wait('document.body.innerText.includes("Available in Counter cash")');await fillLabel('Payment note','Actual supplier payment');
  await fillLabel('Payment amount (PKR)','10');await click('Review supplier payment');loseSupplierResponse=true;await click('Confirm payment sent');await wait('document.body.innerText.includes("result is uncertain")');assert.equal(supplierSettlements.length,1);
  const paymentBeforeRetry=calls.filter(c=>c.endpoint.endsWith('/payments')).at(-1).body;
  supplierReady=false;await click('Retry same request');await wait('document.querySelector("dialog").innerText.includes("authoritative payable unavailable")');assert.equal(supplierSettlements.length,1);assert.equal(calls.filter(c=>c.endpoint.endsWith('/payments')).at(-1).body,paymentBeforeRetry);supplierReady=true;
  await evaluate('[...document.querySelectorAll("dialog button")].find(b=>b.textContent==="Retry same request").click();[...document.querySelectorAll("dialog button")].find(b=>b.textContent.includes("request"))?.click()');
  await wait('document.body.innerText.includes("Outstanding: PKR 60.00")');assert.equal(supplierSettlements.length,1);assert.equal(calls.filter(c=>c.endpoint.endsWith('/payments')).at(-1).body,paymentBeforeRetry);
  await click('Open purchase');await wait(`(()=>{const row=[...document.querySelectorAll('[aria-label="Purchase activity register"] tbody tr')].find(r=>r.innerText.includes('GR-2'));const button=row&&[...row.querySelectorAll('button')].find(b=>b.textContent==='Return goods');if(!button)return false;button.click();return true;})()`);await wait('document.body.innerText.includes("Already returned")');
  await fillLabel('Return Copper Cable','1');await fillLabel('Return reason','Supplier accepted returned goods');await click('Review return');assert.equal(supplierSettlements.length,1);
  const cashBeforeReturn=supplierCashMinor;await click('Confirm and record');await wait('!document.querySelector("dialog[open]") && !document.querySelector("section[aria-label]")');assert.equal(supplierSettlements.length,2);assert.equal(supplierCashMinor,cashBeforeReturn);assert.equal(supplierPayableMinor,5000);
  await wait(`(()=>{const row=[...document.querySelectorAll('[aria-label="Purchase activity register"] tbody tr')].find(r=>r.innerText.includes('GR-2'));const button=row&&[...row.querySelectorAll('button')].find(b=>b.textContent==='Return goods');if(!button)return false;button.click();return true;})()`);await wait(`!!document.querySelector('section[aria-label="Purchase return"] tbody tr')`);assert.equal(await evaluate('document.querySelector("section[aria-label] tbody").innerText.includes("1")'),true);await click('Close return details');
  const stockBeforeCancel=product.stockQuantity;await fillLabel('Reason for cancelling remaining order','Cancel only undelivered quantities');await wait(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Cancel remaining order'&&!b.disabled);if(!button)return false;button.click();return true;})()`);await click('Confirm and record');await wait('document.body.innerText.includes("Cancelled") && !document.body.innerText.includes("Receive delivery")');assert.equal(purchaseOrders[0].status,'CANCELLED');assert.equal(product.stockQuantity,stockBeforeCancel);assert.equal(goodsReceipts.length,2);
  await click('Transactions');await wait('document.body.innerText.includes("SP-1")');await click('View transaction');await wait('document.querySelector("dialog").innerText.includes("Money out PKR 10.00")');await click('Close');
  await evaluate('document.querySelector(".accounts-nav summary").parentElement.open=true');
  product.stockQuantity=stockBeforePurchases;supplierReady=false;delete financialAccounts[0].cashCutoverId;
  await click('Cash & Bank');await wait('document.body.innerText.includes("Counter cash")');
  assert.ok(!(await evaluate('document.body.innerText.includes("PKR 0.00")')));
  await click('View balance');await wait('document.body.innerText.includes("Balance unavailable")');
  await evaluate('[...document.querySelectorAll("main a")].find(a=>a.textContent==="Transactions").click()');await wait('document.body.innerText.includes("History unavailable")');await click('Cash & Bank');
  await click('Add account');await fill('[name=name]','Bank account');await fill('[name=code]','BANK_1');await click('Create account');await wait('document.querySelector("dialog").innerText.includes("Accounting is disabled")');await click('Close');
  allowAccountBalance=true;await click('Suppliers');await click('Cash & Bank');await click('View balance');await wait('document.body.innerText.includes("1,250.00")');
  await evaluate('[...document.querySelectorAll("main a")].find(a=>a.textContent==="Transactions").click()');
  await wait('document.body.innerText.includes("Original Seller")');await click('Next');await wait('document.body.innerText.includes("Page 2 of 2")');
  await fillLabel('Search transactions','INV-1');await wait('document.body.innerText.includes("Unavailable for this search")');
  await fillLabel('From (UTC)','2026-01-01');await fillLabel('Before (UTC)','2026-01-02');await sleep(300);
  assert.ok(calls.some(c=>c.endpoint.endsWith('/history')&&c.query.includes('from=2026-01-01T00')&&c.query.includes('to=2026-01-02T00')&&c.query.includes('q=INV-1')));
  denyAccounts=true;await click('Suppliers');await wait('document.body.innerText.includes("Owner shop access required")');denyAccounts=false;allowAccountBalance=false;
  await click("Products");
  await wait('document.body.innerText.includes("Copper Cable")');
  assert.ok(await evaluate('document.body.innerText.includes("Cost")'));
  await screenshot("owner-products");
  await click("Categories");
  await fill('[aria-label="New category name"]', "Switches");
  await click("Add category");
  await wait('document.body.innerText.includes("Category added.")');
  await fill('[aria-label="Category filter"]', "category-one");
  await sleep(350);
  assert.ok(
    calls.some(
      (c) => c.role === "OWNER" && c.query.includes("category=category-one"),
    ),
  );
  await click("Add product");
  await wait('!!document.querySelector("dialog[open]")');
  await fill("dialog [name=name]", "Switch");
  await fill("dialog [name=brand]", "Local");
  await fill("dialog [name=category]", "category-one");
  await click("Save product");
  await wait('!document.querySelector("dialog[open]")');
  assert.ok(calls.some((c) => c.endpoint === "/products/create-product"));
  await click("Edit");
  await wait('!!document.querySelector("dialog[open]")');
  assert.equal(await evaluate('document.querySelector("dialog [name=name]").value'), product.name);
  assert.equal(await evaluate('document.querySelector("dialog [name=brand]").value'), product.brand);
  assert.equal(await evaluate('document.querySelector("dialog [name=category]").value'), product.category._id);
  assert.equal(await evaluate('document.querySelector("dialog [name=unit]").value'), product.unit);
  assert.equal(await evaluate('document.querySelector("dialog [name=description]").value'), product.description || "");
  assert.equal(await evaluate('document.querySelector("dialog [name=stockQuantity]")'), null);
  const originalDetails = { name: product.name, brand: product.brand, unit: product.unit };
  await fill("dialog [name=name]", "Corrected Cable");
  await fill("dialog [name=brand]", "Corrected Brand");
  await fill("dialog [name=unit]", "box");
  await fill("dialog [name=description]", "Electrical cable specification");
  await fill("[name=retailPrice]", "55");
  await click("Save product");
  await wait('!document.querySelector("dialog[open]")');
  assert.equal(product.retailPrice, 55);
  assert.equal(product.name, "Corrected Cable");
  assert.equal(product.brand, "Corrected Brand");
  assert.equal(product.unit, "box");
  assert.equal(product.description, "Electrical cable specification");
  await wait('document.querySelector("tbody")?.textContent.includes("Corrected Brand")');
  await click("Edit");
  await wait('!!document.querySelector("dialog[open]")');
  assert.equal(await evaluate('document.querySelector("dialog [name=description]").value'), product.description);
  await fill("dialog [name=description]", "");
  // Restore test labels used by the existing inventory/receipt checks.
  await fill("dialog [name=name]", originalDetails.name);
  await fill("dialog [name=brand]", originalDetails.brand);
  await fill("dialog [name=unit]", originalDetails.unit);
  await click("Save product");
  await wait('!document.querySelector("dialog[open]")');
  assert.equal(product.description, "");
  await click("Stock");
  await wait('document.body.innerText.includes("Copper Cable")');
  await click("Change stock");
  await fill("[name=quantityDelta]", "5");
  await fill("[name=reason]", "Delivery");
  await click("Save stock change");
  await wait('!document.querySelector("dialog[open]")');
  assert.equal(product.stockQuantity, 25);
  await click("Change stock");
  await fill("[name=quantityDelta]", "-22");
  await fill("[name=reason]", "Damaged goods");
  await click("Save stock change");
  await wait('!document.querySelector("dialog[open]")');
  await wait('document.body.innerText.includes("Low stock")');
  await evaluate('document.querySelector("input[type=checkbox]").click()');
  await wait('document.body.innerText.includes("Copper Cable")');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Stock category filter"]').value`), "");
  const beforeStockCategoryCalls = calls.filter(c=>c.endpoint === "/products/search-product").length;
  await fill('[aria-label="Search stock"]', "Copper");
  await fill('[aria-label="Stock category filter"]', "category-two");
  await wait('document.body.innerText.includes("No matching stock.")');
  await click("Stock history");
  await wait('!!document.querySelector("[name=productId]")');
  assert.ok(await evaluate('document.querySelector("[name=productId]").textContent.includes("Copper Cable")'), "Stock history retains the complete product list");
  await click("Stock levels");
  await fill('[aria-label="Stock category filter"]', "category-one");
  await wait('!!document.querySelector("tbody")');
  assert.ok(await evaluate('document.querySelector("tbody").textContent.includes("Copper Cable")'));
  assert.equal(await evaluate('document.querySelector("input[type=checkbox]").checked'), true);
  await fill('[aria-label="Search stock"]', "No matching name");
  await wait('document.body.innerText.includes("No matching stock.")');
  await fill('[aria-label="Search stock"]', "");
  await fill('[aria-label="Stock category filter"]', "");
  await wait('!!document.querySelector("tbody")');
  assert.equal(calls.filter(c=>c.endpoint === "/products/search-product").length, beforeStockCategoryCalls, "Stock filters use already loaded products");
  await screenshot("owner-stock");
  await click("Sales");
  await wait(`!!document.querySelector('[aria-label="POS category filter"]')`);
  await fill('[aria-label="Search products by name or brand"]', "Cable");
  await fill('[aria-label="POS category filter"]', "category-two");
  await sleep(350);
  await wait('document.body.innerText.includes("No matching products.")');
  await fill('[aria-label="POS category filter"]', "category-one");
  await wait('!!document.querySelector(".product-result")');
  assert.ok(calls.some(c => c.role === "OWNER" && c.endpoint === "/products/search-product" && c.query.includes("category=category-one")));
  await click("Invoice history");
  await wait('document.body.innerText.includes("INV-2")');
  await fill('[aria-label="Search invoice number"]', "INV-2");
  await sleep(350);
  assert.ok(
    calls.some(
      (c) =>
        c.role === "OWNER" &&
        c.endpoint === "/orders/" &&
        c.query.includes("search=INV-2"),
    ),
  );
  await click("INV-2");
  await wait('!!document.querySelector(".receipt")');
  await send("Page.reload");
  await sleep(300);
  await wait('!!document.querySelector(".receipt")');
  assert.ok(await evaluate('location.pathname.includes("invoice-two")'));
  assert.ok(await evaluate('document.querySelector(".receipt").innerText.includes("Sold by: Ali")'));
  await assertReceiptShop();
  // OWNER returns/exchanges use server plans, never browser accounting. These
  // isolated contract fixtures do not mutate any real shop records.
  const snapshot = (items, total, settled, due) => ({ items, subtotalMinor: total * 100, discountMinor: 0, totalMinor: total * 100, settledMinor: settled * 100, dueMinor: due * 100 });
  const line = { productId: product._id, lineId: "historical-line", name: "Copper Cable", brand: "Local Wire", unit: "meter", quantity: 2, unitPrice: 50 };
  const originalDate = invoice.createdAt;
  Object.assign(invoice, { items: [line], totalPrice: 100, subtotal: 100, discountAmount: 0, discountType: "NONE", discountValue: 0, paidAmount: 70, amountDue: 30, customerId: customer._id, revision: 0, status: "PENDING", originalSnapshot: { items: [line], totalPrice: 100, subtotal: 100, paidAmount: 70, amountDue: 30, discountAmount: 0 } });
  const makePreview = (before, proposed, movements, settlement, requirements = {}) => ({ revision: invoice.revision || 0, before, proposed, movements, settlement, requirements: { refundMinor: 0, creditRestoreMinor: 0, cashRefundMaximumMinor: 0, ...requirements }, canSubmit: true, confirmationToken: "a".repeat(64), validationMessage: null });
  await send("Page.reload"); await sleep(200);
  await click("Return / change invoice");
  await fill('[aria-label="Return quantity for Copper Cable"]', "1");
  await fillLabel("Reason", "Partial return");
  financialPreview = { ...makePreview(snapshot([line], 100, 70, 30), snapshot([{ ...line, quantity: 1 }], 50, 50, 0), [{ kind: "RETURN", productId: product._id, lineId: line.lineId, quantity: 1, unitPriceMinor: 5000, stockDelta: 1, disposition: "RESTOCK" }], null, { refundMinor: 2000, cashRefundMaximumMinor: 2000 }), canSubmit: false, confirmationToken: null, validationMessage: "Refund allocation must exactly match refundable cash-funded amount" };
  await click("Preview changes");
  await wait('document.body.innerText.includes("Refund allocation must exactly match")');
  assert.equal(await evaluate('[...document.querySelectorAll("button")].some(b => b.textContent === "Confirm adjustment")'), false);
  await fillLabel("Money to refund", "10"); await fillLabel("Give customer store credit", "10");
  financialPreview = { ...financialPreview, canSubmit: true, confirmationToken: "a".repeat(64), validationMessage: null, settlement: { cashRefundMinor: 1000, creditIssuedMinor: 1000, cashReceivedMinor: 0, creditRedeemedMinor: 0, creditRestoredMinor: 0, debtDeltaMinor: -3000 } };
  await click("Preview changes");
  await wait(`!!document.querySelector('[aria-label="Server preview"] input[type=checkbox]')`);
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b => b.textContent === "Confirm adjustment").disabled'), true);
  await evaluate(`document.querySelector('[aria-label="Server preview"] input[type=checkbox]').click()`);
  const beforeAdjustmentCount = financialEvents.length;
  failFinancialResponse = true;
  await evaluate('[...document.querySelectorAll("button")].find(b => b.textContent === "Confirm adjustment").click(); [...document.querySelectorAll("button")].find(b => b.textContent === "Confirm adjustment")?.click()');
  await wait('document.body.innerText.includes("Check whether saved")');
  assert.equal(financialEvents.length, beforeAdjustmentCount + 1);
  await send("Page.reload"); await sleep(250);
  await click("Check whether saved");
  await wait('document.body.innerText.includes("Current invoice · Revision 1")');
  assert.equal(invoice.createdAt, originalDate);
  assert.equal(invoice.createdByName, "ali");
  await click("Original invoice");
  await wait('document.querySelector(".receipt")?.innerText.includes("100.00")');
  assert.ok(await evaluate('document.querySelector(".receipt").innerText.includes("100.00")'));
  await click("Current invoice · Revision 1");
  await click("Open printable record");
  await wait('document.querySelector(".receipt")?.innerText.includes("Cash refunded")');
  assert.ok(await evaluate('document.querySelector(".receipt").innerText.includes("Cash refunded")'));
  assert.ok(await evaluate('document.querySelector(".receipt").innerText.includes("Sold by: Ali")'));
  await send("Emulation.setEmulatedMedia", { media: "print" });
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".receipt")).visibility'), "visible");
  const adjustmentPdf = await send("Page.printToPDF", { printBackground: false });
  assert.ok(Buffer.from(adjustmentPdf.data, "base64").length > 1500);
  await send("Emulation.setEmulatedMedia", { media: "screen" });
  await click("Current invoice · Revision 1");
  // Damaged same-product exchange: the supplied unit uses the server's current
  // price, while the returned unit retains its historic price.
  await click("Return / change invoice");
  await fill('[aria-label="Return quantity for Copper Cable"]', "1");
  await fill('[aria-label="Return condition for Copper Cable"]', "DAMAGED");
  await wait(`!!document.querySelector('[aria-label="Return / change invoice"] .product-result')`);
  await evaluate(`document.querySelector('[aria-label="Return / change invoice"] .product-result').click()`);
  await fillLabel("Reason", "Exchange damaged cable");
  const supplied = { ...line, lineId: "new-unit", quantity: 1, unitPrice: 60 };
  financialPreview = makePreview(snapshot([{ ...line, quantity: 1 }], 50, 50, 0), snapshot([supplied], 60, 50, 10), [{ kind: "RETURN", lineId: line.lineId, productId: product._id, quantity: 1, unitPriceMinor: 5000, stockDelta: 0, disposition: "DAMAGED" }, { kind: "ADD", lineId: "new-unit", productId: product._id, quantity: 1, unitPriceMinor: 6000, stockDelta: -1 }], { cashRefundMinor: 0, cashReceivedMinor: 0, creditIssuedMinor: 0, creditRedeemedMinor: 0, debtDeltaMinor: 1000 });
  staleFinancialPreview = true;
  await click("Preview changes");
  await wait('document.body.innerText.includes("Invoice changed; reload before preview")');
  await click("Close");
  await click("Return / change invoice");
  await fill('[aria-label="Return quantity for Copper Cable"]', "1");
  await fill('[aria-label="Return condition for Copper Cable"]', "DAMAGED");
  await wait(`!!document.querySelector('[aria-label="Return / change invoice"] .product-result')`);
  await evaluate(`document.querySelector('[aria-label="Return / change invoice"] .product-result').click()`);
  await fillLabel("Reason", "Exchange damaged cable");
  await click("Preview changes");
  await wait('document.body.innerText.includes("Damaged, no sellable stock increase")');
  await click("Confirm adjustment");
  await wait('document.body.innerText.includes("Current invoice · Revision 2")');
  const exchangeCall = calls.filter(c => c.endpoint.endsWith("/adjustments") && c.method === "POST").at(-1);
  assert.equal(JSON.parse(exchangeCall.body).returns[0].disposition, "DAMAGED");
  assert.deepEqual(JSON.parse(exchangeCall.body).additions, [{ productId: product._id, quantity: 1 }]);
  await click("Receive payment");
  await fillLabel("Reason", "Settle exchange balance");
  await fillLabel("Money received now", "5"); await fillLabel("Use customer store credit", "5");
  financialPreview = makePreview(snapshot([supplied], 60, 50, 10), snapshot([supplied], 60, 60, 0), [], { cashReceivedMinor: 500, creditRedeemedMinor: 500, cashRefundMinor: 0, debtDeltaMinor: -1000 });
  const validPaymentPreview = financialPreview;
  financialPreview = { ...financialPreview, settlement: null, confirmationToken: null, canSubmit: false, validationMessage: "Insufficient store credit" };
  await click("Preview changes");
  await wait('document.body.innerText.includes("Insufficient store credit")');
  assert.equal(await evaluate('[...document.querySelectorAll("button")].some(b => b.textContent === "Confirm payment")'), false);
  financialPreview = validPaymentPreview;
  await click("Preview changes");
  await wait(`!!document.querySelector('[aria-label="Server preview"] input[type=checkbox]')`);
  await evaluate(`document.querySelector('[aria-label="Server preview"] input[type=checkbox]').click()`);
  incompleteFinancialResponse = true;
  await click("Confirm payment");
  await wait('document.body.innerText.includes("operation response is incomplete")');
  await click("Check whether saved");
  await wait('document.body.innerText.includes("Current invoice · Revision 3")');
  // Full return restores credit-funded amounts automatically before allocating
  // the remaining refund to cash and new credit.
  await click("Return / change invoice"); await click("Return all remaining units");
  await fillLabel("Reason", "Full return");
  await fillLabel("Money to refund", "35"); await fillLabel("Give customer store credit", "20");
  financialPreview = makePreview(snapshot([supplied], 60, 60, 0), snapshot([], 0, 0, 0), [{ kind: "RETURN", lineId: supplied.lineId, productId: product._id, quantity: 1, unitPriceMinor: 6000, stockDelta: 1, disposition: "RESTOCK" }], { cashRefundMinor: 3500, creditIssuedMinor: 2000, creditRestoredMinor: 500, cashReceivedMinor: 0 }, { refundMinor: 6000, creditRestoreMinor: 500, cashRefundMaximumMinor: 5500 });
  await click("Preview changes");
  await wait(`!!document.querySelector('[aria-label="Server preview"] input[type=checkbox]')`);
  await evaluate(`document.querySelector('[aria-label="Server preview"] input[type=checkbox]').click()`);
  await click("Confirm adjustment");
  await wait('document.body.innerText.includes("Current invoice · Revision 4")');
  assert.equal(invoice.items.length, 0);
  // Anonymous credit recipients are sent separately, never by rewriting the
  // original invoice's customer. Pagination is exercised with recorded events.
  Object.assign(invoice, { items: [{ ...line, quantity: 1 }], totalPrice: 50, subtotal: 50, paidAmount: 50, amountDue: 0, customerId: undefined, revision: 0 });
  await send("Page.reload"); await sleep(200);
  await click("Return / change invoice"); await click("Return all remaining units");
  await fillLabel("Reason", "Anonymous credit refund"); await fillLabel("Give customer store credit", "50");
  await wait('!!document.querySelector(".customer-result")');
  await evaluate('document.querySelector(".customer-result").click()');
  financialPreview = makePreview(snapshot([{ ...line, quantity: 1 }], 50, 50, 0), snapshot([], 0, 0, 0), [], { creditIssuedMinor: 5000, cashRefundMinor: 0, cashReceivedMinor: 0 }, { refundMinor: 5000, cashRefundMaximumMinor: 5000 });
  await click("Preview changes"); await click("Confirm adjustment");
  await wait('document.body.innerText.includes("Current invoice · Revision 1")');
  const anonymousCall = JSON.parse(calls.filter(c => c.endpoint.endsWith("/adjustments") && c.method === "POST").at(-1).body);
  assert.equal(anonymousCall.creditRecipientId, customer._id);
  assert.equal(Object.hasOwn(anonymousCall, "customerId"), false);
  assert.equal(invoice.customerId, undefined);
  const historyCount = financialEvents.length;
  while (financialEvents.filter(e => e.orderId === invoice._id).length < 11) financialEvents.push({ ...financialEvents[0], _id: `older-event-${financialEvents.length}`, reason: "Earlier recorded payment", kind: "PAYMENT" });
  await send("Page.reload"); await sleep(200);
  await click("Next");
  await wait('document.body.innerText.includes("Page 2 of 2")');
  assert.ok(calls.some(c => c.endpoint.endsWith("/history") && c.query.includes("page=2")));
  financialEvents.splice(historyCount);
  // Restore a pending fully paid invoice for the pre-existing cancellation regression.
  financialPreview = null;
  Object.assign(invoice, { items: [{ ...line, quantity: 1 }], totalPrice: 50, subtotal: 50, paidAmount: 50, amountDue: 0, customerId: undefined, revision: 0, status: "PENDING" });
  await send("Page.reload"); await sleep(200);
  await click("Cancel invoice");
  await fillLabel("Reason", "Customer cancelled order");
  await fillLabel("Money to refund", String(invoice.paidAmount));
  await click("Preview changes");
  await wait(`!!document.querySelector('[aria-label="Server preview"]')`);
  if (invoice.paidAmount > 0) await evaluate(`document.querySelector('[aria-label="Server preview"] input[type=checkbox]').click()`);
  await click("Confirm cancellation");
  await wait('document.body.innerText.includes("Status: cancelled")');
  assert.equal(invoice.status, "CANCELLED");
  await click("Back to sales");
  await wait(
    `!!document.querySelector('[aria-label="Search invoice number"]')`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[aria-label="Search invoice number"]').value`,
    ),
    "INV-2",
  );
  invoice.status = "PENDING";
  await click("INV-2");
  await wait('document.body.innerText.includes("Status: pending")');
  await click("Mark delivered");
  await wait('document.body.innerText.includes("Status: delivered")');
  assert.ok(
    !(await evaluate(
      '[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="Cancel invoice")',
    )),
  );
  await click("Back to sales");
  await click("Cashiers");
  await fill("[name=username]", "newcounter");
  await fill("[name=email]", "newcounter@example.test");
  await fill("[name=password]", "new-password");
  assert.ok(await evaluate('document.body.innerText.includes("Profile picture (Optional)")'));
  assert.equal(await evaluate('document.querySelector("input[name=avatar]").required'), false);
  await click("Create cashier account");
  await wait('document.body.innerText.includes("Cashier account created")');
  await wait('document.querySelector("tbody")?.textContent.includes("newcounter@example.test")');
  assert.ok(await evaluate('document.body.innerText.includes("Your Cashiers")'));
  await click("Edit");
  await wait('!!document.querySelector("dialog[open]")');
  assert.equal(await evaluate('document.querySelector("dialog [name=username]").value'), "newcounter");
  await fill("dialog [name=username]", "updatedcounter");
  await fill("dialog [name=email]", "updatedcounter@example.test");
  await click("Save cashier");
  await wait('!document.querySelector("dialog[open]") && document.querySelector("tbody")?.textContent.includes("updatedcounter@example.test")');
  await click("Reset password");
  await wait('!!document.querySelector("dialog [name=newPassword]")');
  assert.equal(await evaluate('document.querySelector("dialog [name=newPassword]").value'), "");
  await fill("dialog [name=newPassword]", "reset-password");
  await click("Set new password");
  await wait('document.body.innerText.includes("Cashier password reset.")');
  await evaluate("window.confirm = () => false");
  const beforeCashierDeletion = calls.filter(c => c.method === "DELETE" && c.endpoint.startsWith("/users/cashiers/")).length;
  await click("Delete");
  assert.equal(calls.filter(c => c.method === "DELETE" && c.endpoint.startsWith("/users/cashiers/")).length, beforeCashierDeletion);
  await evaluate("window.confirm = text => { window.cashierConfirmation = text; return true; }");
  nextFailure = "/users/cashiers/cashier-one";
  await click("Delete");
  await wait('!!document.querySelector(".alert-danger")');
  assert.equal(cashiers.length, 1);
  await click("Delete");
  await wait('document.body.innerText.includes("No cashier accounts yet.")');
  assert.equal(cashiers.length, 0);
  assert.ok(await evaluate('window.cashierConfirmation.includes("updatedcounter") && window.cashierConfirmation.includes("Historical sales")'));
  await fill("[name=username]", "picturecounter");
  await fill("[name=email]", "picturecounter@example.test");
  await fill("[name=password]", "new-password");
  await evaluate(
    '(()=>{const input=document.querySelector("input[type=file]");const dt=new DataTransfer();dt.items.add(new File(["image"],"avatar.png",{type:"image/png"}));input.files=dt.files;input.dispatchEvent(new Event("change",{bubbles:true}));})()',
  );
  await click("Create cashier account");
  await wait('document.querySelector("tbody")?.textContent.includes("newcounter@example.test")');
  assert.ok(calls.some(c => c.endpoint === "/users/register-staff" && c.body?.includes('filename="avatar.png"')));
  await click("Stock");
  await click("Stock history");
  await wait('document.body.innerText.includes("Damaged goods")');
  await fill("[name=productId]", "product-one");
  await fill("[name=startDate]", "2026-10-02");
  await fill("[name=endDate]", "2026-10-01");
  await click("Filter");
  await wait(
    'document.body.innerText.includes("end date must be on or after")',
  );
  await fill("[name=startDate]", "2000-01-01");
  await fill("[name=endDate]", "2100-01-01");
  await click("Filter");
  await wait('document.body.innerText.includes("Damaged goods")');
  await click("Next");
  await wait('document.body.innerText.includes("Page 2 of 2")');
  assert.ok(
    calls.some(
      (c) =>
        c.endpoint === "/orders/stocklogs" &&
        c.query.includes("productId=product-one") &&
        c.query.includes("startDate=") &&
        c.query.includes("page=2"),
    ),
  );
  await screenshot("stock-history");
  await click("Customers");
  await wait('document.body.innerText.includes("Customer owes us") && document.body.innerText.includes("Store credit")');
  await click("AI Assistant");
  await wait('document.body.innerText.includes("Speak")');
  await fill('[aria-label="Ask about your shop"]', "How many bulbs?");
  await click("Send");
  await wait('document.body.innerText.includes("Copper Cable has 20 meters")');
  await click("Quotations");
  await wait('document.body.innerText.includes("New quotation")');
  await click("Account");
  const shopBeforeAccount = { ...shops[0] };
  await fill("[name=username]", "updated owner");
  await fill("[name=email]", "updated.owner@example.test");
  await click("Save account");
  await wait('document.body.innerText.includes("updated owner | updated.owner@example.test")');
  await fill("[name=shopName]", "Updated Electrical Store");
  await fill("[name=address]", "Updated Market");
  await fill("[name=contactNo]", "03009999999");
  await click("Save shop details");
  await wait('document.body.innerText.includes("Shop details updated.")');
  await click("Dashboard");
  await wait('document.querySelector(".owner-welcome h1")?.textContent==="Updated Electrical Store"');
  await click("Account");
  assert.equal(await evaluate('document.querySelector("[name=address]").value'), "Updated Market");
  assert.equal(await evaluate('document.querySelector("[name=contactNo]").value'), "03009999999");
  await fill("[name=shopName]", shopBeforeAccount.name);
  await fill("[name=address]", shopBeforeAccount.address);
  await fill("[name=contactNo]", shopBeforeAccount.contactNo);
  await click("Save shop details");
  await wait('document.body.innerText.includes("Shop details updated.")');
  await fill("[name=username]", "owner");
  await fill("[name=email]", "counter@example.test");
  await click("Save account");
  await wait('document.body.innerText.includes("owner | counter@example.test")');
  await fill("[name=oldPassword]", "test-password");
  await fill("[name=newPassword]", "changed-password");
  await fill("[name=confirm]", "changed-password");
  await click("Change password");
  await wait('document.body.innerText.includes("Password changed.")');
  await click("Sign out");
  shops[0].subscriptionExpiry = null;
  shops[0].subscriptionActive = false;
  await login("ADMIN");
  await wait('document.body.innerText.includes("Hardware Shop")');
  assert.deepEqual(
    await evaluate(
      '[...document.querySelectorAll(".sidebar nav a")].map(e=>e.textContent)',
    ),
    ["Shops"],
  );
  assert.deepEqual(
    await evaluate(
      '[...document.querySelectorAll("thead th")].map(e=>e.textContent)',
    ),
    [
      "Shop",
      "Owner",
      "Contact",
      "Manual Access",
      "Subscription",
      "Expiry",
      "Time Left",
      "Actions",
    ],
  );
  assert.deepEqual(
    await evaluate(
      '[...document.querySelectorAll("tbody tr td:first-child strong")].map(e=>e.textContent)',
    ),
    [
      "Expired Electrical",
      "Hardware Shop",
      "Soon Hardware",
      "Healthy Electrical",
    ],
  );
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll("tbody tr")].find(e=>e.textContent.includes("Healthy Electrical")).textContent.includes("18 days")',
    ),
  );
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll("tbody tr")].find(e=>e.textContent.includes("Healthy Electrical")).textContent.includes("Deactivated")',
    ),
  );
  for (const [term, expected] of [
    ["333444", "Soon Hardware"],
    ["healthyowner@example.test", "Healthy Electrical"],
    ["hardware shop", "Hardware Shop"],
  ]) {
    await fill('[aria-label="Search shops"]', term);
    await wait('document.querySelectorAll("tbody tr").length===1');
    assert.equal(
      await evaluate(
        'document.querySelector("tbody tr td strong").textContent',
      ),
      expected,
    );
  }
  await evaluate("window.confirm=()=>true");
  await fill('[aria-label="Search shops"]', "Expired Electrical");
  await wait('document.body.innerText.includes("Renew 30 Days")');
  const renewalStart = Date.now();
  await click("Renew 30 Days");
  await wait('document.body.innerText.includes("renewed for 30 days")');
  const renewed = shops.find((shop) => shop._id === "expired");
  assert.ok(
    new Date(renewed.subscriptionExpiry).getTime() >= renewalStart + 2592000000,
  );
  assert.ok(
    new Date(renewed.subscriptionExpiry).getTime() <= Date.now() + 2592000000,
  );
  assert.equal(renewed.isActive, true);
  assert.ok(
    await evaluate(
      'document.body.innerText.includes("renewowner@example.test")',
    ),
  );
  await fill('[aria-label="Search shops"]', "Hardware Shop");
  await wait('document.body.innerText.includes("Activate 30 Days")');
  await click("Activate 30 Days");
  await wait('document.body.innerText.includes("activated for 30 days")');
  assert.ok(
    await evaluate('document.body.innerText.includes("owner@example.test")'),
  );
  const expiryBeforeExtend = new Date(shops[0].subscriptionExpiry).getTime();
  await click("Extend 30 Days");
  await wait('document.body.innerText.includes("extended by 30 days")');
  assert.equal(
    new Date(shops[0].subscriptionExpiry).getTime(),
    expiryBeforeExtend + 2592000000,
  );
  const expiryBeforeManual = shops[0].subscriptionExpiry;
  await evaluate("window.confirm = () => false");
  await click("Deactivate");
  assert.notEqual(
    shops[0].isActive,
    false,
    "Cancelled confirmation keeps access active",
  );
  await evaluate("window.confirm = () => true");
  await click("Deactivate");
  await wait('document.body.innerText.includes("Reactivate")');
  assert.equal(shops[0].isActive, false);
  assert.equal(shops[0].subscriptionExpiry, expiryBeforeManual);
  assert.ok(
    !(await evaluate(
      '[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="Deactivate")',
    )),
  );
  await screenshot("admin-shop-deactivated");
  await click("Extend 30 Days");
  await wait(
    '!![...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="Reactivate"&&!e.disabled)',
  );
  assert.equal(shops[0].isActive, false);
  const expiryBeforeReactivate = shops[0].subscriptionExpiry;
  await click("Reactivate");
  await wait('document.body.innerText.includes("Deactivate")');
  assert.equal(shops[0].isActive, true);
  assert.equal(shops[0].subscriptionExpiry, expiryBeforeReactivate);
  await fill('[aria-label="Search shops"]', "");
  await wait('document.querySelectorAll("tbody tr").length===4');
  await screenshot("admin-shops");
  // Use a disposable isolated shop; later subscription/role tests keep their records.
  const deletionShop = { ...shops[0], _id: "delete-shop", name: "Delete Test Shop", isActive: true };
  shops.push(deletionShop);
  await click("Refresh");
  await wait('document.querySelectorAll("tbody tr").length===5');
  assert.equal(await evaluate('[...document.querySelectorAll("tbody tr")].find(r=>r.textContent.includes("Delete Test Shop")).textContent.includes("Delete\\n")'), false);
  deletionShop.isActive = false;
  await click("Refresh");
  await wait('[...document.querySelectorAll("tbody tr")].find(r=>r.textContent.includes("Delete Test Shop"))?.textContent.includes("Reactivate")');
  await evaluate('[...document.querySelectorAll("tbody tr")].find(r=>r.textContent.includes("Delete Test Shop")).querySelector(".btn-danger").click()');
  await wait('!!document.querySelector("#delete-confirmation")');
  assert.ok(await evaluate('document.querySelector("dialog").textContent.includes("Delete Test Shop") && document.querySelector("dialog").textContent.includes("irreversible")'));
  assert.equal(await evaluate('document.querySelector("dialog button[type=submit]").disabled'), true);
  await fill("#delete-confirmation", "delete");
  assert.equal(await evaluate('document.querySelector("dialog button[type=submit]").disabled'), true);
  const beforeDelete = calls.filter(c=>c.method==="DELETE").length;
  await click("Cancel");
  assert.equal(calls.filter(c=>c.method==="DELETE").length, beforeDelete);
  await evaluate('[...document.querySelectorAll("tbody tr")].find(r=>r.textContent.includes("Delete Test Shop")).querySelector(".btn-danger").click()');
  await fill("#delete-confirmation", "DELETE");
  assert.equal(await evaluate('document.querySelector("dialog button[type=submit]").disabled'), false);
  nextFailure = "/admin/shops/delete-shop";
  await click("Permanently delete");
  await wait('!!document.querySelector("dialog .alert-danger")');
  assert.ok(shops.includes(deletionShop));
  await click("Permanently delete");
  await wait('!document.querySelector("dialog") && document.querySelectorAll("tbody tr").length===4');
  assert.equal(shops.includes(deletionShop), false);
  assert.ok(await evaluate('document.body.innerText.includes("Delete Test Shop permanently deleted.")'));
  assert.equal(
    await evaluate('document.querySelector(".brand-name").textContent'),
    "DigiShop",
  );
  assert.equal(
    await evaluate('document.querySelector(".header-actions a").textContent'),
    "Account",
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert.ok(
    await evaluate("document.documentElement.scrollWidth <= 390"),
    "Admin layout should fit a small screen outside the responsive table",
  );
  await click("Account");
  await wait('!!document.querySelector("[name=oldPassword]")');
  assert.equal(await evaluate('document.querySelector("[name=shopName]")'), null);
  await fill("[name=username]", "updated admin");
  await fill("[name=email]", "updated.admin@example.test");
  await click("Save account");
  await wait('document.body.innerText.includes("updated admin | updated.admin@example.test")');
  await fill("[name=username]", "admin");
  await fill("[name=email]", "counter@example.test");
  await click("Save account");
  await wait('document.body.innerText.includes("admin | counter@example.test")');
  await send("Page.navigate", { url: "http://localhost:5173/cashier/pos" });
  await wait('location.pathname === "/admin/shops"');
  assert.ok(
    !calls.some(
      (c) =>
        c.role === "ADMIN" &&
        /^\/(products|orders|customers|categories|ai)\//.test(c.endpoint),
    ),
  );
  await click("Sign out");
  await wait('!!document.querySelector("[name=identity]")');
  await login("CASHIER");
  await wait('document.body.innerText.includes("Point of sale")');
  await send("Page.navigate", { url: "http://localhost:5173/owner/renew" });
  await wait('location.pathname==="/cashier/pos"');
  await evaluate("window.__paymentRoleCheck=true");
  nextSubscriptionFailure = true;
  await send("Page.reload");
  await wait(
    'document.body.innerText.includes("Please contact the shop owner")',
  );
  assert.ok(
    !(await evaluate('document.body.innerText.includes("Meezan Bank")')),
  );
  assert.ok(
    !(await evaluate('document.body.innerText.includes("00300111791703")')),
  );
  assert.equal(await evaluate('document.querySelector(".sidebar")'), null);
  await click("Sign out");
  await wait('!!document.querySelector("[name=identity]")');
  nextSubscriptionFailure = true;
  await fill("[name=identity]", "cashier");
  await fill("[name=password]", "test-password");
  await click("Sign in");
  await wait(
    'document.body.innerText.includes("Please contact the shop owner")',
  );
  assert.equal(await evaluate('document.querySelector(".sidebar")'), null);
  await click("Sign out");
  await wait('!!document.querySelector("[name=identity]")');
  nextSubscriptionFailure = false;
  for (const as of ["OWNER", "CASHIER"]) {
    const subscriptionBeforeManualBlock = shops[0].subscriptionExpiry;
    shops[0].subscriptionExpiry = new Date(Date.now() - 86400000).toISOString();
    shops[0].isActive = false;
    const beforeCalls = calls.length;
    await fill("[name=identity]", as.toLowerCase());
    await fill("[name=password]", "test-password");
    await click("Sign in");
    await wait(
      'document.body.innerText.includes("This shop has been deactivated")',
    );
    assert.equal(await evaluate('document.querySelector(".sidebar")'), null);
    assert.ok(
      !calls
        .slice(beforeCalls)
        .some((c) =>
          /^\/(products|orders|customers|categories|ai)\//.test(c.endpoint),
        ),
      "Blocked login must not request shop data",
    );
    await send("Page.reload");
    await sleep(300);
    await wait(
      'document.body.innerText.includes("This shop has been deactivated")',
    );
    await screenshot("blocked-" + as.toLowerCase());
    await click("Sign out");
    await wait('!!document.querySelector("[name=identity]")');
    shops[0].isActive = true;
    shops[0].subscriptionExpiry = subscriptionBeforeManualBlock;
    await login(as);
    if (as === "OWNER") {
      await click("Products");
      await wait('document.body.innerText.includes("Copper Cable")');
    } else await wait('!!document.querySelector(".product-result")');
    shops[0].isActive = false;
    await click("Customers");
    await wait(
      'document.body.innerText.includes("This shop has been deactivated")',
    );
    assert.equal(await evaluate('document.querySelector(".sidebar")'), null);
    await click("Sign out");
    await wait('!!document.querySelector("[name=identity]")');
  }
  shops[0].isActive = true;
  await login("CASHIER");
  await wait('!!document.querySelector(".product-result")');
  await click("Sign out");
  await wait('!!document.querySelector("[name=identity]")');
  await click("Register your shop");
  await wait('!!document.querySelector("[name=shopName]")');
  await fill("[name=shopName]", "Registered shop");
  await fill("[name=contactNo]", "03001234567");
  await fill("[name=address]", "Market");
  await fill("[name=username]", "registered");
  await fill("[name=email]", "registered@example.test");
  await fill("[name=password]", "test-password");
  assert.equal(await evaluate('document.querySelector("input[name=avatar]").required'), false);
  await evaluate(
    '(()=>{const input=document.querySelector("input[type=file]");const dt=new DataTransfer();dt.items.add(new File(["invalid"],"photo.txt",{type:"text/plain"}));input.files=dt.files;input.dispatchEvent(new Event("change",{bubbles:true}));})()',
  );
  const beforeInvalidPicture = calls.filter(c => c.endpoint === "/users/register").length;
  await click("Create shop");
  await wait('document.body.innerText.includes("Choose an image smaller than 5 MB.")');
  assert.equal(calls.filter(c => c.endpoint === "/users/register").length, beforeInvalidPicture);
  await evaluate('document.querySelector("input[name=avatar]").value = ""');
  await click("Create shop");
  await wait('location.pathname === "/owner"');
  await wait(
    'document.querySelector(".owner-welcome h1")?.textContent==="Registered shop"',
  );
  expireAccess = true;
  failRefresh = true;
  await send("Page.reload");
  await sleep(300);
  await wait('location.pathname === "/login"');
  assert.deepEqual(errors, []);
  // Read-only live API check; keep only the test API URL override, with no mocked API responses.
  liveResponses.length = 0;
  await send("Fetch.enable", { patterns: [{ urlPattern: "http://localhost:5173/src/api/client.js*" }] });
  await send("Page.reload");
  await sleep(300);
  await wait('!!document.querySelector("[name=identity]")');
  assert.equal(await evaluate("location.pathname"), "/login");
  assert.ok(
    liveResponses.some(
      (r) => r.url.endsWith("/users/current-user") && r.status === 400,
    ),
    "Live missing-cookie contract",
  );
  assert.ok(
    liveResponses.some(
      (r) => r.url.endsWith("/users/refresh-token") && r.status === 400,
    ),
    "Live missing-refresh contract",
  );
  assert.ok(
    liveResponses.every(
      (r) =>
        (r.headers["Access-Control-Allow-Origin"] ||
          r.headers["access-control-allow-origin"]) === "http://localhost:5173",
    ),
    "Live credentialed CORS origin",
  );
  console.log(
    "Browser smoke passed: purchase creation/confirmation, deferred and posted deliveries, supplier payment validation and identical retry after lost response, duplicate-click protection, original receipt return and eligibility, payable updates, posted transaction details; Accounts navigation and role guards, entity creation/search/customer links without duplicate customers, brand links, customer debt/credit reads, disabled setup and unavailable balances/history, confirmed balance display, transaction search/UTC dates/pagination and API denial; invoice returns/exchanges, refunds, payments, previews, idempotency, POS credit, all existing roles/POS/quotations/inventory/customers/staff/AI/auth/subscription/printing/responsive regressions. Authenticated writes use isolated contract responses; anonymous initialization also checked against the local backend.",
  );
} finally {
  if (socket?.readyState === 1) {
    try {
      await send("Browser.close");
    } catch {
      socket.close();
    }
  }
  chrome.kill();
}
