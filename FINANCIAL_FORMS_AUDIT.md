# Mobile navigation and financial-form audit

## Supplier payment screenshot investigation

The existing route `/owner/accounts/suppliers/:supplierId` renders
`src/pages/owner/SupplierDetails.jsx`. Its current payment form already has one
searchable “Pay from (Cash / Bank)” dropdown and “Payment note (Optional)”.
There is no second implementation containing the two old labels in `src`.
The payment change is present in local commit `037df5e`.
`public/sw.js` has no fetch handler or cache. A production screenshot of the old
controls cannot be reproduced from this source; the deployed commit/assets need
manual verification. No production deployment or cache purge was performed.

## Notes

Optional ordinary descriptions:
- Supplier payment: already optional; blank uses `Supplier payment`.
- Expense description: now optional; blank uses `Shop expense`; category remains required.
- Partner contribution/withdrawal note: now optional; blank identifies the direction.
- Customer invoice payment note: now optional; blank uses `Customer invoice payment`.
- Purchase/delivery notes, supplier invoice/challan, product description and quotation
  descriptive details: existing optional behavior retained.
- Ordinary POS sale: no new note is required.

Required explanations retained:
- Starting balances, supplier historical delivery reviews, accounting activation,
  enrollment and emergency pause/resume: owner declaration / evidence.
- Customer/supplier returns, invoice adjustments and cancellations: why stock,
  debt or refunds are changing.
- All financial reversals/corrections: traceable correction reason and confirmation.
- Manual stock changes: explanation of the quantity change.
- Supplier credit/refund disposition: sensitive settlement explanation/confirmation.
- Internal/manual journal reasons: audit description remains mandatory; Cash & Bank
  does not expose an ordinary manual financial posting form.

Supplied descriptions retain existing trimming and length validation. Blank ordinary
notes receive a canonical server description before request hashing and posting.
Actor, date, amounts, accounts, confirmation phrases and request keys are unchanged.
No historical records are rewritten.

## References

No new numbering system was needed. Existing backend `references.ts` allocation
and schema hooks already issue shop-scoped PO/GR, SP/SR/SF/SC/SX, INV/QT,
CP/CR/IA/IC, EX/ER, CA/CW/CX and SA references. Manual journal/opening/transfer
references use JE/JR/OB/SO/TR where applicable. Source-linked journals retain their
source event/document relationship rather than creating a second business event.
Ordinary forms do not ask for internal transaction references. Supplier invoice /
challan identifiers remain separate optional external fields. Legacy supplied
references are preserved; no migration, counter reset or renumbering is required.

## Deployment (only after approval)

Deploy backend optional-note validation before the frontend that permits blank
notes. Deploy the matching Vercel build/commit and verify the Supplier Details route
loads the new assets. No environment changes, activation, schema changes or data
migration are required. Test financial writes only against a disposable local
replica set; these changes do not authorize production test transactions.
