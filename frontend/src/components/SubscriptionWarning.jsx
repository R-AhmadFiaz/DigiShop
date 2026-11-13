import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { subscriptionPill, subscriptionWarning } from "../api/subscription";

// compact: a small amber pill for the header (New sale screen) instead of the full-width banner.
export default function SubscriptionWarning({ expiry, compact = false }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  if (compact) {
    const text = subscriptionPill(expiry, now);
    return text ? (
      <Link className="subscription-pill" to="/owner/renew">
        {text} · <span className="subscription-pill-action">Renew</span>
      </Link>
    ) : null;
  }
  const message = subscriptionWarning(expiry, now);
  return message ? (
    <div className="alert alert-warning py-2" role="status">
      {message}
      <Link className="btn btn-outline-warning btn-sm ms-3" to="/owner/renew">
        Renew Subscription
      </Link>
    </div>
  ) : null;
}
