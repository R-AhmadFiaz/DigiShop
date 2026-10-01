import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { useLoad } from "../../api/hooks";
import { Notice, PageTitle } from "../../components/Common";
import Receipt, { receiptFrom } from "../../components/Receipt";
export default function Invoice() {
  const [params] = useSearchParams();
  const { orderId } = useParams(),
    invoice = useLoad("/orders/" + orderId);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [confirm, setConfirm] = useState(false);
  async function action(type) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api("/orders/" + orderId + "/" + type, { method: "PATCH" });
      setSuccess(
        type === "cancel"
          ? "Invoice cancelled. Stock and recorded debt reversed."
          : "Invoice marked delivered.",
      );
      setConfirm(false);
      invoice.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const order = invoice.data?.order;
  return (
    <>
      <div className="no-print">
        <PageTitle title="Invoice">
          <Link
            to={
              "/owner/sales?" +
              new URLSearchParams({
                ...Object.fromEntries(params),
                view: "history",
              })
            }
            relative="path"
            className="btn btn-outline-secondary btn-sm"
          >
            Back to sales
          </Link>
        </PageTitle>
        <Notice
          error={error || invoice.error}
          loading={invoice.loading}
          success={success}
        />
      </div>
      {order && (
        <>
          <Receipt receipt={receiptFrom(order)} />
          {order.status === "PENDING" && (
            <div className="panel mt-3 no-print">
              {confirm ? (
                <>
                  <p>
                    Cancel this invoice? Stock and customer credit will be
                    reversed. Any money already paid must be refunded
                    separately.
                  </p>
                  <div className="d-flex gap-2">
                    <button
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={() => action("cancel")}
                    >
                      {busy ? "Cancelling..." : "Confirm cancellation"}
                    </button>
                    <button
                      className="btn btn-outline-secondary"
                      disabled={busy}
                      onClick={() => setConfirm(false)}
                    >
                      Keep invoice
                    </button>
                  </div>
                </>
              ) : (
                <div className="d-flex gap-2">
                  <button
                    className="btn btn-outline-primary"
                    disabled={busy}
                    onClick={() => action("status")}
                  >
                    {busy ? "Saving..." : "Mark delivered"}
                  </button>
                  <button
                    className="btn btn-outline-danger"
                    disabled={busy}
                    onClick={() => setConfirm(true)}
                  >
                    Cancel invoice
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
