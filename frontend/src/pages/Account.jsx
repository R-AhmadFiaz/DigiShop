import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api } from "../api/client";
import { Field, Notice, PageTitle } from "../components/Common";
export default function Account() {
  const { user, updateSession } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(""),
    [detailsError, setDetailsError] = useState(""),
    [detailsSuccess, setDetailsSuccess] = useState("");
  async function saveDetails(e, shop = false) {
    e.preventDefault();
    if (saving) return;
    const body = Object.fromEntries(new FormData(e.currentTarget));
    setSaving(shop ? "shop" : "profile");
    setDetailsError("");
    setDetailsSuccess("");
    try {
      const data = await api(shop ? "/users/shop-details" : "/users/profile", { method: "PATCH", body });
      updateSession(data);
      setDetailsSuccess(shop ? "Shop details updated." : "Account updated.");
    } catch (e) {
      setDetailsError(e.message);
    } finally {
      setSaving("");
    }
  }
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
      <Notice error={detailsError} success={detailsSuccess} />
      {/* Desktop: the account forms sit side by side; phones keep them stacked. */}
      <div className="account-forms">
      <section className="panel narrow mb-3">
        <h2 className="h6">Account details</h2>
        <form onSubmit={saveDetails} key={user.username + user.email}>
          <fieldset disabled={Boolean(saving)}>
            <Field label="Username"><input className="form-control" name="username" defaultValue={user.username} required autoComplete="username" /></Field>
            <Field label="Email"><input className="form-control" name="email" type="email" defaultValue={user.email} required autoComplete="email" /></Field>
            <button className="btn btn-primary" type="submit">{saving === "profile" ? "Saving..." : "Save account"}</button>
          </fieldset>
        </form>
      </section>
      {user.role === "OWNER" && (
        <section className="panel narrow mb-3">
          <h2 className="h6">Shop details</h2>
          <form onSubmit={(e) => saveDetails(e, true)} key={user.shopName + user.shopAddress + user.shopContactNo}>
            <fieldset disabled={Boolean(saving)}>
              <Field label="Shop name"><input className="form-control" name="shopName" defaultValue={user.shopName} required /></Field>
              <Field label="Address"><input className="form-control" name="address" defaultValue={user.shopAddress} required /></Field>
              <Field label="Contact number"><input className="form-control" name="contactNo" type="tel" pattern="[0-9]{11}" maxLength={11} title="11 digits" defaultValue={user.shopContactNo} required /></Field>
              <button className="btn btn-primary" type="submit">{saving === "shop" ? "Saving..." : "Save shop details"}</button>
            </fieldset>
          </form>
        </section>
      )}
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
      </div>
    </>
  );
}
