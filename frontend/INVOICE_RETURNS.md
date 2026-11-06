# Local invoice returns and exchanges

The UI uses the contracts in `../store-backend/INVOICE_ADJUSTMENTS.md`. No
accounting, pricing, wallet or stock mutation is calculated in the browser.

## Local test steps

1. Start the backend against a **local disposable MongoDB replica set**, using
   its existing development command and local environment. Do not use production
   database credentials. Set local CORS to the frontend origin.
2. Set the frontend's existing `VITE_API_BASE_URL` to that backend's `/api/v2`,
   then run `npm run dev`. No environment files were changed by this feature.
3. Sign in as an active subscribed OWNER of the local test shop. Create an invoice
   with two units; record its seller, number, date, customer debt and product stock.
4. Sales → Invoice history → invoice → Adjust Invoice. Return one unit as Restock,
   enter a reason, Preview changes, and review the server's debt/refund allocation.
   Enter cash refund and/or store credit to match the server requirement exactly,
   preview again, acknowledge actual cash handover, and confirm once.
5. Repeat with Damaged and an addition of the same product. Check that the return
   keeps its old price, the addition gets the current server price, and damaged
   stock is not made sellable. Test full returns and both discount types too.
6. Use Receive payment for an identified customer's outstanding invoice; test
   cash, credit, and combined payment. Review the preview and confirm actual cash
   received. Check customer debt and wallet separately on Customers.
7. Test an anonymous refund: cash needs no customer; issuing credit requires a
   separate recipient. The invoice's original customer is never replaced.
8. Open original/current invoice and dated history. Open a printable history
   record and Print receipt. Verify original seller/date/number and event date.
9. Sign in as CASHIER, select a customer with issued credit in POS, enter the
   credit to use, and complete a sale. Untouched cash defaults to total less credit;
   a manually edited cash amount stays manual. Quote conversion does not use credit.
10. In a second OWNER tab, alter the invoice after preview. Confirmation must be
    rejected; close/reload and get a fresh preview. Test cancellation on a pending
    invoice via its separate preview flow; delivered invoices use returns instead.

## Lost responses

Financial mutation requests are journaled in sessionStorage, scoped to the signed-in
user's existing session ID and invoice (or POS credit sale), **before** submission. This stores request
data, not API response caches, credentials or offline sales. Reopening in the same
tab resumes the unresolved request. Check whether saved reads exact-key history;
Retry same request/sale sends the identical body/key/token. No automatic retry or
new key is generated for an uncertain mutation. Do not repeat physical cash movements.

Keep that browser tab until recovery completes. Closing it or clearing browser storage
can lose access to its recovery journal; an OWNER must
check invoice history before repeating any uncertain sale. Existing cash-only sale
creation and quotation conversion do not have backend replay keys and retain their
existing check-history-first behavior after an uncertain response.

## Verification boundary

`npm test`, `npm run lint`, `npm run build`, and `npm run test:browser` cover the UI.
Browser workflows use isolated contract responses; they do not prove MongoDB atomicity
or move real money. Run the backend replica tests and final connected local end-to-end
checks before release. Legacy reconciliation failures remain blocked by the backend;
the frontend never invents missing payment/customer/discount history. New reporting
indexes and the documented MongoDB version requirements still apply.
