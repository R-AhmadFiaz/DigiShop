import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { homeFor, useAuth } from "../../auth/AuthContext";
import {
  AvatarInput,
  Field,
  Notice,
  validateAvatar,
} from "../../components/Common";
export default function Register() {
  const { user, register } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  async function submit(e) {
    e.preventDefault();
    const body = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      validateAvatar(body.get("avatar"));
      body.set("username", body.get("username").trim().toLowerCase());
      body.set("email", body.get("email").trim().toLowerCase());
      await register(body);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-card registration">
        <p className="brand-name">DigiShop</p>
        <h1 className="h4">Register your shop</h1>
        <p className="text-body-secondary">
          Your shop needs administrator activation before its first sale.
        </p>
        <Notice error={error} />
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <div className="row g-3">
              <div className="col-md-6">
                <Field label="Shop name">
                  <input
                    className="form-control"
                    name="shopName"
                    required
                    maxLength={100}
                  />
                </Field>
                <Field label="Shop phone">
                  <input
                    className="form-control"
                    name="contactNo"
                    type="tel"
                    pattern="[0-9]{11}"
                    maxLength={11}
                    title="11 digits"
                    required
                  />
                </Field>
                <Field label="Shop address">
                  <input
                    className="form-control"
                    name="address"
                    required
                    maxLength={200}
                  />
                </Field>
                <AvatarInput />
              </div>
              <div className="col-md-6">
                <Field label="Owner username">
                  <input
                    className="form-control"
                    name="username"
                    autoComplete="username"
                    required
                    maxLength={60}
                  />
                </Field>
                <Field label="Email">
                  <input
                    className="form-control"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                  />
                </Field>
                <Field label="Password">
                  <input
                    className="form-control"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </Field>
              </div>
            </div>
            <button className="btn btn-primary mt-3" type="submit">
              {busy ? "Creating shop..." : "Create shop"}
            </button>
            <Link className="ms-3" to="/login">
              Back to sign in
            </Link>
          </fieldset>
        </form>
      </section>
    </main>
  );
}
