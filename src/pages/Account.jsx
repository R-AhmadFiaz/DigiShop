import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api } from "../api/client";
import { Field, Notice, PageTitle } from "../components/Common";
export default function Account() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget,
      body = Object.fromEntries(new FormData(form));
    setError("");
    setSuccess("");
    if (body.newPassword !== body.confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api("/users/change-password", {
        method: "POST",
        body: { oldPassword: body.oldPassword, newPassword: body.newPassword },
      });
      form.reset();
      setSuccess("Password changed.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle title="Account" />
      <p>
        {user.username} | {user.email}
      </p>
      <section className="panel narrow">
        <h2 className="h6">Change password</h2>
        <Notice error={error} success={success} />
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <Field label="Current password">
              <input
                name="oldPassword"
                className="form-control"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <Field label="New password">
              <input
                name="newPassword"
                className="form-control"
                type="password"
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="Confirm new password">
              <input
                name="confirm"
                className="form-control"
                type="password"
                autoComplete="new-password"
                required
              />
            </Field>
            <button className="btn btn-primary" type="submit">
              {busy ? "Saving..." : "Change password"}
            </button>
          </fieldset>
        </form>
      </section>
    </>
  );
}
