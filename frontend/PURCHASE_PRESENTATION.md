# Purchase history and details

Frontend presentation/read aggregation only. Existing routes, creation, receiving,
returns, supplier cutovers, request keys, confirmation dialogs and permissions stay
unchanged. Other pages using PurchaseTable keep their existing presentation.

## Layout

- `/owner/purchases`: reference, date, supplier, order value, received quantity,
  net returned quantity and one View link. Existing search/status/pagination and
  create-purchase workflow remain available.
- `/owner/purchases/:purchaseId`: compact original order/supplier/date/status and
  received/returned/kept summary; per-product ordered/received/returned/kept table;
  original agreed unit costs, brands, units and notes in expandable details.
- One chronological purchase-activity register combines actual deliveries and
  receipt-linked returns/corrections, sorted by effective timestamp and ID.
  Quantities indicate goods in/out. Values are the stored goods values, not cash
  movements or supplier debt. Activity is paginated locally at 20 records.
- Receive delivery and cancel-remaining forms are expandable. Return goods remains
  available per delivery. Each activity has read-only details; return rows avoid
  duplicate details buttons. Original delivery/return forms remain in use.

## Existing API data and limitations

- GET `/purchases/` and GET `/purchases/:id` provide order snapshots and received
  quantities; they do not provide returned totals.
- The read-only loader follows all pages of GET `/purchases/:id/receipts`, then all
  pages of GET `/accounts/suppliers/:supplierId/settlements?sourceId=:receiptId`.
  No new endpoint, request field or backend calculation is introduced.
- Returned quantities subtract verified return reversals. Kept is received minus
  net recorded returns; it is never current sellable stock. Delivered quantities
  are not reduced by returns, corrections, or cancellation of unreceived goods.
- Receipt totals must agree with the order's received quantities. Duplicate,
  incomplete, foreign or inconsistent histories produce Unavailable, never guessed
  zero/kept values. The loader aborts stale requests and limits concurrent orders
  to four. It never submits mutations or updates stock optimistically.
- Supplier history requires prepared, authoritative accounting. If the backend
  blocks that read, deliveries remain visible but returned/kept totals are
  Unavailable. This restriction is not bypassed, even for deferred old deliveries.
- Completeness limits are 100 pages per history and 100 deliveries per purchase
  for return aggregation. Larger histories require a supported backend summary or
  separate review; partial totals are not labelled complete.
- These separate APIs do not expose one atomic read snapshot across all deliveries
  and returns. Detected pagination/quantity changes fail closed; Refresh reloads
  current records. No historical external activity is inferred.

## Verification

- `npm run lint`, `npm test`, `npm run build`.
- `node tests/business-workflows.mjs --purchases`: existing real business workflows
  plus a multi-product order, partial deliveries, multiple returns, return reversal,
  cancellation of the remaining order, persisted inventory/payable checks and
  screenshots at 1366, 1920, 768 and 390px.
- Screenshot artifacts are ignored under `tests/artifacts/purchase-review`.
- Financial fixtures run on disposable loopback MongoDB replica sets only.

Verified for this presentation pass: lint and production build passed; all 115
frontend automated tests passed; 37 real browser business scenario groups passed
against disposable local MongoDB 8.3.4. Persisted multi-product delivery, multiple
return, return-reversal, remaining-order cancellation, stock and payable checks
passed. Layout checks and screenshots covered all four widths above. The build
reports a non-blocking JavaScript chunk-size advisory.

The broader fixture-based browser smoke script completed its purchase assertions
but later timed out in the unrelated original-invoice receipt check
(`tests/browser-smoke.mjs`, expecting `100.00` after selecting Original invoice).
That full script is not reported as passing. Invoice rendering was not changed.
