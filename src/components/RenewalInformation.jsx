import { useEffect, useState } from "react";
import {
  paymentPrice,
  paymentProofLink,
  subscriptionPayment as payment,
} from "../config/subscriptionPayment";

export default function RenewalInformation() {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(""),
    [qrFailed, setQrFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  async function copy() {
    setCopied(false);
    setError("");
    try {
      await navigator.clipboard.writeText(payment.accountNumber);
      setCopied(true);
    } catch {
      setError("Could not copy. Select and copy the account number below.");
    }
  }
  return (
    <section className="panel">
      <h1 className="h4">Renew Subscription</h1>
      <p className="fs-5 mb-3">
        <strong>{paymentPrice()}</strong> / {payment.durationDays} Days
      </p>
      <div className="row g-4">
        <div className="col-md-5">
          {qrFailed ? (
            <p className="text-body-secondary" role="status">
              Payment QR is unavailable. Use the bank account details.
            </p>
          ) : (
            <img
              src={payment.qrAsset}
              alt="Subscription payment QR code"
              width="280"
              className="img-fluid"
              onError={() => setQrFailed(true)}
            />
          )}
        </div>
        <div className="col-md-7">
          <h2 className="h5">{payment.bankName}</h2>
          <p className="mb-2">
            Account Title
            <br />
            <strong>{payment.accountTitle}</strong>
          </p>
          <p className="mb-2">Account Number</p>
          <div className="d-flex gap-2 align-items-center flex-wrap mb-2">
            <strong className="user-select-all">{payment.accountNumber}</strong>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={copy}
            >
              Copy
            </button>
            <span role="status">{copied ? "Copied" : ""}</span>
          </div>
          {error && (
            <p className="text-warning" role="alert">
              {error}
            </p>
          )}
          <ol className="ps-3 mt-3">
            <li>
              Pay {paymentPrice()} using the QR code or bank account details.
            </li>
            <li>Take a screenshot/receipt of the successful payment.</li>
            <li>Send the payment proof through WhatsApp.</li>
            <li>Include your Shop Name with the payment proof.</li>
            <li>Subscription will be renewed after payment is verified.</li>
          </ol>
          <a
            className="btn btn-primary"
            href={paymentProofLink()}
            target="_blank"
            rel="noopener noreferrer"
          >
            Send Payment Proof on WhatsApp
          </a>
          <p className="text-body-secondary small mt-3 mb-0">
            Payment is verified manually by the administrator. Viewing these
            instructions or opening WhatsApp does not renew your subscription.
          </p>
        </div>
      </div>
    </section>
  );
}
