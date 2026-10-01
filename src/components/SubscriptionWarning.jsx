import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { subscriptionWarning } from "../api/subscription";

export default function SubscriptionWarning({ expiry }) {
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
