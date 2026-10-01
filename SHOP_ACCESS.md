# Manual shop access

Shop.isActive is a persistent boolean, default true. Legacy shops without the field are treated as active; no data migration or bulk update is needed. Only explicit false blocks access. Shop data and user accounts are preserved.

ADMIN-only endpoints:

- PATCH /api/v2/admin/shops/:id/deactivate
- PATCH /api/v2/admin/shops/:id/reactivate

Both accept no body, set only isActive (plus normal schema timestamps), and return the existing envelope with data.shop. Repeating an action preserves the same access state. Invalid selection returns 400; a missing shop returns 404. OWNER/CASHIER cannot call these operations.

verifyShopUser reads the current user's shop on every business request. Explicit false returns 403 with the stable message: Shop has been deactivated. Contact administrator. This runs before controllers/uploads and before existing subscription checks. It covers all product, category, customer, order/invoice, quotation, stock-history, AI and cashier-creation routes. It uses the authenticated user's shop, never a caller-supplied shop selection. ADMIN management remains separate.

Login and POST current-user now return an additional data.shopActive boolean alongside the unchanged data.user. Authentication, refresh, logout and own password change remain available in the backend. The frontend presents only the blocked explanation and Sign out for deactivated shop users. A subsequent business 403 also transitions an already logged-in user to that screen; subscription expiry alone does not. Shop pages are unmounted and not requested on blocked login/restoration.

ADMIN Shops displays Shop access separately from Subscription. It shows one manual action: Deactivate for active shops (confirmation required), Reactivate for deactivated shops. Activate subscription and Extend 30 days remain independent. Manual reactivation never changes subscription expiry or subscriptionActive. Subscription activation/extension never changes isActive.

After ADMIN reactivation, a blocked user can reload or sign in again to restore the normal interface. Existing subscription checks still apply; their earlier endpoint coverage is unchanged. No polling, billing, new navigation or packages were added. Requests already admitted before deactivation can finish; subsequent requests read the new state.

Verification: backend TypeScript build and mounted-route tests cover legacy defaults, both shop roles' real password/JWT authentication, restoration/refresh/logout, every business route's 403, ADMIN permissions/idempotence, other-shop isolation, reactivation, expiry preservation and separate subscription controls. Model persistence is isolated in tests; no real shop is disabled or altered. Frontend unit/headless tests cover Admin confirmation/state/action, blocked login/reload/mid-session transitions/logout for both roles, recovery after reactivation and distinct subscription errors. Captured blocked/Admin screens were inspected.
