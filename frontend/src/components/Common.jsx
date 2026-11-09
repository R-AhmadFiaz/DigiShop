import { useEffect, useId, useRef } from "react";
import { clampedPage, pageRange } from "../api/paging";
export const money = (value) =>
  Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export const dateText = (value) =>
  value ? new Date(value).toLocaleString() : "-";
export function Notice({ error, success, loading }) {
  return (
    <>
      {error && (
        <div className="alert alert-danger py-2" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="alert alert-success py-2" role="status">
          {success}
        </div>
      )}
      {loading && (
        <p className="text-body-secondary" role="status">
          Loading...
        </p>
      )}
    </>
  );
}
export function Field({ label, children, hint }) {
  return (
    <label className="form-label d-block">
      {label}
      {children}
      {hint && (
        <small className="text-body-secondary d-block mt-1">{hint}</small>
      )}
    </label>
  );
}
export function Pagination({ pagination, onPage, label = "List", rows }) {
  const ref = useRef(null);
  const correction = clampedPage(pagination);
  // A page past the end (old link, rows removed) moves to the last real page
  // instead of showing an empty list with no controls.
  useEffect(() => {
    if (correction !== null) onPage(correction);
  }, [correction, onPage]);
  if (!pagination || correction !== null) return null;
  const range = pageRange(pagination, rows);
  if (pagination.totalPages < 2) return null;
  const go = (page) => {
    onPage(page);
    requestAnimationFrame(() => {
      const region = ref.current?.closest("section, .panel, dialog, details") || ref.current;
      if (region && region.getBoundingClientRect().top < 0) region.scrollIntoView({ block: "start" });
    });
  };
  const first = pagination.currentPage <= 1,
    last = pagination.currentPage >= pagination.totalPages;
  return (
    <nav ref={ref} className="list-pagination d-flex flex-wrap align-items-center gap-2 mt-3" aria-label={label + " pages"}>
      <button className="btn btn-outline-secondary btn-sm" type="button" disabled={first} onClick={() => go(1)} aria-label={"First page of " + label}>
        First
      </button>
      <button className="btn btn-outline-secondary btn-sm" type="button" disabled={first} onClick={() => go(pagination.currentPage - 1)}>
        Previous
      </button>
      <span aria-live="polite">
        Page {pagination.currentPage} of {pagination.totalPages}
        {range && (
          <span className="text-body-secondary">
            {" "}· {range.first}–{range.last} of {range.total}
          </span>
        )}
      </span>
      <button className="btn btn-outline-secondary btn-sm" type="button" disabled={last} onClick={() => go(pagination.currentPage + 1)}>
        Next
      </button>
      <button className="btn btn-outline-secondary btn-sm" type="button" disabled={last} onClick={() => go(pagination.totalPages)} aria-label={"Last page of " + label}>
        Last
      </button>
    </nav>
  );
}
export function Modal({ title, onClose, children, busy = false, wide = false, trapFocus = false }) {
  const ref = useRef(null);
  const headingId=useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
      (dialog.querySelector('[data-modal-initial-focus]')||dialog.querySelector("input:not([type=hidden]), select, textarea"))?.focus({preventScroll:true});
    dialog.scrollTop=0;
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "shop-dialog shop-dialog-wide" : "shop-dialog"}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={event=>{
        if(!trapFocus||event.key!=='Tab'||event.target.closest('dialog')!==event.currentTarget)return;
        const dialog=event.currentTarget,items=[...dialog.querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex]')].filter(e=>{
          if(e.tabIndex<0||e.matches(':disabled')||!e.getClientRects().length||e.closest('dialog')!==dialog||e.closest('[inert]'))return false;
          for(let parent=e.closest('details');parent&&dialog.contains(parent);parent=parent.parentElement.closest('details')){
            if(!parent.open&&!parent.querySelector('summary')?.contains(e))return false;
          }
          return true;
        });
        const index=items.indexOf(document.activeElement);
        if(!items.length){event.preventDefault();dialog.focus();return;}
        if(event.shiftKey&&index===0){event.preventDefault();items.at(-1).focus();}
        else if(!event.shiftKey&&index===items.length-1){event.preventDefault();items[0].focus();}
      }}
      aria-labelledby={headingId}
    >
      <div className="dialog-header d-flex align-items-center justify-content-between gap-3 mb-3">
        <h2 id={headingId} className="h5 mb-0">
          {title}
        </h2>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={busy}
          onClick={onClose}
          aria-label="Close dialog"
        >
          Close
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({ children = "No items found." }) {
  return <p className="text-body-secondary py-3 mb-0">{children}</p>;
}
export function PageTitle({ title, children }) {
  return (
    <div className="page-title d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
      <h1 className="h4 mb-0">{title}</h1>
      {children && <div className="page-actions d-flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
export function AvatarInput() {
  return (
    <Field label="Profile picture (Optional)" hint="Choose an image, up to 5 MB.">
      <input
        className="form-control"
        type="file"
        name="avatar"
        accept="image/*"
      />
    </Field>
  );
}
export function validateAvatar(file) {
  if (!file || (file.size === 0 && !file.name)) return;
  if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024)
    throw new Error("Choose an image smaller than 5 MB.");
}
