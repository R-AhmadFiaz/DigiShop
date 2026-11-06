import { createContext, useContext, useEffect, useState } from "react";
import {
  api,
  setSessionExpiredHandler,
  setShopDeactivatedHandler,
  setSubscriptionBlockedHandler,
  SHOP_DEACTIVATED_MESSAGE,
} from "../api/client";
const AuthContext = createContext(null);
export const homeFor = (role) =>
  ({ OWNER: "/owner", CASHIER: "/cashier/pos", ADMIN: "/admin/shops" })[role] ||
  "/login";
function safeUser(user, session = user) {
  if (!user || !["OWNER", "CASHIER", "ADMIN"].includes(user.role)) return null;
  return {
    _id: user._id,
    username: user.username,
    email: user.email,
    avatar: user.avatar,
    role: user.role,
    ...(user.role !== "ADMIN"
      ? Object.fromEntries(
          ["shopName", "shopAddress", "shopContactNo"]
            .filter((field) => typeof session?.[field] === "string")
            .map((field) => [field, session[field]]),
        )
      : {}),
  };
}
// Cashier sessions do not return expiry. This existing, role-safe read is
// subscription-protected; never probe by creating a sale or changing data.
async function checkCashierSubscription(data) {
  if (data.user?.role !== "CASHIER" || data.shopActive === false) return;
  try {
    await api("/categories/");
  } catch (e) {
    if (e.status !== 403) throw e;
    if (e.message === SHOP_DEACTIVATED_MESSAGE) data.shopActive = false;
  }
}
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null),
    [shopActive, setShopActive] = useState(true),
    [subscriptionExpiry, setSubscriptionExpiry] = useState(null),
    [subscriptionBlocked, setSubscriptionBlocked] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setSessionExpiredHandler(() => setUser(null));
    setShopDeactivatedHandler(() => setShopActive(false));
    setSubscriptionBlockedHandler(() => setSubscriptionBlocked(true));
    api("/users/current-user", { method: "POST" })
      .then(async (data) => {
        if (!alive) return;
        await checkCashierSubscription(data);
        if (alive) {
          setUser(safeUser(data.user, data));
          setShopActive(data.shopActive !== false);
          setSubscriptionExpiry(data.subscriptionExpiry ?? null);
        }
      })
      .catch((e) => {
        if (alive && e.status !== 401) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      setSessionExpiredHandler(() => {});
      setShopDeactivatedHandler(() => {});
      setSubscriptionBlockedHandler(() => {});
    };
  }, []);
  const login = async (body) => {
    const data = await api("/users/login", {
      method: "POST",
      body,
      auth: false,
    });
    setSubscriptionBlocked(false);
    await checkCashierSubscription(data);
    setUser(safeUser(data.user, data));
    setShopActive(data.shopActive !== false);
    setSubscriptionExpiry(data.subscriptionExpiry ?? null);
    setError("");
  };
  const register = async (body) => {
    const data = await api("/users/register", {
      method: "POST",
      body,
      auth: false,
    });
    setUser(safeUser(data));
    setShopActive(true);
    setSubscriptionExpiry(null);
    setSubscriptionBlocked(false);
    setError("");
  };
  const logout = async () => {
    await api("/users/logout", { method: "POST" });
    setUser(null);
    setShopActive(true);
    setSubscriptionExpiry(null);
    setSubscriptionBlocked(false);
  };
  const updateSession = (data) => {
    setUser(safeUser(data.user, data));
    setShopActive(data.shopActive !== false);
    setSubscriptionExpiry(data.subscriptionExpiry ?? null);
  };
  return (
    <AuthContext.Provider
      value={{
        user,
        shopActive,
        subscriptionExpiry,
        subscriptionBlocked,
        loading,
        error,
        login,
        register,
        logout,
        updateSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
