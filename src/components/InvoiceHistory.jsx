import { Fragment, useState } from "react";
import { query } from "../api/client";
import { useLoad } from "../api/hooks";
import { dateText, money, Notice, Pagination } from "./Common";
import { displayName } from "../utils/identity";

export function FinancialMovements({ financial = {} }) {
  const labels = {
    salesDeltaMinor: "Invoice value change", debtDeltaMinor: "Outstanding debt change",
    cashReceivedMinor: "Cash received", cashRefundMinor: "Cash refunded",
    creditRedeemedMinor: "Store credit redeemed", creditIssuedMinor: "Store credit issued",
    creditRestoredMinor: "Credit-funded payment restored to credit",
  };
  return <dl className="receipt-totals">{Object.entries(labels).map(([field, label]) =>
    financial[field] ? <Fragment key={field}><dt>{label}</dt><dd>{money(financial[field] / 100)}</dd></Fragment> : null)}</dl>;
}
export function EventDocument({ event, order }) {
  return <>
    <h3 className="h6">{event.kind.toLowerCase()} · Revision {event.revisionAfter}</h3>
    <p>{dateText(event.occurredAt)} · Recorded by {displayName(event.createdByName) || "Unavailable"}</p>
    <p>{event.reason}</p>
    {(event.movements || []).map((movement, index) => {
      const line = [...(event.before?.items || []), ...(event.after?.items || []), ...(order.items || [])].find(i => i.lineId === movement.lineId);
      return <p key={index}>{movement.kind === "RETURN" ? "Returned" : "Added"}: {line?.name || "Product unavailable"} × {movement.quantity} @ {money(movement.unitPriceMinor / 100)}{movement.disposition ? ` · ${movement.disposition === "DAMAGED" ? "Damaged — not restocked" : "Restocked"}` : ""}</p>;
    })}
    <FinancialMovements financial={event.financial} />
    {event.after && <p>Invoice total: {money(event.after.totalMinor / 100)} · Outstanding: {money(event.after.dueMinor / 100)}</p>}
  </>;
}
export default function InvoiceHistory({ order, onPrint }) {
  const [page, setPage] = useState(1);
  const history = useLoad(`/orders/${order._id}/history` + query({ page, limit: 10 }));
  return <section className="panel mt-3 no-print">
    <h2 className="h6">Adjustment and payment history</h2>
    <Notice error={history.error} loading={history.loading} />
    {history.data?.history.length === 0 && <p className="text-body-secondary">No recorded movements. Earlier payments are not inferred.</p>}
    {history.data?.history.map(event => <article key={event._id} className="border-bottom py-3">
      <EventDocument event={event} order={order} />
      <button className="btn btn-outline-secondary btn-sm" onClick={() => onPrint(event)}>Open printable record</button>
    </article>)}
    <Pagination pagination={history.data?.pagination} onPage={setPage} />
  </section>;
}
