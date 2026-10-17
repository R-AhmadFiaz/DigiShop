# Category isolation and new-supplier setup

No production database connections, index changes or migrations were performed.

## Categories

`Wire&Cables` is valid and generates `wireandcables`. The current schema has
unique `{shopId:1,name:1}` and `{shopId:1,slug:1}` indexes. Plain name/slug
indexes are nonunique. Creation/listing and product category assignment/search
are shop-scoped. There are no category update/delete routes. Different shops
may use the same category name. Within one shop, slug-equivalent spellings
(e.g. WireandCables) conflict intentionally.

Mongoose creating declared indexes does not remove obsolete global unique
indexes. Tests reproduce cross-shop failure with a global unique slug index.
Production's actual indexes and original failed response require manual
confirmation; the ampersand alone is not a validation failure.

### Conditional, manually approved production index maintenance

1. Verify the Atlas project/database and a restorable backup. Pause category
   creation during maintenance; preserve `db.categories.getIndexes()` output.
2. Inspect missing shopId/name/slug and per-shop duplicates:
   `db.categories.aggregate([{$group:{_id:{shopId:'$shopId',slug:'$slug'},count:{$sum:1}}},{$match:{count:{$gt:1}}}])`.
   Repeat for name. Stop for explicit review if anomalies exist. Do not
   automatically delete, rename or reassign records.
3. Ensure unique, non-partial, default-collation compound indexes exist:
   `db.categories.createIndex({shopId:1,name:1},{unique:true})` and
   `db.categories.createIndex({shopId:1,slug:1},{unique:true})`.
   If existing index options conflict, stop and review the exact definitions.
4. Only after verifying compound protection, drop obsolete GLOBAL UNIQUE
   indexes with exact key `{name:1}` or `{slug:1}`, using their inspected names.
   Do not drop nonunique or unrelated indexes. Recreate nonunique single-field
   indexes if necessary to match the schema. Never use syncIndexes/dropIndexes.
5. Verify metadata and approved disposable fixtures: same name across shops
   succeeds, same-shop duplicates return 409, lists remain isolated. Resume
   category creation.

Existing valid category IDs/names remain unchanged. No record migration is
needed. Do not restore global uniqueness after legitimate cross-shop names
exist. A code rollback must retain shop-scoped constraints.

Related product, entity, brand, purchase, receipt, cutover and journal queries
and unique constraints are shop-scoped. User username/email and Shop contact/
owner uniqueness are intentionally global and unchanged. Product category
population assumes valid existing references; historical corruption requires
separate evidence review, not automatic reassignment.

## New supplier after shop activation

Activation does not prepare suppliers added afterward. Every supplier needs an
explicit reviewed opening. Missing cutover blocks receiving before stock writes.

Supplier Account now offers **Review zero opening for new supplier** only when
there are no deliveries or previous cutover. OWNER acknowledges no earlier debt
or deliveries and confirms the dialog. Existing historical opening stays available.

The existing POST `/api/v2/accounts/suppliers/:id/cutover` accepts
`enrollNewSupplier:true`, the existing confirmation/key/cutoff/evidence/reason,
`openingBalanceMinor:0`, `otherOpeningMinor:0`, `reviews:[]`. Account-ID overrides
are rejected. Server creates dedicated same-shop payable, purchases clearing
and opening equity accounts in the existing transaction and reuses the immutable
cutover checks. No automatic opening, cash movement or zero-value journal.

Existing deliveries prohibit this shortcut and must use full historical review.
Stale evidence and invalid inputs roll back all account creation. Exact retries
remain idempotent after later receipts. New receipts must be strictly after cutoff.
Accounting permission, shop activation, subscription and OWNER restrictions remain.

After preparing the supplier, return to the EXISTING purchase order and receive
the delivery. Failed receiving has not consumed stock, debt, receipts, logs or PO
revision; no recovery/recreation is required for this failure path. Receiving
continues to atomically commit stock, logs, receipt, PO progress and payable journal.

Verified fresh activated shop, cash opening zero: 10 coils at PKR 3,000; receiving
5 gives stock 5 / payable PKR 15,000; remaining 5 gives stock 10 / payable PKR 30,000.
Cash remains zero. Duplicate and concurrent identical receiving cannot double-post.
No supplier schema/index migration is required.

Deploy backend before frontend when approved. No environment/activation changes
are required. Production index repair is separate and only needed if inspection
confirms obsolete global unique category constraints. Nothing is deployed here.
