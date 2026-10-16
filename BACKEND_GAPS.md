# Backend limits affecting this frontend

The backend was re-inspected before initial implementation. Manual shop deactivation/reactivation has since been added as a focused backend/frontend feature; other limits below remain.

- No dedicated owner/cashier shop-detail or subscription-status endpoint. Login/current-user now return the authenticated shop's shopName for OWNER/CASHIER and subscriptionExpiry for OWNER only. Registration also returns its newly created shopName. Payment-proof messages still ask the Owner to include their Shop Name. Cashier subscription blocking is detected from the existing business API's subscription rejection, without exposing payment details.
- No quotation retrieval/history endpoint. Quotes stay in memory for the signed-in session; reload/sign-out clears the visible list. The quote remains stored in the backend but cannot be recovered through its current APIs. This limitation is stated in the Quotations screen.
- Quotation conversion omits customerId and discountValue on the resulting invoice. Immediate receipts use the selected customer and server-calculated totals, but historical converted invoices may lack customer information. The frontend does not guess that association.
- Invoice details populate current product/customer names rather than immutable historical snapshots. Reprinted descriptions can differ after future changes. Missing products show Product unavailable, never raw IDs.
- No customer edit/delete, debt collection, customer ledger retrieval, product identity edit/delete, category edit/delete, staff list/edit/disable or configurable subscription duration. No controls are invented for these operations.
- Product search returns an unpaginated list and interprets search as a regular expression. Frontend search escapes regex characters and debounces requests. Very large catalogues will need backend pagination.
- Invoice creation/conversion have no idempotency key. UI disables repeated submissions and does not replay writes for timeouts/network failures. An interrupted response may still mean a sale was saved; an owner should check invoice history before repeating it. Cashiers need owner assistance for that check.
- Subscription middleware is applied inconsistently in the backend, including quotation conversion bypassing it. The frontend blocks Owner business screens at their returned expiry and blocks either shop role when the existing subscription middleware rejects a request. This does not strengthen backend enforcement for unprotected endpoints; full enforcement across all business APIs would require a separately authorized backend fix. Manual deactivation enforcement remains separate and unchanged.
- Refresh errors can use 400/401/500; refresh responses expose a refresh token. The frontend only uses cookies, keeps a whitelisted user object in memory, and never stores returned tokens. Credentialed production deployment still needs matching CORS and cookie SameSite settings. Logout cookie options differ between development creation and clearing; a live-browser check is advisable.
- Cancellation reverses stock/debt, not money already paid. The cancellation confirmation says refunds must be handled separately.
- Stock update on the product endpoint bypasses audit history. Product Edit deliberately edits prices/threshold only; stock changes use the transactional adjustment endpoint.
- Sales require integer quantities even for meter units. The POS uses whole quantities to match the backend; fractional-length sales require a backend decision.
- No currency setting or rounding policy exists. Prices are shown with two decimal places without an invented currency symbol. Backend totals are authoritative; the frontend does not silently alter credit calculations.
- AI Assistant uses UTC calendar days/months because shops have no timezone setting. Recorded sales include credit invoices and exclude quotations/cancellations; they are not cash collections. Product revenue is gross before order discounts. Current-month comparisons compare month-to-date with the complete previous month.
- Historical profit is unavailable: invoice items do not snapshot sale-time cost. Complete customer purchase history is unavailable because anonymous sales and converted invoices may lack customer associations. AI explicitly reports these limitations.
- AI depends on OpenAI availability. Questions/transcriptions are sent for intent classification; database results are formatted locally and are not sent to the AI provider. Audio is removed after processing. Lookup results are capped (20 products, 10 customers, 10 ranked products).
- JSON requests are limited to 16 KB. Unusually large carts can exceed that limit; no bulk sales workflow is promised.

Manual subscription payment instructions are public receiving details only. There are no payment records, payment verification endpoints, automatic renewal, payment/refund services, PDF libraries, or unsupported management functions.

### Business Accounts — Phase 3B frontend boundaries

- Accounts management is OWNER-only. CASHIER retains its existing Customers/POS experience and cannot open Owner Accounts routes; ADMIN is unchanged.
- Companies and customer links reuse existing identities. Product brand text is not an automatic company association; the separate registered-brand links are explicit.
- Supplier purchases, payments and balances are not implemented. No controls imply these are available.
- Cash/bank creation and prepared account balances/history require explicitly enabled backend test accounting and approved opening/cutover evidence. The frontend does not enable accounting, configure cutover or issue opening balances. Unavailable values are not displayed as zero.
- The financial list endpoint returns paginated account metadata across kinds, without a kind filter. Cash & Bank shows cash/bank rows on each server page and retains that pagination. Transactions can select any listed account, but unsupported/unprepared balances and histories remain blocked by the server.
- Transactions are per-account statements, never an invented combined financial report. UTC date filters use inclusive From/exclusive Before. Search-filtered running balances may be unavailable; no client-side balance reconstruction is attempted.
- Customer balance details use the existing read-only reconciliation endpoint. Customer debt and store credit remain distinct and no entries or balances are changed by viewing them.
