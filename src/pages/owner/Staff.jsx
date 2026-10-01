import { useState } from "react";
import { api } from "../../api/client";
import {
  AvatarInput,
  Field,
  Notice,
  PageTitle,
  validateAvatar,
} from "../../components/Common";
export default function Staff() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
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
    </>
  );
}
