import { useState } from "react";
import { api, query } from "../../api/client";
import { useLoad } from "../../api/hooks";
import { usePageParam } from "../../api/paging";
import {
  AvatarInput,
  Field,
  Empty,
  Modal,
  Notice,
  PageTitle,
  Pagination,
  validateAvatar,
} from "../../components/Common";
export default function Staff() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const [page, setPage] = usePageParam();
  const cashiers = useLoad("/users/cashiers" + query({ page, limit: 20 }));
  const [editing, setEditing] = useState(null),
    [resetting, setResetting] = useState(false),
    [saving, setSaving] = useState(false),
    [manageError, setManageError] = useState(""),
    [manageSuccess, setManageSuccess] = useState("");
  async function saveCashier(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setManageError("");
    setManageSuccess("");
    try {
      await api("/users/cashiers/" + editing._id + (resetting ? "/reset-password" : ""), {
        method: "PATCH", body: Object.fromEntries(new FormData(e.currentTarget)),
      });
      setManageSuccess(resetting ? "Cashier password reset." : "Cashier updated.");
      setEditing(null);
      cashiers.reload();
    } catch (e) {
      setManageError(e.message);
    } finally { setSaving(false); }
  }
  async function removeCashier(cashier) {
    if (saving || !window.confirm("Delete cashier " + cashier.username + "? They will no longer be able to sign in. Historical sales and records will be kept.")) return;
    setSaving(true);
    setManageError("");
    setManageSuccess("");
    try {
      await api("/users/cashiers/" + cashier._id, { method: "DELETE" });
      setManageSuccess("Cashier deleted.");
      cashiers.reload();
    } catch (e) { setManageError(e.message); }
    finally { setSaving(false); }
  }
  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget,
      body = new FormData(form);
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      validateAvatar(body.get("avatar"));
      body.set("username", body.get("username").trim().toLowerCase());
      body.set("email", body.get("email").trim().toLowerCase());
      const data = await api("/users/register-staff", { method: "POST", body });
      form.reset();
      cashiers.reload();
      setSuccess(
        "Cashier account created for " +
          data.cashier.username +
          ". They can now sign in.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle title="Create cashier account" />
      <section className="panel narrow">
        <p className="text-body-secondary">
          Create a sign-in for a shop salesperson.
        </p>
        <Notice error={error} success={success} />
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <Field label="Username">
              <input
                className="form-control"
                name="username"
                autoComplete="off"
                required
                maxLength={60}
              />
            </Field>
            <Field label="Email">
              <input
                className="form-control"
                name="email"
                type="email"
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
            <AvatarInput />
            <button className="btn btn-primary" type="submit">
              {busy ? "Creating..." : "Create cashier account"}
            </button>
          </fieldset>
        </form>
      </section>
      <section className="panel mt-3 fill-panel fill-compact">
        <h2 className="h6">Your Cashiers</h2>
        <Notice loading={cashiers.loading} error={cashiers.error || manageError} success={manageSuccess} />
        {cashiers.data?.cashiers.length ? (
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead><tr><th>Username</th><th>Email</th><th>Actions</th></tr></thead>
              <tbody>{cashiers.data.cashiers.map((cashier) => (
                <tr key={cashier._id}>
                  <td>{cashier.username}</td><td>{cashier.email}</td>
                  <td><div className="d-flex gap-2 flex-wrap">
                    <button className="btn btn-outline-secondary btn-sm" disabled={saving} onClick={() => {setEditing(cashier); setResetting(false); setManageError("");}}>Edit</button>
                    <button className="btn btn-outline-secondary btn-sm" disabled={saving} onClick={() => {setEditing(cashier); setResetting(true); setManageError("");}}>Reset password</button>
                    <button className="btn btn-outline-danger btn-sm" disabled={saving} onClick={() => removeCashier(cashier)}>Delete</button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : !cashiers.loading && !cashiers.error && <Empty>No cashier accounts yet.</Empty>}
        <Pagination label="Cashiers" pagination={cashiers.data?.pagination} rows={cashiers.data?.cashiers.length} onPage={setPage} />
      </section>
      {editing && (
        <Modal title={(resetting ? "Reset password: " : "Edit cashier: ") + editing.username} busy={saving} onClose={() => setEditing(null)}>
          <Notice error={manageError} />
          <form onSubmit={saveCashier}>
            <fieldset disabled={saving}>
              {resetting ? <Field label="New password"><input className="form-control" name="newPassword" type="password" autoComplete="new-password" required /></Field> : <>
                <Field label="Username"><input className="form-control" name="username" defaultValue={editing.username} required maxLength={60} /></Field>
                <Field label="Email"><input className="form-control" name="email" type="email" defaultValue={editing.email} required /></Field>
              </>}
              <button className="btn btn-primary" type="submit">{saving ? "Saving..." : resetting ? "Set new password" : "Save cashier"}</button>
            </fieldset>
          </form>
        </Modal>
      )}
    </>
  );
}
