import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Notice } from "../components/Common";
import SubscriptionWarning from "../components/SubscriptionWarning";
import { displayName } from "../utils/identity";
const links = {
  OWNER: [
    ["", "Dashboard"],
    ["products", "Products"],
    ["stock", "Stock"],
    ["purchases", "Purchases"],
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
  const { pathname } = useLocation();
  const ownerDashboard =
    user.role === "OWNER" && pathname.replace(/\/$/, "") === "/owner";
  const cashierPOS =
    user.role === "CASHIER" && pathname.replace(/\/$/, "") === "/cashier/pos";
  const drawer=useRef(null),menuButton=useRef(null);
  const [menuOpen,setMenuOpen]=useState(false);
  useEffect(()=>{
    if(!menuOpen)return;
    const dialog=drawer.current,trigger=menuButton.current,previous=document.body.style.overflow,previousRoot=document.documentElement.style.overflow;
    dialog.showModal();document.body.style.overflow='hidden';document.documentElement.style.overflow='hidden';
    (dialog.querySelector('[aria-current="page"]')||dialog.querySelector('button')).focus();
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
        <nav aria-label="Main navigation" onClick={e=>{if(e.target.closest('a'))setMenuOpen(false);}}>
          {links[user.role].map(([to, label]) => (
            <NavLink key={to} to={to || "."} end={!["sales","purchases"].includes(to)}>
              {label}
            </NavLink>
          ))}
          {user.role === "OWNER" && (
            <details className="accounts-nav" open={pathname.includes('/accounts/') || pathname === '/owner/customers' ? true : undefined}>
              <summary>Accounts</summary>
              <NavLink to="customers">Customers</NavLink>
              <NavLink to="accounts/companies">Suppliers</NavLink>
              <NavLink to="accounts/cash-bank">Cash &amp; Bank</NavLink>
              <NavLink to="accounts/transactions">Transactions</NavLink>
            </details>
          )}
        </nav>
      </aside>
      </dialog>
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
          {user.role === "OWNER" && (
            <SubscriptionWarning expiry={subscriptionExpiry} />
          )}
          <Notice error={error} />
        </div>
        <Outlet context={{ quotations, setQuotations, drafts }} />
      </main>
    </div>
  );
}
