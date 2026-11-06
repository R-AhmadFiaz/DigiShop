# Source repository audit

Audit completed before migration. All source Git commands used per-command safe.directory and GIT_OPTIONAL_LOCKS=0; no global Git configuration was changed.

Runtime: Node 24.15.0, npm 11.12.1, Git 2.53.0.windows.3. Neither source declares an engines field or contains a Node version pin. Original application manifests and lockfiles are unchanged.

## store-frontend

- Branch: main; local HEAD matches origin/main (local remote-tracking snapshot only; no network fetch).
- HEAD: `7f0979c36134ac5edad9c908081d9a212f7f6b97`.
- Reachable original commits: 43.
- Staged files: none. Non-ignored untracked files: none.
- Tracked working files: 131.
- Ignored files: 39289; original environments, generated dependencies/builds, logs and test artifacts remain in place.

Unstaged changes:

```text
 M src/components/Common.jsx
 M src/components/InvoiceHistory.jsx
 M src/components/RecordTable.jsx
 M src/components/SupplierAction.jsx
 M src/pages/owner/Invoice.jsx
 M src/pages/owner/Purchases.jsx
 M tests/browser-smoke.mjs
 M tests/invoice.test.js
 M tests/purchases.test.js
```

Ignored inventory by group:

- `*.log`: 817 files.
- `.env`: 1 files.
- `dist`: 9 files.
- `node_modules`: 37549 files.
- `tests`: 913 files.

Environment names from .env and .env.example (values intentionally omitted):

`VITE_API_BASE_URL`

## store-backend

- Branch: main; local HEAD matches origin/main (local remote-tracking snapshot only; no network fetch).
- HEAD: `d514797372a8015ffb0713d53a2caf69827774a9`.
- Reachable original commits: 76.
- Staged files: none. Non-ignored untracked files: none.
- Tracked working files: 122.
- Ignored files: 7856; original environments, generated dependencies/builds, logs and test artifacts remain in place.

Unstaged changes:

```text
 M src/controllers/invoiceAdjustment.controller.ts
 M tests/invoice-adjustment-replica.test.mjs
```

Ignored inventory by group:

- `*.log`: 73 files.
- `.env`: 1 files.
- `dist`: 316 files.
- `node_modules`: 7465 files.
- `tests`: 1 files.

Environment names from .env and .env.example (values intentionally omitted):

`ACCESS_TOKEN_EXPIRY`, `ACCESS_TOKEN_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_USERNAME`, `BUSINESS_ACCOUNTING_DEVELOPMENT_ENABLED`, `BUSINESS_ACCOUNTING_ENABLED`, `BUSINESS_ACCOUNTING_PRODUCTION_ALLOWED`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CORS_ORIGIN`, `DIGISHOP_ENV`, `MONGO_DB_URI`, `OPENAI_API_KEY`, `PORT`, `REFRESH_TOKEN_EXPIRY`, `REFRESH_TOKEN_SECRET`

## Development and deployment assumptions

Frontend scripts: dev (Vite), build, preview, lint, test, test:browser, test:smart-review. Backend scripts: dev (tsx watch), build (tsc), test (build plus Node test runner), start (dist/index.js). Frontend Vite binds localhost:5173 with strictPort. Its unchanged API fallback is localhost:3000/api/v2; backend default is 3001. Root development commands and new ignored local environments align both services to backend port 3001.

Frontend uses React, React Router and Bootstrap; backend uses Express, Mongoose, JWT, bcrypt, Cloudinary and OpenAI. Package versions remain those in the original separate manifests and lockfiles. No dependencies were consolidated.

frontend/vercel.json contains an SPA rewrite and is unchanged. No Render file or local deployment project linkage was found. Existing cloud dashboard settings and DNS were not inspected or modified. Remote repositories were identified locally as R-AhmadFiaz/electric-store-frontend and R-AhmadFiaz/electric-store-backend on GitHub; no network operations against either GitHub repository were performed.

Backend startup loads dotenv, connects to its existing database name and only then listens. Cloudinary/OpenAI and signing credentials are backend-only. Auth uses credentialed requests, so frontend origin and backend CORS must agree. Production cookie and financial/accounting flags are preserved.

## History security finding

Backend history contained .env and generated node_modules. Only an isolated backend clone was filtered to remove historical .env, node_modules and dist; original history is untouched. All 76 commits retain author/committer attribution, dates and messages. Frontend history retains all 43 original commit IDs. Both complete imported histories are ancestors of main. Automated scans of imported reachable blobs checked private current environment values and common credential/token/private-key patterns; none were detected. Such scanning does not replace private review of any credentials previously committed to the original repository.
