import { useEffect, useState } from "react";
import { api, query } from "../../api/client";
import { useDebounce, useLoad } from "../../api/hooks";
import { usePageParam, useQueryParam } from "../../api/paging";
import { adminShopRows, shopSubscription } from "../../api/subscription";
import { dateText, Empty, Modal, Notice, PageTitle, Pagination } from "../../components/Common";

export default function Shops() {
  const [search, setSearch] = useQueryParam("search"),
    [page, setPage] = usePageParam();
  const term = useDebounce(search.trim());
  const shops = useLoad("/admin/shops" + query({ page, limit: 20, search: term }));
  const [updates, setUpdates] = useState({}),
    [now, setNow] = useState(Date.now),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const [deleting, setDeleting] = useState(null),
    [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 60000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  async function action(shop, type) {
    const subscription = shopSubscription(shop);
    const subscriptionAction = type === "activate" || type === "extend";
    const label = subscriptionAction
      ? subscription.actionLabel
      : type === "deactivate"
        ? "Deactivate"
        : "Reactivate";
    const confirmation =
      type === "deactivate"
        ? "Deactivate " +
          shop.name +
          "? Owner and cashier shop operations will stop. Existing data will be kept."
        : type === "reactivate"
          ? "Reactivate " +
            shop.name +
            "? Shop operations will resume if the subscription is valid."
          : label +
            " for " +
            shop.name +
            "? " +
            (subscription.status === "Active" ||
            subscription.status === "Expiring Soon"
              ? "30 days will be added to its current expiry."
              : "The 30-day period starts now.");
    if (!window.confirm(confirmation)) return;
    setBusy(shop._id);
    setError("");
    setSuccess("");
    try {
      const result = await api("/admin/shops/" + shop._id + "/" + type, {
        method: "PATCH",
      });
      // Mutation responses do not populate the owner; retain the list's owner labels.
      setUpdates((current) => ({
        ...current,
        [shop._id]: { ...shop, ...result.shop, ownerId: shop.ownerId },
      }));
      setNow(Date.now());
      setSuccess(
        shop.name +
          (type === "deactivate"
            ? " deactivated."
            : type === "reactivate"
              ? " reactivated."
              : type === "activate"
                ? " activated for 30 days."
                : subscription.status === "Expired"
                  ? " renewed for 30 days."
                  : " extended by 30 days."),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  async function removeShop(event) {
    event.preventDefault();
    if (busy || confirmation !== "DELETE" || deleting?.isActive !== false) return;
    setBusy(deleting._id);
    setError("");
    setSuccess("");
    try {
      await api("/admin/shops/" + deleting._id, { method: "DELETE" });
      setUpdates((current) => ({ ...current, [deleting._id]: null }));
      setSuccess(deleting.name + " permanently deleted.");
      // Refill the page from the server so the next shop moves up.
      shops.reload();
      setDeleting(null);
      setConfirmation("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  // The server searches, orders and pages; this keeps a changed row in its
  // current page, re-sorted with the same rules, until the next refresh.
  const rows = adminShopRows(
    (shops.data?.shops || [])
      .filter((shop) => updates[shop._id] !== null)
      .map((shop) => updates[shop._id] || shop),
    "",
    now,
  );
  return (
    <>
      <PageTitle title="Shops">
        <button
          className="btn btn-outline-secondary btn-sm"
          disabled={shops.loading || Boolean(busy)}
          onClick={() => {
            setUpdates({});
            setNow(Date.now());
            shops.reload();
          }}
        >
          Refresh
        </button>
      </PageTitle>
      <input
        className="form-control search-input mb-3"
        aria-label="Search shops"
        placeholder="Shop, contact or owner"
        maxLength={100}
        value={search}
        onChange={(e) => setSearch(e.target.value, ["page"])}
      />
      <Notice error={error} success={success} />
      <section className="panel">
        <Notice error={shops.error} loading={shops.loading} />
        {rows.length ? (
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  {[
                    "Shop",
                    "Owner",
                    "Contact",
                    "Manual Access",
                    "Subscription",
                    "Expiry",
                    "Time Left",
                    "Actions",
                  ].map((title) => (
                    <th key={title}>{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ shop, subscription }) => (
                  <tr key={shop._id}>
                    <td>
                      <strong>{shop.name}</strong>
                      <small className="d-block text-body-secondary">
                        {shop.address}
                      </small>
                    </td>
                    <td>
                      {shop.ownerId?.username || "Owner unavailable"}
                      <small className="d-block text-body-secondary">
                        {shop.ownerId?.email}
                      </small>
                    </td>
                    <td>{shop.contactNo || "-"}</td>
                    <td>
                      <span
                        className={
                          shop.isActive === false
                            ? "text-warning"
                            : "text-success"
                        }
                      >
                        {shop.isActive === false ? "Deactivated" : "Active"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={
                          subscription.status === "Active"
                            ? "text-success"
                            : "text-warning"
                        }
                      >
                        {subscription.status}
                      </span>
                    </td>
                    <td>
                      {Number.isFinite(subscription.expiryTime)
                        ? dateText(shop.subscriptionExpiry)
                        : "-"}
                    </td>
                    <td>{subscription.timeLeft}</td>
                    <td>
                      <div className="d-flex gap-2 flex-wrap">
                        {subscription.action && (
                          <button
                            className="btn btn-outline-primary btn-sm text-nowrap"
                            disabled={Boolean(busy) || shops.loading}
                            onClick={() => action(shop, subscription.action)}
                          >
                            {busy === shop._id
                              ? "Saving..."
                              : subscription.actionLabel}
                          </button>
                        )}
                        <button
                          className={
                            shop.isActive === false
                              ? "btn btn-outline-secondary btn-sm"
                              : "btn btn-outline-danger btn-sm"
                          }
                          disabled={Boolean(busy) || shops.loading}
                          onClick={() =>
                            action(
                              shop,
                              shop.isActive === false
                                ? "reactivate"
                                : "deactivate",
                            )
                          }
                        >
                          {shop.isActive === false
                            ? "Reactivate"
                            : "Deactivate"}
                        </button>
                        {shop.isActive === false && (
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={Boolean(busy) || shops.loading}
                            onClick={() => {
                              setDeleting(shop);
                              setConfirmation("");
                              setError("");
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !shops.loading && !shops.error && <Empty>No shops found.</Empty>
        )}
        <Pagination label="Shops" pagination={shops.data?.pagination} rows={shops.data?.shops.length} onPage={setPage} />
      </section>
      {deleting && (
        <Modal title="Permanently delete shop" busy={Boolean(busy)} onClose={() => setDeleting(null)}>
          <p>Delete <strong>{deleting.name}</strong>? This permanently removes the shop, owner/cashier accounts and all shop data. This action is irreversible.</p>
          <Notice error={error} />
          <form onSubmit={removeShop}>
            <label className="form-label" htmlFor="delete-confirmation">Type DELETE to confirm</label>
            <input id="delete-confirmation" className="form-control mb-3" value={confirmation} disabled={Boolean(busy)} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />
            <div className="d-flex gap-2">
              <button className="btn btn-outline-secondary" type="button" disabled={Boolean(busy)} onClick={() => setDeleting(null)}>Cancel</button>
              <button className="btn btn-danger" type="submit" disabled={confirmation !== "DELETE" || Boolean(busy)}>{busy ? "Deleting..." : "Permanently delete"}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
