# DigiShop

DigiShop combines the React/Vite frontend and Express/TypeScript backend in one repository. Each application retains its own package manifest, lockfile and dependencies. Application and accounting behavior are unchanged.

## Requirements and installation

Use Node 24 (verified with 24.15.0) and npm 11. Node 22.12+ is declared compatible by the existing frontend documentation; it was not separately verified. No npm workspaces or dependency hoisting are enabled.

```powershell
cd C:\projects\digishop
npm install
```

The root install script runs `npm ci` independently in frontend and backend. For explicit installation: `npm --prefix frontend ci` and `npm --prefix backend ci`. Use `npm ci` at root once a root lockfile is available.

## Environment

On a fresh clone copy each application's `.env.example` to its local `.env`; replace placeholders locally. The migration intentionally does not copy the original private environment files. Local ignored files in this checkout use loopback addresses and dummy credentials only. Never commit real environments, keys, tokens, database URIs containing credentials, or logs. Variables prefixed VITE_ are public browser configuration.

Frontend: `VITE_API_BASE_URL` (local value `http://localhost:3001/api/v2`). Backend names documented in its existing template:

- `ACCESS_TOKEN_EXPIRY`
- `ACCESS_TOKEN_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_USERNAME`
- `BUSINESS_ACCOUNTING_DEVELOPMENT_ENABLED`
- `BUSINESS_ACCOUNTING_ENABLED`
- `BUSINESS_ACCOUNTING_PRODUCTION_ALLOWED`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_CLOUD_NAME`
- `CORS_ORIGIN`
- `DIGISHOP_ENV`
- `MONGO_DB_URI`
- `OPENAI_API_KEY`
- `PORT`
- `REFRESH_TOKEN_EXPIRY`
- `REFRESH_TOKEN_SECRET`

Additional backend runtime variable: `NODE_ENV`. Feature flags retain their existing behavior; do not enable accounting flags to run the migration. Cloudinary/OpenAI credentials are needed only for those integrations; local dummy values do not enable them. Admin variables support the existing separate admin-creation utility; do not run it against shared databases during verification.

The backend appends its existing database name `inventory-store` to `MONGO_DB_URI`; supply a MongoDB server base URI, not a URI already containing a database or query parameters. Transactions require a replica set. Use a disposable local replica set for development and tests, never shared Atlas for test mutations. Original credentials remain in the untouched original repositories; an isolated temporary history clone also holds the original historical Git objects and must never be published. No original environment file is copied to this checkout.

## Development

```powershell
npm run dev
npm run dev:frontend
npm run dev:backend
```

Frontend: http://localhost:5173 (strict port). Backend: http://localhost:3001, API prefix /api/v2. Start local MongoDB before the backend. Root development commands set a matching API URL, backend PORT and CORS_ORIGIN; shell overrides are supported. Ctrl+C stops the started service trees.

Each app remains independently runnable: `cd frontend; npm run dev` or `cd backend; npm run dev`. Configure their own local environment first: the unchanged frontend fallback is port 3000, while the backend fallback is 3001. Use the matching environment values above. Preview uses Vite's separate preview port and needs that origin in CORS if calling the backend.

## Build and test

```powershell
npm run build
npm run test
npm --prefix frontend run lint
```

Root build runs the existing frontend build then backend TypeScript build. Root test runs both existing suites (backend test also builds). Tests run with NODE_ENV=test, dotenv pointed away from private environments, placeholder signing keys and a loopback-only network guard inherited by Node children. Backend database tests launch disposable local replica sets and skip if the existing hardcoded MongoDB executable at C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe is unavailable. Do not interpret skipped integration suites as passing database verification. They use temporary data directories and random loopback ports.

Optional frontend browser tests use `npm --prefix frontend run test:browser`, require Chrome at the existing Windows path and a frontend on 5173. The harness mocks authenticated APIs but ends with an anonymous live API/CORS check; run it only with an isolated local backend configured on its expected port 3000. Backend invoice/supplier browser harnesses and frontend workflow harnesses now use monorepo sibling paths.

## Contributions

Create a feature branch from main; scope changes to frontend, backend or root tooling; keep commits focused. Run root build and test before a PR and include relevant browser checks for UI changes. Review financial behavior with the accounting owner. Review staged files for secrets. Keep each app's lockfile in sync with its own package changes. Do not merge or publish unfinished confirmation work without review. See docs/import-manifest.json for source hashes and migration adaptations.

## Future deployment (manual approval required)

No GitHub, Vercel, Render, DNS or domain settings were changed. Existing frontend/vercel.json is preserved byte-for-byte and contains the SPA rewrite. No Render configuration file was found in the source repositories; current dashboard settings were not inspected.

After explicit approval, configure Vercel's project root as frontend, install npm ci, build npm run build and output dist. Set VITE_API_BASE_URL to the approved backend URL including /api/v2 at build time. Preserve the existing rewrite, domains and DNS.

For Render, configure root backend, install/build npm ci && npm run build, start npm start, and the existing approved Node runtime and secret environment. Render supplies PORT; set CORS_ORIGIN to the approved frontend origin, preserve cookie/HTTPS assumptions, persistent upload requirements and Atlas access rules. Review service working directory before changing the source repository. Do not migrate dashboards or domains as part of this local work.

## History and publishing

All 43 frontend commits retain their original IDs. All 76 backend commits retain their authors, dates and messages, but IDs change because a separate clone was filtered to remove historical .env, node_modules and dist. No raw backend history is imported. Local archive/frontend/main and archive/backend/main branches retain the respective imported tips, joined by a two-parent import commit. The original backend repository still contains its historical .env and must be reviewed separately before any future publication. A separate migration commit preserves the dirty working code; later changes affect root tooling and test paths only. No nested .git directories are copied. Historical commits retain their original root layouts; current main uses frontend/ and backend/.

Create an empty private GitHub repository only after review. Then replace OWNER/REPOSITORY below:

```powershell
cd C:\projects\digishop
git remote add origin https://github.com/OWNER/REPOSITORY.git
git remote -v
git push -u origin main
```

Pushing main includes both histories through its parent graph. Archive branches are optional; do not use --mirror or --all. This checkout intentionally has no remote. Publishing and deployment require separate explicit approval.
