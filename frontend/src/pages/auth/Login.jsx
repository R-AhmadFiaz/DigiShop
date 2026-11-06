import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { homeFor, useAuth } from "../../auth/AuthContext";
import { Field, Notice } from "../../components/Common";
export default function Login() {
  const { user, login, error: restoreError } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  async function submit(e) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      const identity = values.identity.trim().toLowerCase();
      await login({
        [identity.includes("@") ? "email" : "username"]: identity,
        password: values.password,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="brand-name">DigiShop</p>
        <h1 className="h4">Sign in</h1>
        <p className="text-body-secondary">Ready for the next customer.</p>
        <Notice error={error || restoreError} />
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <Field label="Username or email">
              <input
                name="identity"
                className="form-control"
                autoComplete="username"
                required
                autoFocus
              />
            </Field>
            <Field label="Password">
              <input
                name="password"
                type="password"
                className="form-control"
                autoComplete="current-password"
                required
              />
            </Field>
            <button className="btn btn-primary w-100 mt-2" type="submit">
              {busy ? "Signing in..." : "Sign in"}
            </button>
          </fieldset>
        </form>
        <p className="mt-4 mb-0 text-body-secondary">
          Opening a shop? <Link to="/register">Register your shop</Link>
        </p>
      </section>
    </main>
  );
}
