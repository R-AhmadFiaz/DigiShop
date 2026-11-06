import { useEffect, useId, useRef } from "react";
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
export function Pagination({ pagination, onPage }) {
  if (!pagination || pagination.totalPages < 2) return null;
  return (
    <div className="d-flex flex-wrap align-items-center gap-3 mt-3">
      <button
        className="btn btn-outline-secondary btn-sm"
        type="button"
        disabled={pagination.currentPage <= 1}
        onClick={() => onPage(pagination.currentPage - 1)}
      >
        Previous
      </button>
      <span>
        Page {pagination.currentPage} of {pagination.totalPages}
      </span>
      <button
        className="btn btn-outline-secondary btn-sm"
        type="button"
        disabled={pagination.currentPage >= pagination.totalPages}
        onClick={() => onPage(pagination.currentPage + 1)}
      >
        Next
      </button>
    </div>
  );
}
export function Modal({ title, onClose, children, busy = false, wide = false }) {
  const ref = useRef(null);
  const headingId=useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    dialog.querySelector("input:not([type=hidden]), select, textarea")?.focus({preventScroll:true});
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
