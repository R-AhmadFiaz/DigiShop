const DAY = 24 * 60 * 60 * 1000;

function expiryDetails(expiry, now) {
  if (!expiry) return { missing: true };
  const expires = new Date(expiry);
  const expiryTime = expires.getTime();
  const remaining = expiryTime - now;
  if (!Number.isFinite(remaining)) return { invalid: true };
  const soon = remaining > 0 && remaining <= 3 * DAY;
  const calendarDay = (date) =>
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.min(
    3,
    (calendarDay(expires) - calendarDay(new Date(now))) / DAY,
  );
  const timeLeft =
    days === 0 ? "Today" : days === 1 ? "Tomorrow" : days + " days";
  return { expiryTime, remaining, soon, timeLeft };
}

export function subscriptionWarning(expiry, now = Date.now()) {
  const info = expiryDetails(expiry, now);
  if (!info.soon) return "";
  const when =
    info.timeLeft === "Today"
      ? "today"
      : info.timeLeft === "Tomorrow"
        ? "tomorrow"
        : "in " + info.timeLeft;
  return "Subscription expires " + when + ". Renew soon to avoid interruption.";
}

export function shopSubscription(shop, now = Date.now()) {
  const info = expiryDetails(shop.subscriptionExpiry, now);
  if (info.missing)
    return {
      status: "Never Activated",
      timeLeft: "-",
      priority: 1,
      action: "activate",
      actionLabel: "Activate 30 Days",
      expiryTime: Infinity,
    };
  if (info.invalid)
    return {
      status: "Unavailable",
      timeLeft: "-",
      priority: 1,
      action: null,
      expiryTime: Infinity,
    };
  if (info.remaining <= 0)
    return {
      status: "Expired",
      timeLeft: "Expired",
      priority: 0,
      action: "extend",
      actionLabel: "Renew 30 Days",
      expiryTime: info.expiryTime,
    };
  const status = info.soon ? "Expiring Soon" : "Active";
  return {
    status,
    timeLeft: info.soon
      ? info.timeLeft
      : Math.ceil(info.remaining / DAY) + " days",
    priority: info.soon ? 2 : 3,
    action: "extend",
    actionLabel: "Extend 30 Days",
    expiryTime: info.expiryTime,
  };
}

export function adminShopRows(shops, search = "", now = Date.now()) {
  const term = search.trim().toLowerCase();
  return shops
    .filter((shop) =>
      [shop.name, shop.contactNo, shop.ownerId?.username, shop.ownerId?.email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term),
    )
    .map((shop) => ({ shop, subscription: shopSubscription(shop, now) }))
    .sort(
      (a, b) =>
        a.subscription.priority - b.subscription.priority ||
        a.subscription.expiryTime - b.subscription.expiryTime ||
        (a.shop.name || "").localeCompare(b.shop.name || "") ||
        String(a.shop._id).localeCompare(String(b.shop._id)),
    );
}
