# DigiShop local migration report

Local migration is complete and ready for review. Nothing has been pushed or deployed. Build and unit/integration tests pass; the optional broad browser smoke test has an unresolved customer-navigation failure described below.

## 1. Final directory structure

```text
C:\projects\digishop\
  frontend/                  React/Vite application, tests and separate lockfile
  backend/                   Express/TypeScript application, tests and separate lockfile
  scripts/                   Root command runner and test network guard
  docs/                      Audit and file/hash import manifest
  package.json
  package-lock.json
  README.md
  MIGRATION_REPORT.md
  .gitignore
  .nvmrc
  .git/                      The only Git repository in the new checkout
```

Ignored local environment files use dummy credentials and loopback addresses. Dependencies, dist output, screenshots and test PDFs are ignored.

## 2. Git history preservation

- Frontend: all 43 commits retain original IDs; source tip 7f0979c36134ac5edad9c908081d9a212f7f6b97.
- Backend: all 76 commits preserve authors, committer attribution, dates and messages. Commit IDs were rewritten in a temporary clone to remove historical .env, node_modules and dist. Sanitized tip: b88d8da557167ac8c67137923dbb9b3eed05c7cf. The original backend history is unchanged.
- Two-parent import commit: a3c3fb13cb0d84287a675e73b23195de7b06afa2. Its parents are the frontend tip and sanitized backend tip. Local archive/frontend/main and archive/backend/main retain those imported histories. Main includes both histories when pushed.
- A separate local commit preserves all 11 originally modified files, including unfinished purchase confirmation changes. Subsequent changes affect test paths, root tooling and documentation.
- Historical commits keep their original root layout; current main uses the two application subdirectories. No raw backend history or nested source .git directory was imported.

Contributor/date/message metadata was compared across all original and imported application commits and matched exactly.

## 3. Original repository status

Both originals remain at their original main HEADs, with nine unstaged frontend changes and two unstaged backend changes. Neither had staged files or non-ignored untracked files. All tracked working-file hashes, original .env hashes, Git index/config hashes, refs, status and ignored-file inventories were compared after migration and matched. No original file, branch, remote or configuration was intentionally modified.

The audit recorded 39,289 ignored frontend files and 7,856 ignored backend files, largely dependencies. Environments, build output, logs and test artifacts remain in the originals. No original repository was deleted, reset, overwritten or archived.

## 4. Files imported

131 frontend and 122 backend tracked files were imported: 253 total, with no missing application source. Every application source file matches its original working copy byte-for-byte. Six test files received sibling path substitutions only. See docs/import-manifest.json for SHA-256 hashes, original dirty status and adapted file names; docs/AUDIT.md contains the audit. Generated dependencies, builds, logs and artifacts were re-created where needed instead of copied. Original private environments were not copied.

## 5. Root development commands

| Command | Behavior |
| --- | --- |
| npm install | Install both applications independently with npm ci |
| npm run dev | Start both applications; stop their process trees on exit |
| npm run dev:frontend | Start Vite |
| npm run dev:backend | Start the backend watcher |
| npm run build | Existing frontend build, then backend TypeScript build |
| npm run test | Both existing suites with isolated environment and loopback-only network access |

Default frontend port is 5173; backend/API port is 3001 with /api/v2. Use FRONTEND_PORT and PORT overrides if existing services occupy those ports. Each app still has its own install/build/test/dev commands and separate dependencies.

## 6. Verification results

| Check | Result |
| --- | --- |
| Frontend and backend clean dependency installation | PASS: npm ci from local cache; original lockfiles unchanged |
| Frontend production build | PASS |
| Backend TypeScript build | PASS |
| Frontend suite | PASS: 166 tests, zero failures/skips |
| Backend suite | PASS: 459 tests, zero failures/skips; disposable loopback replica sets |
| Root local development startup | PASS: frontend port 51294, backend port 51293 |
| Served frontend API URL and credentialed CORS | PASS against the isolated backend |
| Anonymous auth initialization | PASS: missing-cookie contracts; zero business documents created |
| Existing broad headless Chrome browser smoke | FAIL: customer navigation keyboard flow timed out before purchase-order checks |
| Nested Git repositories | None found, including installed application directories |
| Tracked private environments / detected secrets | None found in current files or imported reachable history |
| Source completeness / original repository preservation | PASS via hashes and Git state comparisons |
| Git object integrity | PASS: git fsck --full |

The browser harness was run from a temporary copy with only localhost ports substituted so existing services could stay running. It timed out waiting for /owner/customers/invoices after keyboard navigation in the Customers dropdown (original harness line 1442). The original modified browser harness and all application sources are preserved. No assertion was removed, and no application behavior was changed to make it pass. This optional full-browser verification remains unresolved; purchase confirmation has passing frontend unit tests, but its later browser-smoke steps were not reached.

Existing warnings: Vite reports a frontend bundle over 500 kB, frontend test Vite instances report HMR port contention, and Mongoose reports deprecated new options. They do not fail the build or unit/integration suites.

All startup/browser processes created for verification were stopped. Existing services on 5173/3001 were left running. No financial mutations were sent to shared Atlas; backend suite writes occurred only in test-created disposable databases, and browser authenticated writes used mocked responses.

## 7. Environment and deployment considerations

README.md documents all required environment variable names, local configuration and future deployment steps. Private values never appear in this report. Source .env files remain in their original locations. Root tests bypass dotenv and enforce loopback network access. Development backend environments point to local MongoDB; use a replica set for transactions. Do not use shared Atlas for verification.

No Vercel, Render, DNS, domain or GitHub settings were changed. frontend/vercel.json is unchanged. No Render config file was found; dashboard configuration was not queried. After separate approval, Vercel would use root frontend/build npm run build/output dist, and Render would use root backend/build npm ci && npm run build/start npm start. Review environment, cookies, CORS, upload persistence and Node runtime before any dashboard migration.

## 8. Remaining migration risks

- Resolve or explicitly accept the broad browser smoke failure before treating UI regression verification as complete. Fixes belong in a separate, scoped application task.
- Backend historical .env required sanitization. Privately review what it contained and rotate any real credentials if necessary; sanitizing this import does not change or revoke anything in the original local/GitHub repository.
- Fresh deployment settings and production credentials still require manual review and explicit approval. Local verification does not establish production integration health.
- Existing application browser/database harnesses assume Windows Chrome and MongoDB executable paths; backend integration suites will skip without that MongoDB installation.
- Original uncommitted work is preserved in a local migration commit and still needs team review. No accounting or business logic was changed.

## 9. Exact commands for a new GitHub repository

After explicit publication approval, create an empty private GitHub repository without initial files, replace OWNER/REPOSITORY and run:

```powershell
cd C:\projects\digishop
git status --short
git remote add origin https://github.com/OWNER/REPOSITORY.git
git remote -v
git push -u origin main
```

Main includes both imported histories. Do not use --mirror, --all or force-push. These publishing commands have not been executed. There is currently no remote in the monorepo. Do not change deployment settings, archive old repositories or change domains without separate approval.
