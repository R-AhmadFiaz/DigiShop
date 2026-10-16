import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { homeFor, useAuth } from "./auth/AuthContext";
import ShopLayout from "./layouts/ShopLayout";
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import Dashboard from "./pages/owner/Dashboard";
import Products from "./pages/owner/Products";
import Stock from "./pages/owner/Stock";
import Sales from "./pages/owner/Sales";
import Invoice from "./pages/owner/Invoice";
import Staff from "./pages/owner/Staff";
import Customers from "./pages/Customers";
import Quotations from "./pages/Quotations";
import VoiceStock from "./pages/VoiceStock";
import Account from "./pages/Account";
import Shops from "./pages/admin/Shops";
import POS from "./components/POS";
import ShopBlocked from "./pages/ShopBlocked";
import { useEffect, useState } from "react";
import SubscriptionBlocked from "./pages/SubscriptionBlocked";
import RenewalInformation from "./components/RenewalInformation";
import Companies from './pages/owner/Companies';
import CashBank from './pages/owner/CashBank';
import Transactions from './pages/owner/Transactions';
import Purchases from './pages/owner/Purchases';
import PurchaseDetails from './pages/owner/PurchaseDetails';
import SupplierDetails from './pages/owner/SupplierDetails';
function Guard({ role }) {
  const { user } = useAuth();
  return !user ? (
    <Navigate to="/login" replace />
  ) : user.role !== role ? (
    <Navigate to={homeFor(user.role)} replace />
  ) : (
    <Outlet />
  );
}
function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user.role) : "/login"} replace />;
}
export default function App() {
  const { loading, user, shopActive, subscriptionExpiry, subscriptionBlocked } =
    useAuth();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  if (loading)
    return (
      <main className="auth-shell">
        <p role="status">Opening your counter...</p>
      </main>
    );
  if (user && user.role !== "ADMIN" && !shopActive) return <ShopBlocked />;
  if (
    user &&
    user.role !== "ADMIN" &&
    (subscriptionBlocked ||
      (user.role === "OWNER" &&
        subscriptionExpiry &&
        new Date(subscriptionExpiry).getTime() <= now))
  )
    return <SubscriptionBlocked />;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<Guard role="OWNER" />}>
        <Route path="/owner" element={<ShopLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="products" element={<Products />} />
          <Route path="stock" element={<Stock />} />
          <Route path="purchases" element={<Purchases />} />
          <Route path="purchases/:purchaseId" element={<PurchaseDetails />} />
          <Route path="accounts/suppliers/:supplierId" element={<SupplierDetails />} />
          <Route path="sales" element={<Sales />} />
          <Route path="sales/:orderId" element={<Invoice />} />
          <Route path="customers" element={<Customers />} />
          <Route path="accounts/companies" element={<Companies />} />
          <Route path="accounts/cash-bank" element={<CashBank />} />
          <Route path="accounts/transactions" element={<Transactions />} />
          <Route path="quotations" element={<Quotations />} />
          <Route path="staff" element={<Staff />} />
          <Route path="ai" element={<VoiceStock />} />
          <Route path="account" element={<Account />} />
          <Route path="renew" element={<RenewalInformation />} />
        </Route>
      </Route>
      <Route element={<Guard role="CASHIER" />}>
        <Route path="/cashier" element={<ShopLayout />}>
          <Route index element={<Navigate to="pos" replace />} />
          <Route
            path="pos"
            element={
              <>
                <h1 className="h4 mb-3 no-print">Point of sale</h1>
                <POS />
              </>
            }
          />
          <Route path="customers" element={<Customers />} />
          <Route path="quotations" element={<Quotations />} />
          <Route path="ai" element={<VoiceStock />} />
          <Route path="account" element={<Account />} />
        </Route>
      </Route>
      <Route element={<Guard role="ADMIN" />}>
        <Route path="/admin" element={<ShopLayout />}>
          <Route index element={<Navigate to="shops" replace />} />
          <Route path="shops" element={<Shops />} />
          <Route path="account" element={<Account />} />
        </Route>
      </Route>
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
