import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Notice } from "../components/Common";
import SupplierQuickPayment from "../components/SupplierQuickPayment";
import SubscriptionWarning from "../components/SubscriptionWarning";
import { displayName } from "../utils/identity";
const links = {
  OWNER: [
    ["", "Dashboard"],
    ["products", "Products"],
    ["stock", "Stock"],
    ["purchases", "Purchases"],
    ["customers", "Customers"],
    ["expenses", "Expenses"],
    ["partners", "Partners & Capital"],
    ["existing-setup", "Starting Balances"],
    ["reports", "Reports"],
    ["sales", "Sales"],
    ["quotations", "Quotations"],
    ["staff", "Cashiers"],
    ["ai", "AI Assistant"],
  ],
  CASHIER: [
    ["pos", "POS"],
    ["customers", "Customers"],
    ["quotations", "Quotations"],
    ["ai", "AI Assistant"],
  ],
  ADMIN: [["shops", "Shops"]],
};
export default function ShopLayout() {
  const { user, logout, subscriptionExpiry } = useAuth();
  const { pathname, search } = useLocation();
  // "Create Order" opens the purchase form on the Purchases page; on that page it keeps the current list filters.
  const createOrderSearch = (() => {
    const params = new URLSearchParams(pathname.replace(/\/$/, "") === "/owner/purchases" ? search : "");
    params.set("create", "1");
    return "?" + params;
  })();
  const ownerDashboard =
    user.role === "OWNER" && pathname.replace(/\/$/, "") === "/owner";
  // Sales > New sale moves the subscription warning into the header as a pill, so the sale screen keeps its height.
  const saleScreen =
    user.role === "OWNER" &&
    pathname.replace(/\/$/, "") === "/owner/sales" &&
    new URLSearchParams(search).get("view") !== "history";
  const cashierPOS =
    user.role === "CASHIER" && pathname.replace(/\/$/, "") === "/cashier/pos";
  const drawer=useRef(null),menuButton=useRef(null);
  const [menuOpen,setMenuOpen]=useState(false),[paySupplier,setPaySupplier]=useState(false);
  const purchaseTrigger=useRef(null),returnToDrawer=useRef(false);
  function openSupplierPayment(){
    returnToDrawer.current=menuOpen;
    navigation.current?.querySelectorAll('details[open]').forEach(d=>d.open=false);
    setMenuOpen(false);setPaySupplier(true);
  }
  function closeSupplierPayment(){
    setPaySupplier(false);
    if(returnToDrawer.current){setMenuOpen(true);requestAnimationFrame(()=>purchaseTrigger.current?.focus());}
    else requestAnimationFrame(()=>purchaseTrigger.current?.focus());
  }
  const mainSections=user.role==='OWNER'?['','sales','products','purchases','customers','reports']:links[user.role].map(([to])=>to);
  const secondaryLinks=links[user.role].filter(([to])=>!mainSections.includes(to));
  const navigation=useRef(null);
  useEffect(()=>{
    const close=event=>{if(!navigation.current?.contains(event.target))navigation.current?.querySelectorAll('details[open]').forEach(d=>d.open=false);};
    document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);
  },[]);
  // Only one navigation dropdown open at a time: opening one closes the others (a nested menu such as
  // Accounts inside More keeps its parent open). Escape closes an open dropdown even without focus in it.
  useEffect(()=>{
    const nav=navigation.current;if(!nav)return;
    const closeOthers=opened=>nav.querySelectorAll('details[open]').forEach(d=>{if(d!==opened&&!d.contains(opened))d.open=false;});
    // Close the others as soon as a summary is activated (click, Enter or Space). The toggle event fires
    // later, after the menu may already have been closed again, so it is only a fallback.
    const activate=event=>{const opening=event.target.closest?.('summary')?.parentElement;if(opening?.tagName==='DETAILS'&&!opening.open)closeOthers(opening);};
    const exclusive=event=>{const opened=event.target;if(opened.tagName==='DETAILS'&&opened.open)closeOthers(opened);};
    const escape=event=>{if(event.key!=='Escape'||event.defaultPrevented||nav.closest('dialog[open]'))return;const open=[...nav.querySelectorAll('details[open]')];if(!open.length)return;
      event.preventDefault();const focused=open.find(d=>d.contains(document.activeElement));open.forEach(d=>d.open=false);if(focused)focused.querySelector('summary')?.focus();};
    nav.addEventListener('click',activate,true);nav.addEventListener('toggle',exclusive,true);document.addEventListener('keydown',escape);
    return()=>{nav.removeEventListener('click',activate,true);nav.removeEventListener('toggle',exclusive,true);document.removeEventListener('keydown',escape);};
  },[]);
  useEffect(()=>{navigation.current?.querySelectorAll('details[open]').forEach(d=>{const restore=d.contains(document.activeElement);d.open=false;if(restore)d.querySelector('summary')?.focus();});},[pathname]);
  useEffect(()=>{
    if(!menuOpen)return;
    const dialog=drawer.current,trigger=menuButton.current,previous=document.body.style.overflow,previousRoot=document.documentElement.style.overflow;
    dialog.showModal();document.body.style.overflow='hidden';document.documentElement.style.overflow='hidden';
    const active=dialog.querySelector('[aria-current="page"]');
    for(let parent=active?.parentElement;parent&&parent!==dialog;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
    (active||dialog.querySelector('button')).focus();
    const resize=()=>{if(window.innerWidth>768)setMenuOpen(false);};
    window.addEventListener('resize',resize);
    return()=>{dialog.close();document.body.style.overflow=previous;document.documentElement.style.overflow=previousRoot;window.removeEventListener('resize',resize);trigger?.focus();};
  },[menuOpen]);
  const drafts = useRef({});
  const [quotations, setQuotations] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function confirmLeaving() {
    return (
      !Object.values(drafts.current).some((draft) => draft.cart?.length) ||
      window.confirm("Sign out and clear unfinished sales or quotations?")
    );
  }
  async function signOut() {
    if (!confirmLeaving()) return;
    setBusy(true);
    setError("");
    try {
      await logout();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-shell">
      <div className="mobile-brand-bar no-print"><div className="sidebar-brand"><img src="/digishop-logo.png" alt="" width="38" height="38"/><span className="brand-name">DigiShop</span></div><button ref={menuButton} type="button" className="btn btn-outline-secondary" aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="shop-navigation" onClick={()=>setMenuOpen(true)}><span aria-hidden="true">&#9776;</span></button></div>
      <dialog ref={drawer} id="shop-navigation" className="navigation-drawer no-print" aria-label="Shop navigation" onCancel={()=>setMenuOpen(false)} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)setMenuOpen(false);}}}>
      <aside className="sidebar">
        <button type="button" className="drawer-close btn btn-outline-secondary" aria-label="Close navigation" onClick={()=>setMenuOpen(false)}>&times;</button>
        <div className="sidebar-brand">
          <img src="/digishop-logo.png" alt="" width="38" height="38" />
          <span className="brand-name">DigiShop</span>
        </div>
        <div className="role-label">
          {user.role === "ADMIN"
            ? "Platform administration"
            : user.role === "OWNER"
              ? "Shop Management"
              : "Sales counter"}
        </div>
        <nav ref={navigation} aria-label="Main navigation" onKeyDown={e=>{
          const details=e.target.closest('details');
          // Escape closes the nearest open menu (never an already closed one, e.g. Accounts inside More).
          const openMenu=e.target.closest('details[open]');
          if(e.key==='Escape'&&openMenu){e.preventDefault();openMenu.open=false;openMenu.querySelector('summary')?.focus();return;}
          // Purchases is a native disclosure, not a menu-button widget.
          // Leave Tab, Shift+Tab, Enter and Space to the browser.
          if(details?.classList.contains('purchase-nav'))return;
          if(e.key===' '&&e.target.matches('.navigation-overflow a, .navigation-overflow button')){e.preventDefault();e.target.click();return;}
          if(details?.classList.contains('more-nav')&&['ArrowDown','ArrowUp'].includes(e.key)){
            const summary=e.target.closest('summary');
            if(summary){e.preventDefault();details.open=true;const items=details.querySelectorAll('.navigation-overflow a, .navigation-overflow button');items[e.key==='ArrowDown'?0:items.length-1]?.focus();return;}
            const items=[...details.querySelectorAll('.navigation-overflow a, .navigation-overflow button')],index=items.indexOf(e.target);
            if(index>=0&&items.length){e.preventDefault();items[(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();}
          }
        }} onClick={e=>{if(e.target.closest('a'))setMenuOpen(false);}}>
          {links[user.role].filter(([to])=>mainSections.includes(to)).map(([to, label]) => (
            to==='purchases'?<details key={to} className="more-nav purchase-nav">
              <summary ref={purchaseTrigger} aria-label="Purchases menu" aria-controls="purchase-dropdown-items" aria-current={pathname.startsWith('/owner/purchases')?'page':undefined}>Purchases</summary>
              <div id="purchase-dropdown-items" className="navigation-overflow">
                <NavLink to="purchases">Purchase orders</NavLink>
                <Link to={{pathname:"purchases",search:createOrderSearch}} onClick={e=>{const menu=e.currentTarget.closest('details');if(menu)menu.open=false;}}>Create Order</Link>
                <button type="button" className="btn w-100 text-start" onClick={openSupplierPayment}>Pay supplier</button>
              </div>
            </details>:to==='customers' ? <details key={to} className="more-nav customer-nav">
              <summary aria-label="Customers menu" aria-current={pathname.startsWith('/owner/customers')||pathname==='/cashier/customers'?'page':undefined}>Customers</summary>
              <div className="navigation-overflow">
                <NavLink to={to} end>Customer accounts</NavLink>
                {user.role==='OWNER'&&<>
                  <NavLink to="customers/invoices">Customer invoices</NavLink>
                  <NavLink to="customers/activity?type=HISTORY">Customer activity</NavLink>
                </>}
              </div>
            </details> : <NavLink key={to} to={to || "."} end={!['sales','purchases'].includes(to)}>{label}</NavLink>
          ))}          {secondaryLinks.length>0&&<details className="more-nav"><summary>More</summary><div className="navigation-overflow">
            {secondaryLinks.map(([to,label])=><NavLink key={to} to={to} end>{label}</NavLink>)}
          {user.role === "OWNER" && (
            <details className="accounts-nav">
              <summary>Accounts</summary>
              <NavLink to="accounts/companies">Suppliers</NavLink>
              <NavLink to="accounts/cash-bank">Cash &amp; Bank</NavLink>
              <NavLink to="accounts/transactions">Transactions</NavLink>
            </details>
          )}
          </div></details>}
        </nav>
      </aside>
      </dialog>
      {paySupplier&&user.role==='OWNER'&&<SupplierQuickPayment onClose={closeSupplierPayment} onNavigate={()=>{setPaySupplier(false);setMenuOpen(false);returnToDrawer.current=false;}}/>}
      <main className="workspace">
        <header className="app-header no-print">
          {ownerDashboard && (
            <div className="owner-welcome">
              <p className="welcome-line">
                Welcome, <strong>{displayName(user.username)}</strong>
              </p>
              <h1>{user.shopName}</h1>
              <p className="text-body-secondary">
                Here's what's happening in your shop today.
              </p>
            </div>
          )}
          {cashierPOS && (
            <div className="cashier-welcome">
              <p className="welcome-line">
                Welcome, <strong>{displayName(user.username)}</strong>
              </p>
              <p className="text-body-secondary mb-0">{user.shopName}</p>
            </div>
          )}
          <div className="header-actions">
            {saleScreen && (
              <SubscriptionWarning expiry={subscriptionExpiry} compact />
            )}
            <NavLink className="btn btn-outline-secondary btn-sm" to="account">
              Account
            </NavLink>
            <button
              className="btn btn-outline-secondary btn-sm"
              disabled={busy}
              onClick={signOut}
            >
              {busy ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </header>
        <div className="no-print">
          {user.role === "OWNER" && !saleScreen && (
            <SubscriptionWarning expiry={subscriptionExpiry} />
          )}
          <Notice error={error} />
        </div>
        <Outlet context={{ quotations, setQuotations, drafts }} />
      </main>
    </div>
  );
}
