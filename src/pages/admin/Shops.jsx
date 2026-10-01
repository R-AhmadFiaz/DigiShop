import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useLoad } from "../../api/hooks";
import { adminShopRows, shopSubscription } from "../../api/subscription";
import { dateText, Empty, Notice, PageTitle } from "../../components/Common";

export default function Shops() {
  const shops = useLoad("/admin/shops");
  const [search, setSearch] = useState(""),
    [updates, setUpdates] = useState({}),
    [now, setNow] = useState(Date.now),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
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
  const rows = adminShopRows(
    (shops.data?.shops || []).map((shop) => updates[shop._id] || shop),
    search,
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
        value={search}
        onChange={(e) => setSearch(e.target.value)}
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
      </section>
    </>
  );
}
