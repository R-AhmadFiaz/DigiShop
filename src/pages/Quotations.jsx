import { useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api/client";
import {
  dateText,
  Empty,
  Field,
  Modal,
  money,
  Notice,
  PageTitle,
} from "../components/Common";
import POS from "../components/POS";
import Receipt, { receiptFrom } from "../components/Receipt";
import CustomerPicker from "../components/CustomerPicker";
export default function Quotations() {
  const { quotations, setQuotations } = useOutletContext();
  const [tab, setTab] = useState("new"),
    [selected, setSelected] = useState(null),
    [converting, setConverting] = useState(null);
  return (
    <>
      <PageTitle title="Quotations" />
      <p className="text-body-secondary no-print small">
        Reloading or signing out clears this quotation list.
      </p>
      <div className="screen-tabs no-print">
        <button
          className={tab === "new" ? "active" : ""}
          onClick={() => setTab("new")}
        >
          New quotation
        </button>
        <button
          className={tab === "session" ? "active" : ""}
          onClick={() => setTab("session")}
        >
          This session ({quotations.length})
        </button>
      </div>
      <div hidden={tab !== "new"}>
        <POS
          quotation
          onConvertQuotation={(id) =>
            setConverting(
              quotations.find(
                (draft) => draft.order._id === id && !draft.converted,
              ),
            )
          }
        />
      </div>
      {tab === "session" && (
        <>
          {selected ? (
            <>
              <Receipt receipt={selected} />
              <button
                className="btn btn-outline-secondary mt-3 no-print"
                onClick={() => setSelected(null)}
              >
                Back to quotations
              </button>
            </>
          ) : (
            <section className="panel">
              {quotations.length === 0 ? (
                <Empty>No quotations created in this session.</Empty>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm align-middle">
                    <thead>
                      <tr>
                        <th>Created</th>
                        <th>Products</th>
                        <th>Total</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {quotations.map((draft) => (
                        <tr key={draft.order._id}>
                          <td>{dateText(draft.order.createdAt)}</td>
                          <td>
                            {draft.receipt.lines
                              .map((line) => line.name)
                              .join(", ")}
                          </td>
                          <td>{money(draft.order.totalPrice)}</td>
                          <td>{draft.converted ? "Converted" : "Draft"}</td>
                          <td>
                            <div className="d-flex gap-2">
                              <button
                                className="btn btn-outline-secondary btn-sm"
                                onClick={() => setSelected(draft.receipt)}
                              >
                                {draft.converted ? "View invoice" : "View"}
                              </button>
                              {!draft.converted && (
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={() => setConverting(draft)}
                                >
                                  Make sale
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
      {converting && (
        <Convert
          draft={converting}
          onClose={() => setConverting(null)}
          onSaved={(receipt) => {
            setQuotations((current) =>
              current.map((draft) =>
                draft.order._id === converting.order._id
                  ? { ...draft, converted: true, receipt }
                  : draft,
              ),
            );
            setConverting(null);
            setSelected(receipt);
            setTab("session");
          }}
        />
      )}
    </>
  );
}
function Convert({ draft, onClose, onSaved }) {
  const [paid, setPaid] = useState(String(draft.order.totalPrice)),
    [customer, setCustomer] = useState(null),
    [busy, setBusy] = useState(false),
    [customerBusy, setCustomerBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    amount = Number(paid),
    due = draft.order.totalPrice - amount;
  async function submit(e) {
    e.preventDefault();
    if (lock.current || customerBusy) return;
    setError("");
    if (paid === "" || !Number.isFinite(amount) || amount < 0 || due < 0) {
      setError("Enter a paid amount between zero and the quotation total.");
      return;
    }
    if (due > 0 && !customer) {
      setError("Select a customer for this credit sale.");
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const result = await api("/orders/" + draft.order._id, {
        method: "PATCH",
        body: {
          paidAmount: amount,
          ...(customer ? { customerId: customer._id } : {}),
        },
      });
      onSaved(receiptFrom(result.createOrder, draft.products, customer));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <Modal
      title="Convert quotation to sale"
      onClose={onClose}
      busy={busy || customerBusy}
    >
      <p>
        Total: <strong>{money(draft.order.totalPrice)}</strong>
      </p>
      <Notice error={error} />
      <form id="convert-quotation" onSubmit={submit}>
        <fieldset disabled={busy}>
          <Field label="Amount paid">
            <input
              className="form-control"
              type="number"
              min="0"
              max={draft.order.totalPrice}
              step="any"
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              required
            />
          </Field>
          <p>Amount due: {money(Math.max(0, due))}</p>
        </fieldset>
      </form>
      <fieldset disabled={busy}>
        <div className="mb-3">
          <p className="small">
            {due > 0 ? "Customer required" : "Customer (optional)"}
          </p>
          <CustomerPicker
            value={customer}
            onChange={setCustomer}
            required={due > 0}
            onBusy={setCustomerBusy}
          />
        </div>
        <button
          className="btn btn-primary"
          type="submit"
          form="convert-quotation"
          disabled={customerBusy}
        >
          {busy ? "Saving..." : "Complete sale"}
        </button>
      </fieldset>
    </Modal>
  );
}
