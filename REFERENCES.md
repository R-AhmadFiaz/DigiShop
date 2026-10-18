# Automatic transaction references

New references are display identifiers, independent of request/idempotency keys,
source ObjectIds, journal links and financial calculations. Existing references,
including PO-AUTO/GR-AUTO and custom legacy identifiers, are never rewritten.

| Record | Prefix | Storage |
|---|---|---|
| Purchase order | PO | PurchaseOrder.reference |
| Goods receipt | GR | GoodsReceipt.reference |
| Supplier payment / return | SP / SR | SupplierSettlement.reference |
| Supplier refund / credit application / correction | SF / SC / SX | SupplierSettlement.reference |
| Customer invoice payment | CP | InvoiceAdjustment.reference |
| Customer return or exchange / addition-only adjustment / cancellation | CR / IA / IC | InvoiceAdjustment.reference |
| Sales invoice | INV | Order.invoiceNo (existing invoiceCounter synchronized) |
| Quotation | QT | Order.invoiceNo |
| Expense / correction | EX / ER | Expense.reference |
| Capital added / withdrawn / corrected | CA / CW / CX | CapitalEvent.reference |
| Manual stock adjustment | SA | StockLog.reference |
| Cash/bank transfer | TR | BusinessTransaction.reference |
| Manual journal / journal reversal | JE / JR | BusinessTransaction.reference |
| Cash/bank opening / supplier opening journal | OB / SO | BusinessTransaction.reference |

An invoice return/exchange remains one atomic adjustment, with one CR reference,
even when it contains both returned and added units or mixed settlement movements.
Initial sale payments retain their invoice reference rather than inventing a second
customer collection. Customer credit/debt ledger postings retain their existing
source links; they are not new transactions with separate reference sequences.
Zero-value openings with no journal retain their setup/cutover identity.

## Existing write paths audited

All paths below have the `/api/v2` prefix; no route was added or removed.

| Existing operation | References |
|---|---|
| POST /purchases/; POST /purchases/:id/receipts | PO, GR; optional legacy reference input retained |
| POST /orders/create-order; PATCH /orders/:quotationId | INV; initial payment uses this same invoice identity |
| POST /orders/quotation | QT; existing quotations without numbers stay unchanged |
| POST /orders/:orderId/payments | CP |
| POST /orders/:orderId/adjustments | CR for returns/exchanges; IA for additions only |
| POST /orders/:orderId/cancellations | IC when a settlement event is recorded |
| POST /accounts/suppliers/:id/payments, /returns, /refunds, /credit-applications | SP, SR, SF, SC; reference no longer required |
| POST /accounts/suppliers/:id/settlements/:eventId/reverse | SX; reference no longer required |
| POST /accounts/expenses; POST /accounts/expenses/:id/reverse | EX, ER |
| POST /accounts/capital; POST /accounts/capital/:id/reverse | CA/CW, CX |
| PATCH /products/:id/adjust-stock | SA |
| Existing opening/setup confirmation paths | OB/SO only where an actual opening journal exists |

Transfer and manual-journal/reversal services receive TR/JE/JR references when
used internally. They do not gain new public routes or frontend forms in this task.
Confirmation-only purchase cancellation retains its PO reference, not a second
financial event. Preview/read/search APIs allocate nothing. Products, categories,
users, parties, brands and account codes are identities rather than transactions.

## Allocation and compatibility

- Each shop stores durable `referenceCounters` keyed by prefix. The shop `_id`
  identifies one counter owner. Transactional `$inc` allocations conflict safely
  under concurrency. INV numbering uses the same allocator and synchronizes `invoiceCounter` for compatibility.
- First automatic allocation scans matching persisted references for the highest
  safe numeric suffix. PO/GR also recognize PO-AUTO/GR-AUTO and existing durable
  purchase/receipt counters. INV also respects invoiceCounter and existing invoice numbers. Unrelated custom references remain valid.
- Subsequent supplied numeric references advance the durable sequence; occupied
  identifiers are checked against all records, including legacy records.
- New supplier references are optional API inputs. Existing clients may still
  submit valid references; the application no longer asks shopkeepers to do so.
- Replay checks/hashes are unchanged and happen before new records are saved.
  Generated references never enter the original request hash. Exact retries return
  the stored record and reference, not a second posting.
- Financial/stock operations allocate inside their existing transaction. A failed
  transaction exposes no issued reference and rolls back the allocation. Quotations
  use a separate transactional counter reservation during save: failed inserts may
  leave a gap, but no committed number is recycled. No pre-save number is displayed.
- New records are marked `referenceIssued`; partial unique indexes on `(shopId,
  reference)` or `(shopId, invoiceNo)` protect new issued identifiers. Existing
  complete unique purchase/receipt/supplier-settlement indexes are reused.
  Historical empty or duplicated optional references are not modified.
- Existing stock-adjustment submit semantics are unchanged; its endpoint does not
  acquire a new retry/idempotency contract. Financial mutation request-key guards
  remain authoritative. Account codes, party codes, request keys, source IDs and
  supplier-issued invoice/challan numbers are not transaction references.

## Optional fields / frontend audit

Manual reference inputs were removed from purchases, deliveries, supplier payments,
returns, refunds, credit applications, corrections, expenses and capital forms.
Account codes remain internally generated existing identifiers; no manual code
entry is needed. Confirmed references appear in existing registers/details.

Optional supplied details are explicitly labelled `(Optional)`: external supplier
invoice/challan identifiers, purchase/delivery notes, optional party phone/address,
customer address, product/category descriptions, profile pictures and optional
POS store-credit use. Required identity, reason, payment-routing, confirmation and
opening-review inputs remain required. Search/date filters are filters, not required
transaction inputs. Conditional customer requirements are unchanged.

## Deployment considerations (not performed)

Deploy the backend before the frontend: old clients remain compatible; the new
frontend omits supplier references which the old backend requires. Ensure the new
partial unique `issued_reference` / `issued_invoiceNo` indexes are built before
enabling traffic. Existing compound unique indexes must stay in place. No index
drop, historical rewrite, counter reset, or data migration is required. If production
autoIndex is disabled, create the additive indexes through the normal reviewed
deployment procedure, using the exact current model definitions. Do not delete
durable shop counters. Production data and indexes were not accessed by this task.

## Verification

- TypeScript build passed. Full backend suite: 442 passed, none skipped
  (`node --test --test-concurrency=2 tests/*.test.mjs`). Lower concurrency avoids
  exhausting local resources while running multiple disposable replica sets.
- Frontend lint/build passed; 108 automated tests passed.
- 35 real business browser groups and 19 real invoice browser groups passed using
  disposable loopback MongoDB replica sets, real HTTP requests and transactions.
- The local production-preview contract smoke passed, including new reference-free
  forms, lost-response retries, role restrictions and optional-picture labels.
- Integration coverage includes independent shops/types, concurrent allocation,
  rolled-back allocation, deleted-record number retention, legacy counter lag,
  unique indexes, unchanged legacy records, partial receiving, payments/refunds,
  cancellations/reversals, stored balances/stock and exact-request replay.
