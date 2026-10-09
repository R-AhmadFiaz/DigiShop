import { useRef, useState } from "react";
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
    ["sales", "Sales"],
    ["customers", "Customers"],
    ["quotations", "Quotations"],
    ["staff", "Create Cashier"],
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
      <aside className="sidebar no-print">
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
        <nav aria-label="Main navigation">
          {links[user.role].map(([to, label]) => (
            <NavLink key={to} to={to || "."} end={to !== "sales"}>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
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
