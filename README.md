# DigiShop

A practical dark React/Vite frontend for the existing electrical/hardware store backend.

## Run

Use Node 22.12+ or the existing Node 24 environment:

    npm install
    npm run dev

Open http://localhost:5173. The existing backend must be running at http://localhost:3000 and allow http://localhost:5173 through CORS. Vite uses a strict port so it cannot silently move to an origin rejected by the backend.

Optional: copy .env.example to .env.local and set VITE_API_BASE_URL. Never put backend secrets in frontend environment variables.

    npm run lint
    npm test
    npm run build
    npm run preview

Preview runs on Vite's preview port; cookie-based live API use needs that origin allowed by the backend. Production hosting must rewrite application routes to index.html and configure the API origin/cookies appropriately.

## Organization

- src/api: credentialed fetch, one coordinated refresh/retry, loading hooks and sale validation.
- src/auth: in-memory session restoration and role routing. No tokens/localStorage.
- src/layouts: one compact shell with role-specific navigation.
- src/components: POS, customer picker/form, receipt and shared form/dialog helpers.
- src/pages: auth, owner, admin, and shared POS customer/quotation/voice/account workflows. Cashier directly uses POS; there is no extra cashier dashboard.
- tests: isolated fetch/sale tests and headless Chrome workflow checks. Browser checks also verify anonymous session initialization and CORS against the live backend; no real shop records are changed.

Owner: Dashboard, Products (including categories), Stock (levels/history), Sales (POS/history/details), Customers, Quotations, Create Cashier Account, Voice Stock, Account.
Cashier: POS, Customers, Quotations, Voice Stock, Account.
Admin: Shops, Account.

Receipts use the browser Print action. Immediate receipts keep product/customer labels from the completed workflow and server amounts; owner invoice detail is reopened through the backend.

Read BACKEND_GAPS.md for intentionally unsupported operations and integration limits. Manual shop access uses the focused backend changes described in SHOP_ACCESS.md.

Implementation follows the official Vite guide (https://vite.dev/guide/), React Router declarative setup (https://reactrouter.com/start/declarative/installation), and Bootstrap dark color mode (https://getbootstrap.com/docs/5.3/customize/color-modes/).

Optional browser smoke check: with the Vite dev server running and Chrome installed, run `npm run test:browser`. The workflow test intercepts authenticated API requests and does not change real store data. Its final anonymous-session check uses the live backend, which must be running. Screenshots are saved under ignored `tests/artifacts/`.

Manual shop access: ADMIN can deactivate/reactivate shops from Shops. Owner/cashier login remains available; deactivated shops show only an explanation and Sign out. Subscription controls remain separate. See SHOP_ACCESS.md.

Manual subscription renewal: public receiving details are configured in `src/config/subscriptionPayment.js`. Only ADMIN changes subscription access using the existing dashboard actions after independently verifying payment. The Owner warning links to `/owner/renew`; expired Owners see the same instructions with Sign out. Cashiers see only a contact-owner explanation. Cashier login/restoration uses the existing subscription-protected `GET /categories/` read because their session response does not include expiry.

QR asset pending: the supplied `/mnt/data/image(20261001-144437).png` was not present in this Windows workspace. Copy the original image unchanged to `public/subscription-payment-qr.png`. Until that asset is provided, the renewal view clearly states that the QR is unavailable and supplies the bank account details. No replacement QR was generated. The browser test verifies real image loading when this file exists, otherwise verifies the unavailable-QR message.
