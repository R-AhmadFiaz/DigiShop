# Frontend UX and functional audit

Completed 2026-10-01. Scope: existing frontend only. No backend edits, added business features, packages, analytics, or sample application data.

## Findings and fixes

- POS Enter could add the previous debounced search result. Enter and result buttons now wait for the current search.
- Full payment was represented by a blank field. Amount paid now visibly defaults to the total and follows it until edited. Credit opens customer selection directly. No-discount hides its unused amount control.
- Completing a sale or closing quotation conversion could race customer creation. Completion/close controls now wait for customer saving.
- POS cart retained entire product objects. Cart now explicitly copies only counter fields. Cost price remains exclusively in Owner Products; Cashier never requests low-stock, stock-history, invoice-history, categories, staff, or admin APIs.
- Unfinished carts and immediate receipts could disappear through application navigation. A small in-memory layout cache now preserves POS/quotation drafts and receipts across navigation, including browser Back. Sign-out confirms discarding unfinished carts; reload/close uses the browser warning. Nothing is stored outside the signed-in session.
- Invoice details returned to New sale and lost search/page context. History state now lives in the URL, survives reload, and returns with the same search/page.
- Cancelled receipts presented historical debt as current due. They now label it Original amount due. Cancellation still explains that cash refunds are separate.
- Quotation conversion required opening the session list. Make sale is now available immediately after creation as well as in the existing list. The session/reload limitation is stated briefly.
- Duplicate Dashboard Products/Stock buttons removed. Create Cashier replaces the misleading Staff navigation label; no staff-list controls were added.
- Customer selection contained a stray question mark separator. Fixed.
- Interrupted response bodies or unreadable successful responses could produce raw errors or false success. They now produce understandable errors; ambiguous invoice writes are never replayed.
- Invalid non-finite discount values could be treated as zero. Validation now rejects them.
- Empty audio recordings are rejected; repeated stop clicks are safe. Voice results use a responsive table.
- Table/product text and primary outline/success contrast improved; dialogs focus their first field. Admin loading feedback now identifies the action being saved.
- Browser harness now waits reliably for route/form rendering and handles aborted read requests. ESLint also checks the browser test script.

## Route and contract review

| Role / routes | Review |
| --- | --- |
| Public: login, register | Existing JSON login and multipart/avatar owner registration; safe user whitelist; cookie session initialization; no stored tokens. |
| Owner: Dashboard | Real low-stock response only; no invented analytics. |
| Owner: Products | Search, category filter/create, product create and supported price/threshold edits grouped together. Stock overwrite excluded from Edit. |
| Owner: Stock | Stock overview/low-stock filter, transactional adjustment request with reason, history/product/date filters and pagination. |
| Owner: Sales / invoice details | Retail/wholesale POS, all discount modes, credit selection, authoritative receipt; owner-only history/search/detail, delivery and eligible cancellation. |
| Owner/Cashier: Customers | Existing shop-scoped search/list/create and balance display; no edit, debt collection or ledger controls. |
| Owner/Cashier: Quotations | Existing create/convert only; session list is explicitly not backend history. |
| Owner: Create Cashier | Existing multipart/avatar creation only. |
| Owner/Cashier: Voice Stock | Audio selection/recording and stock lookup only. |
| Owner/Cashier/Admin: Account | Existing own password change; shell sign-out. |
| Cashier: POS default | No owner-management controls, costs, profits, categories, stock writes, staff or subscriptions. Wrong-role routes redirect to POS. |
| Admin: Shops default | Shop/owner/subscription data, activate with expiry-reset confirmation, extend 30 days. Wrong-role routes redirect to Shops. |

Backend mounts, request names, wrappers, validation, roles, shop scoping, status transitions and cancellation financial rules were checked against current source. Backend source/config/package hashes match the audit baseline.

## Verification

- `npm.cmd run lint`: passed, no warnings/errors.
- `npm.cmd run build`: passed.
- `npm.cmd test`: 12 passed, 0 failed. Includes coordinated refresh, missing-cookie restoration, failed refresh, exactly-one retry, no write retry on network/body failures, multipart headers, retail/wholesale totals, discounts and credit/payment/quantity validation.
- `node tests/browser-smoke.mjs`: passed in headless Chrome. Exercises role login/routing, restoration/refresh/expiry/logout, registration/avatar, product/category creation/edit/filter, manual positive/negative adjustments, low stock, history dates/pagination, customer search/create, every sale/discount mode, full/partial/credit payments, customer-required/rejected-sale recovery, receipt print output, quotation create/convert, invoice search/reload/back/cancel/deliver, cashier creation, AI upload/denied microphone, subscriptions, password change and responsive layout.
- Captured screens inspected for POS, products, stock/history, customers, voice results, receipts and admin shops. Receipt print CSS and generated browser print output checked.
- Real anonymous browser requests verified missing access/refresh status 400, login routing and credentialed CORS origin against the running backend.

Authenticated browser write workflows use isolated contract responses in the test harness, not the real database. They verify frontend behavior and requests, not actual MongoDB transactions, customer debt reversal, Cloudinary upload or OpenAI transcription. No real shop records were changed. Authenticated live cookie clearing, physical microphone recording and printer output remain unverified. A disposable test shop and role credentials would be needed for live end-to-end writes.

## Intentionally unchanged

The dark compact shell, useful Stock/Sales/Quotations tabs, cashier customer directory, role separation and existing API shapes remain. No useful shop operation was removed. Unsupported operations remain absent and documented in BACKEND_GAPS.md: quotation recovery/history, customer payment/ledger/edit/delete, staff listing/disable, product identity/category editing/deletion, refunds, analytics and fractional sale quantities. No subscription redesign or backend fixes were attempted.

Final navigation:

- OWNER: Dashboard, Products, Stock, Sales, Customers, Quotations, Create Cashier, Voice Stock; Account, Sign out.
- CASHIER: POS (default), Customers, Quotations, Voice Stock; Account, Sign out.
- ADMIN: Shops (default); Account, Sign out.
