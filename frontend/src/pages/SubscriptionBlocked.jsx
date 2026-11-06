import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import RenewalInformation from "../components/RenewalInformation";
import { Notice } from "../components/Common";

export default function SubscriptionBlocked() {
  const { user, logout } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function signOut() {
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
    <main className="container py-4" style={{ maxWidth: 960 }}>
      <h1 className="h4">Subscription expired or inactive</h1>
      <p>
        {user.role === "OWNER"
          ? "Shop operations are unavailable until the administrator renews your subscription."
          : "Shop subscription has expired. Please contact the shop owner."}
      </p>
      {user.role === "OWNER" && <RenewalInformation />}
      <Notice error={error} />
      <button
        className="btn btn-outline-secondary mt-3"
        disabled={busy}
        onClick={signOut}
      >
        {busy ? "Signing out..." : "Sign out"}
      </button>
    </main>
  );
}
