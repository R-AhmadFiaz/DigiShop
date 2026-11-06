import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Notice } from "../components/Common";

export default function ShopBlocked() {
  const { logout } = useAuth();
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
    <main className="auth-shell">
      <section className="auth-card">
        <h1 className="h4">Shop deactivated</h1>
        <p>This shop has been deactivated. Please contact the administrator.</p>
        <Notice error={error} />
        <button
          className="btn btn-outline-secondary"
          disabled={busy}
          onClick={signOut}
        >
          {busy ? "Signing out..." : "Sign out"}
        </button>
      </section>
    </main>
  );
}
