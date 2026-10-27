import { HTTPException } from "hono/http-exception";
import type { App, Ctx } from "./core";
import { all, audit, finance, fresh, hashSecret, me, now, one, role, run, siteFor, uid } from "./core";

type Actor = {
  id: number;
  role: "owner" | "manager" | "moderator" | "user";
  email: string;
  financial?: number;
};

type SiteRow = {
  id: string;
  user_id: number | null;
  manager_id: number | null;
  draft: string;
  draft_version: number;
  published: string | null;
  published_version: number;
  status: string;
  allow_contact: number;
  branding: number;
  authorization: string | null;
  trial_until?: number;
  entitlement_until?: number;
};

type ReviewRow = {
  id: string;
  site_id: string;
  user_id: number;
  snapshot: string;
  draft_version: number;
  base_version: number;
  status: string;
  reviewer_id: number | null;
  reason: string | null;
  created_at: number;
  decided_at: number | null;
};

type DecidedReviewRow = ReviewRow & {
  decision_status: "approved" | "rejected" | null;
  decision_reviewer_id: number | null;
  decision_reason: string | null;
  decision_decided_at: number | null;
};

type PaymentRow = {
  id: string;
  user_id: number;
  amount: number;
  days: number;
  status: string;
  referrer_id: number | null;
  reviewer_id: number | null;
  created_at: number;
  approved_at: number | null;
  trial_until: number;
  entitlement_until: number;
  subscription_start: number | null;
  subscription_end: number | null;
};

type D1Change = { meta?: { changes?: number } };
type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 410 | 429;

const DAY = 86_400;
const MESSAGE_WINDOW = 24 * 60 * 60;
const POSITIVE_EMOJI = new Set(["🙂", "😊", "👍", "🙏", "✨", "🌟", "🎉", "🤝", "💚", "❤️"]);
const PUBLIC_SETTING_KEYS = new Set(["lock", "bank", "contact", "retention", "prices", "season"]);
const BACKUP_TABLES = [
  "settings",
  "users",
  "wallets",
  "ledger",
  "reserved_names",
  "sites",
  "names",
  "reviews",
  "review_decisions",
  "review_events",
  "media",
  "services",
  "user_services",
  "payments",
  "payment_reversals",
  "subscriptions",
  "redemptions",
  "entitlement_adjustments",
  "notifications",
  "transfers",
  "handovers",
  "proxy_sites",
  "proxy_media",
  "site_custody",
  "quick_links",
  "analytics",
  "radar_sources",
  "radar_items",
  "content",
  "expenses",
  "audit",
  "deletion_requests",
] as const;

function fail(status: ErrorStatus, error: string, code?: string): never {
  throw new HTTPException(status, {
    res: new Response(JSON.stringify({ error, ...(code ? { code } : {}) }), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
  });
}

async function input(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  const value = await c.req.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "A JSON object is required", "invalid_body");
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, options: { min?: number; max?: number; optional?: boolean } = {}): string {
  if ((value === undefined || value === null) && options.optional) return "";
  if (typeof value !== "string") fail(400, `${label} must be text`, "invalid_input");
  const result = value.trim();
  const min = options.min ?? 1;
  const max = options.max ?? 2_000;
  if (result.length < min || result.length > max) fail(400, `${label} must be between ${min} and ${max} characters`, "invalid_input");
  return result;
}

function integer(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < min || numeric > max) fail(400, `${label} is invalid`, "invalid_input");
  return numeric;
}

function changed(result: unknown): number {
  return (result as D1Change | undefined)?.meta?.changes ?? 0;
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function jsonString(value: unknown, label: string, maximum = 100_000): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, `${label} must be an object`, "invalid_input");
  const encoded = JSON.stringify(value);
  if (encoded.length > maximum) fail(400, `${label} is too large`, "invalid_input");
  return encoded;
}

function proxyMediaIds(draft: string): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 20 || found.size > 9) return;
    if (typeof value === "string") {
      const match = /^\/api\/media\/([A-Za-z0-9_-]{1,160})$/.exec(value);
      if (match) found.add(match[1]);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) visit(item, depth + 1);
    }
  };
  visit(parseJson(draft), 0);
  if (found.size > 9) fail(400, "A proxy profile may reference at most nine uploaded images", "invalid_media");
  return [...found];
}

function resolvedReview(review: DecidedReviewRow): ReviewRow {
  const { decision_status, decision_reviewer_id, decision_reason, decision_decided_at, ...original } = review;
  if (!decision_status) return original;
  return {
    ...original,
    status: decision_status,
    reviewer_id: decision_reviewer_id,
    reason: decision_reason,
    decided_at: decision_decided_at,
  };
}

function customerId(value: unknown, label = "recipient"): number {
  if (typeof value === "number") return integer(value, label, 1);
  if (typeof value !== "string") fail(400, `${label} must be a C-number`, "invalid_input");
  const match = /^C([1-9]\d*)$/.exec(value.trim());
  if (!match) fail(400, `${label} must be a C-number`, "invalid_input");
  return integer(match[1], label, 1);
}

function nameValue(value: unknown): string {
  const name = text(value, "name", { min: 1, max: 63 }).toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) {
    fail(400, "Name must be a valid lowercase DNS label", "invalid_name");
  }
  return name;
}

function actor(c: Ctx): Actor {
  const user = me(c) as Actor;
  role(c, ["owner", "manager", "moderator"]);
  return user;
}

function owner(c: Ctx): Actor {
  const user = actor(c);
  if (user.role !== "owner") fail(403, "Owner access is required", "owner_required");
  return user;
}

function managerOrOwner(c: Ctx): Actor {
  const user = actor(c);
  if (user.role === "moderator") fail(403, "This operation is not available to moderators", "scope_denied");
  return user;
}

async function userInManagerScope(c: Ctx, targetId: number): Promise<void> {
  const user = managerOrOwner(c);
  if (user.role === "owner" || user.id === targetId) return;
  const permitted = await one<{ id: number }>(
    c,
    `SELECT id FROM users
     WHERE id=? AND (assigned_to=? OR EXISTS(SELECT 1 FROM sites WHERE sites.user_id=users.id AND sites.manager_id=?))`,
    targetId,
    user.id,
    user.id,
  );
  if (!permitted) fail(403, "The user is outside your assigned scope", "scope_denied");
}

async function siteInManagerScope(c: Ctx, id: string): Promise<SiteRow> {
  const user = managerOrOwner(c);
  if (user.role === "owner") {
    const site = await one<SiteRow>(c, "SELECT * FROM sites WHERE id=?", id);
    if (!site) fail(404, "Site not found", "not_found");
    return site;
  }
  const scoped = await siteFor(c, id) as SiteRow | null;
  if (!scoped) fail(404, "Site not found", "not_found");
  return scoped;
}

async function reviewScope(c: Ctx, review: Pick<ReviewRow, "site_id">): Promise<Actor> {
  const user = actor(c);
  if (user.role === "manager") await siteInManagerScope(c, review.site_id);
  return user;
}

function requireFinance(c: Ctx): Actor {
  const user = actor(c);
  fresh(c);
  finance(c);
  return user;
}

function responseUser(row: Record<string, unknown>): Record<string, unknown> {
  const { pin_hash: _pinHash, ...safe } = row;
  return safe;
}

function shallowChanges(previousText: string | null, nextText: string): Array<{ field: string; before: unknown; after: unknown }> {
  const previous = parseJson(previousText) as Record<string, unknown> | null;
  const next = parseJson(nextText) as Record<string, unknown> | null;
  if (!next || typeof next !== "object" || Array.isArray(next)) return [];
  const before = previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {};
  const fields = new Set([...Object.keys(before), ...Object.keys(next)]);
  const result: Array<{ field: string; before: unknown; after: unknown }> = [];
  for (const field of fields) {
    const oldValue = before[field];
    const newValue = next[field];
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) result.push({ field, before: oldValue ?? null, after: newValue ?? null });
  }
  return result;
}

function validMessage(body: string): boolean {
  if (!body || body.length > 1_000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(body)) return false;
  const pictographs = body.match(/\p{Extended_Pictographic}/gu) ?? [];
  return pictographs.every((character) => POSITIVE_EMOJI.has(character));
}

function contactPairSql(): string {
  return "((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))";
}

function publicSetting(row: { key: string; value: string }): { key: string; value: unknown } {
  const decoded = parseJson(row.value);
  if (row.key !== "lock" || !decoded || typeof decoded !== "object" || Array.isArray(decoded)) return { key: row.key, value: decoded ?? row.value };
  const { passwordHash: _passwordHash, ...safe } = decoded as Record<string, unknown>;
  const mode = safe.mode === "home" ? "home_closed" : safe.mode === "private" ? "platform_closed" : safe.mode;
  return { key: row.key, value: { ...safe, mode } };
}

function normalizeLock(value: unknown, currentValue: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "Lock settings must be an object", "invalid_input");
  const proposed = value as Record<string, unknown>;
  const current = parseJson(currentValue) as Record<string, unknown> | null;
  const aliases: Record<string, string> = {
    open: "open",
    landing: "home",
    homepage: "home",
    home: "home",
    home_closed: "home",
    platform: "private",
    full: "private",
    platform_closed: "private",
    maintenance: "maintenance",
    private: "private",
    private_test: "private",
    human_test: "private",
  };
  const rawMode = text(proposed.mode, "lock mode", { min: 1, max: 32 }).toLowerCase();
  const mode = aliases[rawMode];
  if (!mode) fail(400, "Lock mode must be one of the five supported modes", "invalid_input");
  const message = text(proposed.message ?? "", "lock message", { min: 0, max: 1_000, optional: true });
  const reason = text(proposed.reason ?? "", "lock reason", { min: 0, max: 1_000, optional: true });
  const password = proposed.password;
  if (password !== undefined && password !== null && typeof password !== "string") fail(400, "Lock password must be text", "invalid_input");
  const currentHash = current && typeof current.passwordHash === "string" ? current.passwordHash : null;
  return JSON.stringify({ mode, message, reason, passwordHash: password ? password : currentHash });
}

function decisionValue(value: unknown): "approved" | "rejected" {
  const requested = text(value, "decision", { max: 16 }).toLowerCase();
  if (requested === "approve" || requested === "approved") return "approved";
  if (requested === "reject" || requested === "rejected") return "rejected";
  fail(400, "Decision is invalid", "invalid_input");
}

function settingKey(value: unknown): "lock" | "bank" | "contact" | "retention" | "prices" | "season" {
  const requested = text(value, "key", { max: 64 });
  const aliases: Record<string, "lock" | "bank" | "contact" | "retention" | "prices" | "season"> = {
    lock: "lock",
    platform_lock: "lock",
    bank: "bank",
    bank_instructions: "bank",
    contact: "contact",
    retention: "retention",
    prices: "prices",
    season: "season",
    seasonal: "season",
  };
  const key = aliases[requested];
  if (!key || !PUBLIC_SETTING_KEYS.has(key)) fail(400, "This setting cannot be changed through the operations API", "invalid_setting");
  return key;
}

async function storedSetting(c: Ctx, key: string): Promise<{ key: string; value: string }> {
  const setting = await one<{ key: string; value: string }>(c, "SELECT key,value FROM settings WHERE key=?", key);
  if (!setting) fail(404, "Setting not found", "not_found");
  return setting;
}

async function contactAllowed(c: Ctx, recipient: number): Promise<void> {
  const allowed = await one<{ id: number }>(
    c,
    `SELECT u.id FROM users u
     WHERE u.id=? AND u.status='active'
       AND EXISTS(SELECT 1 FROM sites s WHERE s.user_id=u.id AND s.allow_contact=1 AND s.status='published')`,
    recipient,
  );
  if (!allowed) fail(403, "This user is not accepting contact requests", "contact_unavailable");
}

async function pairBlocked(c: Ctx, first: number, second: number): Promise<boolean> {
  const row = await one<{ user_id: number }>(
    c,
    "SELECT user_id FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)",
    first,
    second,
    second,
    first,
  );
  return Boolean(row);
}

async function notificationTargets(c: Ctx, recipient: unknown): Promise<number[]> {
  const user = managerOrOwner(c);
  if (recipient === "all") {
    if (user.role !== "owner") fail(403, "Only the owner can send a platform-wide notification", "scope_denied");
    const rows = await all<{ id: number }>(c, "SELECT id FROM users WHERE status='active'");
    return rows.map((row) => row.id);
  }
  if (typeof recipient === "string" && recipient.startsWith("role:")) {
    if (user.role !== "owner") fail(403, "Only the owner can send a role-wide notification", "scope_denied");
    const targetRole = recipient.slice("role:".length);
    if (!(["owner", "manager", "moderator", "user"] as string[]).includes(targetRole)) {
      fail(400, "Notification role is invalid", "invalid_input");
    }
    const rows = await all<{ id: number }>(c, "SELECT id FROM users WHERE status='active' AND role=?", targetRole);
    return rows.map((row) => row.id);
  }
  const raw = Array.isArray(recipient) ? recipient : [recipient];
  if (!raw.length || raw.length > 1_000) fail(400, "A notification recipient list is invalid", "invalid_input");
  const targets = [...new Set(raw.map((item) => customerId(item)))];
  if (user.role === "manager") {
    for (const target of targets) await userInManagerScope(c, target);
  }
  const existing = await all<{ id: number }>(
    c,
    `SELECT id FROM users WHERE id IN (${targets.map(() => "?").join(",")}) AND status='active'`,
    ...targets,
  );
  if (existing.length !== targets.length) fail(404, "One or more notification recipients were not found", "not_found");
  return targets;
}

export function registerOperations(app: App): void {
  app.get("/api/admin/overview", async (c) => {
    const user = actor(c);
    const unread = await one<{ count: number }>(c, "SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND read_at IS NULL", user.id);
    if (user.role === "moderator") {
      const pending = await one<{ count: number }>(c, "SELECT COUNT(*) AS count FROM reviews r WHERE r.status='pending' AND NOT EXISTS(SELECT 1 FROM review_decisions d WHERE d.review_id=r.id)");
      const metrics = {
        total_users: null,
        new_registrations: null,
        published_sites: null,
        pending_sites: null,
        review_requests: pending?.count ?? 0,
        free_trials: null,
        subscriptions: null,
        payment_requests: null,
        referrals: null,
        treasury_points: null,
        transfers: null,
        resource_usage: null,
        service_activity: null,
        notifications: unread?.count ?? 0,
        contact_requests: null,
      };
      return c.json({ overview: metrics, metrics, pendingReviews: metrics.review_requests, unreadNotifications: metrics.notifications });
    }

    const scoped = user.role === "manager";
    const userScope = "(u.id=? OR u.assigned_to=? OR EXISTS(SELECT 1 FROM sites ms WHERE ms.user_id=u.id AND ms.manager_id=?))";
    const users = await one<{ count: number }>(
      c,
      scoped ? `SELECT COUNT(*) AS count FROM users u WHERE ${userScope}` : "SELECT COUNT(*) AS count FROM users u",
      ...(scoped ? [user.id, user.id, user.id] : []),
    );
    const publishedSites = await one<{ count: number }>(
      c,
      scoped
        ? "SELECT COUNT(*) AS count FROM sites WHERE status='published' AND (manager_id=? OR user_id=?)"
        : "SELECT COUNT(*) AS count FROM sites WHERE status='published'",
      ...(scoped ? [user.id, user.id] : []),
    );
    const pendingSites = await one<{ count: number }>(
      c,
      scoped
        ? "SELECT COUNT(*) AS count FROM sites WHERE status<>'published' AND (manager_id=? OR user_id=?)"
        : "SELECT COUNT(*) AS count FROM sites WHERE status<>'published'",
      ...(scoped ? [user.id, user.id] : []),
    );
    const pendingReviews = await one<{ count: number }>(
      c,
      scoped
        ? "SELECT COUNT(*) AS count FROM reviews r WHERE r.status='pending' AND NOT EXISTS(SELECT 1 FROM review_decisions d WHERE d.review_id=r.id) AND EXISTS(SELECT 1 FROM sites s WHERE s.id=r.site_id AND (s.manager_id=? OR s.user_id=?))"
        : "SELECT COUNT(*) AS count FROM reviews r WHERE r.status='pending' AND NOT EXISTS(SELECT 1 FROM review_decisions d WHERE d.review_id=r.id)",
      ...(scoped ? [user.id, user.id] : []),
    );
    const [trials, subscriptions, transfers, contacts, newRegistrations, serviceActivity] = await Promise.all([
      one<{ count: number }>(c, scoped ? `SELECT COUNT(*) AS count FROM users u WHERE ${userScope} AND u.trial_until>? AND u.entitlement_until<=u.trial_until` : "SELECT COUNT(*) AS count FROM users WHERE trial_until>? AND entitlement_until<=trial_until", ...(scoped ? [user.id, user.id, user.id, now()] : [now()])),
      one<{ count: number }>(c, scoped ? `SELECT COUNT(DISTINCT s.user_id) AS count FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE ${userScope}` : "SELECT COUNT(DISTINCT user_id) AS count FROM subscriptions", ...(scoped ? [user.id, user.id, user.id] : [])),
      one<{ count: number }>(c, scoped ? "SELECT COUNT(*) AS count FROM transfers t JOIN users u ON u.id=t.from_id WHERE (u.id=? OR u.assigned_to=?)" : "SELECT COUNT(*) AS count FROM transfers", ...(scoped ? [user.id, user.id] : [])),
      one<{ count: number }>(c, scoped ? "SELECT COUNT(*) AS count FROM contact_requests r JOIN users u ON u.id=r.to_id WHERE (u.id=? OR u.assigned_to=?)" : "SELECT COUNT(*) AS count FROM contact_requests", ...(scoped ? [user.id, user.id] : [])),
      one<{ count: number }>(c, scoped ? `SELECT COUNT(*) AS count FROM users u WHERE ${userScope} AND u.created_at>=?` : "SELECT COUNT(*) AS count FROM users WHERE created_at>=?", ...(scoped ? [user.id, user.id, user.id, now() - 30 * DAY] : [now() - 30 * DAY])),
      one<{ count: number }>(c, scoped ? `SELECT COUNT(*) AS count FROM user_services us JOIN users u ON u.id=us.user_id WHERE ${userScope}` : "SELECT COUNT(*) AS count FROM user_services", ...(scoped ? [user.id, user.id, user.id] : [])),
    ]);
    const financial = user.role === "owner" || Boolean(user.financial);
    const [payments, referrals, treasury] = financial
      ? await Promise.all([
        one<{ count: number }>(c, "SELECT COUNT(*) AS count FROM payments WHERE status IN ('requested','submitted')"),
        one<{ count: number }>(c, "SELECT COUNT(*) AS count FROM ledger WHERE kind='referral'"),
        one<{ balance: number }>(c, "SELECT balance FROM wallets WHERE user_id=0"),
      ])
      : [null, null, null];
    const metrics = {
      total_users: users?.count ?? 0,
      new_registrations: newRegistrations?.count ?? 0,
      published_sites: publishedSites?.count ?? 0,
      pending_sites: pendingSites?.count ?? 0,
      review_requests: pendingReviews?.count ?? 0,
      free_trials: trials?.count ?? 0,
      subscriptions: subscriptions?.count ?? 0,
      payment_requests: payments?.count ?? null,
      referrals: referrals?.count ?? null,
      treasury_points: treasury?.balance ?? null,
      transfers: transfers?.count ?? 0,
      resource_usage: null,
      service_activity: serviceActivity?.count ?? 0,
      notifications: unread?.count ?? 0,
      contact_requests: contacts?.count ?? 0,
    };
    return c.json({
      overview: metrics,
      metrics,
      users: metrics.total_users,
      publishedSites: metrics.published_sites,
      assignedSites: scoped ? metrics.published_sites + metrics.pending_sites : null,
      pendingReviews: metrics.review_requests,
      unreadNotifications: metrics.notifications,
      requestedPayments: metrics.payment_requests,
    });
  });

  app.get("/api/admin/users", async (c) => {
    const user = managerOrOwner(c);
    const query = (c.req.query("q") ?? "").trim();
    const status = (c.req.query("status") ?? "").trim();
    const limit = Math.min(integer(c.req.query("limit") ?? "50", "limit", 1, 100), 100);
    const offset = integer(c.req.query("offset") ?? "0", "offset", 0, 1_000_000);
    const queryPart = query ? "%" + query.replace(/[%_]/g, "") + "%" : "%";
    const statusPart = status || "%";
    const scope = user.role === "manager"
      ? "AND (u.id=? OR u.assigned_to=? OR EXISTS(SELECT 1 FROM sites scope_site WHERE scope_site.user_id=u.id AND scope_site.manager_id=?))"
      : "";
    const rows = await all<Record<string, unknown>>(
      c,
      `SELECT u.id,u.email,u.name,u.whatsapp,u.role,u.financial,u.status,u.trial_until,u.entitlement_until,u.referrer_id,u.referral_paid,u.assigned_to,u.created_at,u.last_active,
              w.balance,
              (SELECT n.name FROM dns_names n WHERE n.owner_id=u.id ORDER BY n.created_at LIMIT 1) AS subdomain,
              (SELECT s.status FROM sites s WHERE s.user_id=u.id ORDER BY s.created_at LIMIT 1) AS site_status,
              (SELECT d.status FROM deletion_requests d WHERE d.user_id=u.id ORDER BY d.created_at DESC LIMIT 1) AS deletion_request_status
       FROM users u
       LEFT JOIN wallets w ON w.user_id=u.id
       WHERE (u.email LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR ('C'||u.id) LIKE ? ESCAPE '\\')
         AND u.status LIKE ? ESCAPE '\\'
         ${scope}
       ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      queryPart,
      queryPart,
      queryPart,
      statusPart,
      ...(user.role === "manager" ? [user.id, user.id, user.id] : []),
      limit,
      offset,
    );
    return c.json({ users: rows.map(responseUser), offset, limit });
  });

  app.post("/api/admin/users/:id/action", async (c) => {
    const targetId = integer(c.req.param("id"), "user id", 1);
    const body = await input(c);
    const action = text(body.action, "action", { max: 32 });
    const clock = now();

    if (action === "role") {
      const user = owner(c);
      fresh(c);
      if (targetId === user.id) fail(400, "The owner role cannot be changed from this session", "invalid_action");
      const nextRole = text(body.role, "role", { max: 16 });
      if (!(["owner", "manager", "moderator", "user"] as string[]).includes(nextRole)) fail(400, "Role is invalid", "invalid_input");
      if (body.financial !== undefined && typeof body.financial !== "boolean") fail(400, "financial must be boolean", "invalid_input");
      const target = await one<{ id: number; financial: number }>(c, "SELECT id,financial FROM users WHERE id=?", targetId);
      if (!target) fail(404, "User not found", "not_found");
      const financial = nextRole === "manager"
        ? (typeof body.financial === "boolean" ? (body.financial ? 1 : 0) : target.financial)
        : 0;
      await run(c, "UPDATE users SET role=?,financial=? WHERE id=?", nextRole, financial, targetId);
      await audit(c, "user.role", `user:${targetId}`, JSON.stringify({ role: nextRole, financial: Boolean(financial) }));
      return c.json({ user: responseUser((await one<Record<string, unknown>>(c, "SELECT id,email,name,role,status,financial,assigned_to FROM users WHERE id=?", targetId)) ?? {}) });
    }

    if (action === "assign") {
      owner(c);
      fresh(c);
      const requestedManager = body.managerId ?? body.assignedTo;
      const managerId = requestedManager === null || requestedManager === undefined || requestedManager === "" ? null : integer(requestedManager, "managerId", 1);
      if (managerId !== null) {
        const manager = await one<{ id: number }>(c, "SELECT id FROM users WHERE id=? AND role IN ('owner','manager') AND status='active'", managerId);
        if (!manager) fail(400, "Assigned manager is unavailable", "invalid_input");
      }
      const result = await run(c, "UPDATE users SET assigned_to=? WHERE id=?", managerId, targetId);
      if (!changed(result)) fail(404, "User not found", "not_found");
      await audit(c, "user.assign", `user:${targetId}`, JSON.stringify({ managerId }));
      return c.json({ assignedTo: managerId, assigned_to: managerId });
    }

    if (action === "points") {
      const user = requireFinance(c);
      const amount = integer(body.amount, "amount", 1, 1_000_000_000_000);
      const key = body.idempotencyKey === undefined ? uid() : text(body.idempotencyKey, "idempotencyKey", { min: 8, max: 128 });
      if (!/^[A-Za-z0-9_-]+$/.test(key)) fail(400, "idempotencyKey is invalid", "invalid_input");
      const target = await one<{ id: number }>(c, "SELECT id FROM users WHERE id=? AND status='active'", targetId);
      if (!target) fail(404, "User not found", "not_found");
      const reference = `admin-points-${targetId}-${key}`;
      const previous = await one<{ id: string }>(c, "SELECT id FROM ledger WHERE reference=?", reference);
      if (!previous) {
        await run(
          c,
          "INSERT INTO ledger(id,from_id,to_id,amount,kind,notes,created_at,reference) VALUES(?,?,?,?,?,?,?,?)",
          `ledger-${uid()}`,
          0,
          targetId,
          amount,
          "admin_grant",
          text(body.reason ?? "Administrative point grant", "reason", { min: 1, max: 1_000 }),
          clock,
          reference,
        );
        await audit(c, "user.points", `user:${targetId}`, JSON.stringify({ amount, reference }));
      }
      const wallet = await one<{ balance: number }>(c, "SELECT balance FROM wallets WHERE user_id=?", targetId);
      return c.json({ ledgerId: previous?.id ?? reference, balance: wallet?.balance ?? 0, idempotent: Boolean(previous), actor: user.id });
    }

    if (action === "status") {
      const user = managerOrOwner(c);
      await userInManagerScope(c, targetId);
      const requestedStatus = text(body.status, "status", { max: 16 }).toLowerCase();
      const status = requestedStatus === "approved" || requestedStatus === "published" ? "active" : requestedStatus;
      if (!(["active", "suspended"] as string[]).includes(status)) fail(400, "Status is invalid", "invalid_input");
      if (targetId === user.id) fail(400, "You cannot change your own account status here", "invalid_action");
      const target = await one<{ role: string }>(c, "SELECT role FROM users WHERE id=?", targetId);
      if (!target) fail(404, "User not found", "not_found");
      if (target.role === "owner" && user.role !== "owner") fail(403, "Owner accounts are outside this scope", "scope_denied");
      await run(c, "UPDATE users SET status=? WHERE id=?", status, targetId);
      await audit(c, "user.status", `user:${targetId}`, JSON.stringify({ status }));
      return c.json({ status });
    }

    if (action === "grant") {
      const operator = managerOrOwner(c);
      await userInManagerScope(c, targetId);
      const days = integer(body.days, "days", 1, 36_500);
      const target = await one<{ id: number }>(c, "SELECT id FROM users WHERE id=?", targetId);
      if (!target) fail(404, "User not found", "not_found");
      const sourceId = `entitlement-grant-${uid()}`;
      const reference = `grant-${targetId}-${uid()}`;
      const results = await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO entitlement_sources(id,user_id,source_kind,starts_at,ends_at,reference,detail,created_by,created_at)
           SELECT ?,id,'grant',MAX(entitlement_until,trial_until,?),MAX(entitlement_until,trial_until,?)+?*?,?,?,?,?
           FROM users WHERE id=?`,
        ).bind(sourceId, clock, clock, days, DAY, reference, `Administrative grant of ${days} day(s)`, operator.id, clock, targetId),
        c.env.DB.prepare(
          `UPDATE users SET entitlement_until=(SELECT ends_at FROM entitlement_sources WHERE id=?)
           WHERE id=? AND EXISTS(SELECT 1 FROM entitlement_sources WHERE id=? AND user_id=?)`,
        ).bind(sourceId, targetId, sourceId, targetId),
      ]);
      if (!changed(results[0]) || !changed(results[1])) fail(409, "The entitlement grant could not be recorded", "grant_conflict");
      const account = await one<{ entitlement_until: number }>(c, "SELECT entitlement_until FROM users WHERE id=?", targetId);
      await audit(c, "user.grant", `user:${targetId}`, JSON.stringify({ days, sourceId, reference, entitlementUntil: account?.entitlement_until ?? null }));
      return c.json({ entitlementUntil: account?.entitlement_until ?? 0 });
    }

    if (action === "service") {
      managerOrOwner(c);
      await userInManagerScope(c, targetId);
      const key = text(body.key, "service key", { max: 96 });
      const requestedMode = text(body.mode, "service mode", { max: 16 }).toLowerCase();
      const mode = requestedMode === "granted" || requestedMode === "grant"
        ? "grant"
        : requestedMode === "pause" || requestedMode === "suspended"
          ? "suspended"
          : requestedMode;
      if (!(["default", "grant", "suspended"] as string[]).includes(mode)) fail(400, "Service mode is invalid", "invalid_input");
      const untilAt = body.untilAt === undefined || body.untilAt === null ? 0 : integer(body.untilAt, "untilAt", 0);
      const serviceRow = await one<{ key: string }>(c, "SELECT key FROM services WHERE key=?", key);
      if (!serviceRow) fail(404, "Service not found", "not_found");
      const target = await one<{ id: number }>(c, "SELECT id FROM users WHERE id=?", targetId);
      if (!target) fail(404, "User not found", "not_found");
      await run(
        c,
        `INSERT INTO user_services(user_id,key,mode,until_at) VALUES(?,?,?,?)
         ON CONFLICT(user_id,key) DO UPDATE SET mode=excluded.mode,until_at=excluded.until_at`,
        targetId,
        key,
        mode,
        untilAt,
      );
      await audit(c, "user.service", `user:${targetId}`, JSON.stringify({ key, mode, untilAt }));
      return c.json({ service: { key, mode, untilAt } });
    }

    if (action === "branding") {
      managerOrOwner(c);
      await userInManagerScope(c, targetId);
      if (body.key !== undefined && body.key !== "platform_branding") fail(400, "Branding key is invalid", "invalid_input");
      const suppliedSiteId = body.siteId === undefined || body.siteId === null || body.siteId === "" ? null : text(body.siteId, "siteId", { max: 128 });
      const candidate = suppliedSiteId
        ? await siteInManagerScope(c, suppliedSiteId)
        : await one<SiteRow>(c, "SELECT * FROM sites WHERE user_id=? ORDER BY created_at LIMIT 1", targetId);
      if (!candidate) fail(404, "Site not found", "not_found");
      const site = suppliedSiteId ? candidate : await siteInManagerScope(c, candidate.id);
      if (site.user_id !== targetId) fail(403, "The site does not belong to this user", "scope_denied");
      const enabled = typeof body.enabled === "boolean"
        ? body.enabled
        : ["inherit", "enabled", "enable", "on", "true"].includes(text(body.mode ?? "", "branding mode", { min: 0, max: 16, optional: true }).toLowerCase());
      const siteId = site.id;
      await run(c, "UPDATE sites SET branding=?,updated_at=? WHERE id=?", enabled ? 1 : 0, clock, siteId);
      await audit(c, "site.branding", `site:${siteId}`, JSON.stringify({ enabled }));
      return c.json({ siteId, branding: enabled });
    }

    fail(400, "Unsupported user action", "invalid_action");
  });

  app.get("/api/admin/reviews", async (c) => {
    const user = actor(c);
    const limit = integer(c.req.query("limit") ?? "50", "limit", 1, 100);
    const status = c.req.query("status") ?? "pending";
    if (!(["pending", "approved", "rejected"] as string[]).includes(status)) fail(400, "Review status is invalid", "invalid_input");
    const scope = user.role === "manager"
      ? "AND EXISTS(SELECT 1 FROM sites scoped WHERE scoped.id=r.site_id AND (scoped.manager_id=? OR scoped.user_id=?))"
      : "";
    const rows = await all<DecidedReviewRow & { published: string | null; site_status: string; submitter_name: string }>(
      c,
      `SELECT r.*,s.published,s.status AS site_status,u.name AS submitter_name,
              d.status AS decision_status,d.reviewer_id AS decision_reviewer_id,d.reason AS decision_reason,d.decided_at AS decision_decided_at
       FROM reviews r JOIN sites s ON s.id=r.site_id JOIN users u ON u.id=r.user_id
       LEFT JOIN review_decisions d ON d.review_id=r.id
       WHERE COALESCE(d.status,r.status)=? ${scope}
       ORDER BY r.created_at ASC LIMIT ?`,
      status,
      ...(user.role === "manager" ? [user.id, user.id] : []),
      limit,
    );
    return c.json({
      reviews: rows.map((row) => {
        const review = resolvedReview(row);
        const published = row.published;
        return {
        ...review,
        preview_url:'/api/admin/reviews/'+review.id+'/preview',
        snapshot: parseJson(review.snapshot),
        diff: {
          before: parseJson(published),
          after: parseJson(review.snapshot),
          changes: shallowChanges(published, review.snapshot),
        },
        changes: shallowChanges(published, review.snapshot),
        published: undefined,
        };
      }),
    });
  });

  app.post("/api/admin/reviews/:id/decision", async (c) => {
    const body = await input(c);
    const decision = decisionValue(body.decision);
    const reason = text(body.reason ?? "", "reason", { min: decision === "rejected" ? 1 : 0, max: 2_000, optional: decision === "approved" });
    const review = await one<DecidedReviewRow>(
      c,
      `SELECT r.*,d.status AS decision_status,d.reviewer_id AS decision_reviewer_id,d.reason AS decision_reason,d.decided_at AS decision_decided_at
       FROM reviews r LEFT JOIN review_decisions d ON d.review_id=r.id WHERE r.id=?`,
      c.req.param("id"),
    );
    if (!review) fail(404, "Review not found", "not_found");
    const reviewer = await reviewScope(c, review);
    if (review.status !== "pending" || review.decision_status) fail(409, "This review is no longer pending", "review_stale");
    const decidedAt = now();
    try {
      await run(
        c,
        "INSERT INTO review_decisions(review_id,status,reviewer_id,reason,decided_at) VALUES(?,?,?,?,?)",
        review.id,
        decision,
        reviewer.id,
        reason,
        decidedAt,
      );
    } catch {
      // The migration triggers atomically reject duplicate decisions and a changed
      // published base. Do not disclose which competing actor caused the conflict.
      fail(409, "This review is no longer pending or its published base is stale", "review_stale");
    }
    await audit(c, "review.decision", `review:${review.id}`, JSON.stringify({ decision, reason, siteId: review.site_id, baseVersion: review.base_version }));
    const updated = await one<DecidedReviewRow>(
      c,
      `SELECT r.*,d.status AS decision_status,d.reviewer_id AS decision_reviewer_id,d.reason AS decision_reason,d.decided_at AS decision_decided_at
       FROM reviews r LEFT JOIN review_decisions d ON d.review_id=r.id WHERE r.id=?`,
      review.id,
    );
    const resolved = updated ? resolvedReview(updated) : null;
    return c.json({ review: resolved ? { ...resolved, snapshot: parseJson(resolved.snapshot) } : null });
  });

  app.get("/api/admin/payments", async (c) => {
    requireFinance(c);
    const status = c.req.query("status") ?? "";
    const limit = integer(c.req.query("limit") ?? "50", "limit", 1, 100);
    const rows = await all<Record<string, unknown>>(
      c,
      `SELECT p.id,p.user_id,p.amount,p.days,p.receipt_id,p.status,p.notes,p.referrer_id,p.reviewer_id,p.created_at,p.approved_at,p.reversed_at,
              u.name,u.email,u.entitlement_until,
              pr.id AS reversal_id,pr.justification AS reversal_justification,pr.created_at AS reversal_created_at
       FROM payments p JOIN users u ON u.id=p.user_id
       LEFT JOIN payment_reversals pr ON pr.payment_id=p.id
       WHERE p.status LIKE ? ESCAPE '\\'
       ORDER BY p.created_at DESC LIMIT ?`,
      status || "%",
      limit,
    );
    return c.json({ payments: rows.map((payment) => ({ ...payment, receiptId: payment.receipt_id ?? null })) });
  });

  app.post("/api/admin/payments/:id/decision", async (c) => {
    const reviewer = requireFinance(c);
    const body = await input(c);
    const decision = decisionValue(body.decision);
    const reason = text(body.reason ?? "", "reason", { min: decision === "rejected" ? 1 : 0, max: 2_000, optional: decision === "approved" });
    const paymentId = c.req.param("id");
    const decidedAt = now();
    const result = await run(
      c,
      `UPDATE payments SET status=?,reviewer_id=?,approved_at=CASE WHEN ?='approved' THEN ? ELSE approved_at END,notes=CASE WHEN ?<>'' THEN ? ELSE notes END
       WHERE id=? AND status IN ('requested','submitted')`,
      decision,
      reviewer.id,
      decision,
      decidedAt,
      reason,
      reason,
      paymentId,
    );
    if (!changed(result)) fail(409, "This payment is no longer awaiting a decision", "payment_stale");
    await audit(c, "payment.decision", `payment:${paymentId}`, JSON.stringify({ decision, reason }));
    const payment = await one<Record<string, unknown>>(c, "SELECT id,user_id,amount,days,status,reviewer_id,created_at,approved_at FROM payments WHERE id=?", paymentId);
    return c.json({ payment });
  });

  app.post("/api/admin/payments/:id/reverse", async (c) => {
    const reviewer = requireFinance(c);
    const body = await input(c);
    const justification = text(body.justification, "justification", { min: 8, max: 2_000 });
    const paymentId = c.req.param("id");
    const payment = await one<PaymentRow>(
      c,
      `SELECT p.id,p.user_id,p.amount,p.days,p.status,p.referrer_id,p.reviewer_id,p.created_at,p.approved_at,
              u.trial_until,u.entitlement_until,s.start_at AS subscription_start,s.end_at AS subscription_end
       FROM payments p JOIN users u ON u.id=p.user_id
       LEFT JOIN subscriptions s ON s.payment_id=p.id
       WHERE p.id=?`,
      paymentId,
    );
    if (!payment) fail(404, "Payment not found", "not_found");
    if (payment.status !== "approved" || !payment.subscription_end || !payment.subscription_start) fail(409, "Only an approved payment with an applied entitlement can be reversed", "invalid_state");
    const existing = await one<{ id: string }>(c, "SELECT id FROM payment_reversals WHERE payment_id=?", paymentId);
    if (existing) fail(409, "This payment already has a reversal record", "already_reversed");

    const sourceReference = `subscription-${paymentId}`;
    const subscriptionSource = await one<{ id: string; starts_at: number; ends_at: number }>(
      c,
      `SELECT id,starts_at,ends_at FROM entitlement_sources
       WHERE user_id=? AND source_kind='subscription' AND reference=? AND revoked_at IS NULL`,
      payment.user_id,
      sourceReference,
    );
    if (!subscriptionSource || subscriptionSource.starts_at !== payment.subscription_start || subscriptionSource.ends_at !== payment.subscription_end) {
      fail(409, "The recorded subscription entitlement source is unavailable", "entitlement_source_missing");
    }
    const remainingSource = await one<{ ends_at: number | null }>(
      c,
      "SELECT MAX(ends_at) AS ends_at FROM entitlement_sources WHERE user_id=? AND revoked_at IS NULL AND reference<>?",
      payment.user_id,
      sourceReference,
    );
    const before = payment.entitlement_until;
    const after = Math.max(payment.trial_until, Number(remainingSource?.ends_at ?? 0));
    const referral = payment.referrer_id && payment.approved_at
      ? await one<{ from_id: number; to_id: number; amount: number }>(
        c,
        "SELECT from_id,to_id,amount FROM ledger WHERE reference=? AND created_at=?",
        `referral-${payment.user_id}`,
        payment.approved_at,
      )
      : null;
    let recoverable = 0;
    if (referral && referral.to_id === payment.referrer_id) {
      const wallet = await one<{ balance: number }>(c, "SELECT balance FROM wallets WHERE user_id=?", payment.referrer_id);
      recoverable = Math.min(referral.amount, wallet?.balance ?? 0);
    }
    const reversalId = `payment-reversal-${uid()}`;
    const createdAt = now();
    const statements = [
      c.env.DB.prepare(
        `INSERT INTO payment_reversals(id,payment_id,actor_id,justification,entitlement_before,entitlement_after,referral_recovered,referral_outstanding,created_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      ).bind(reversalId, paymentId, reviewer.id, justification, before, after, recoverable, referral ? referral.amount - recoverable : 0, createdAt),
      c.env.DB.prepare(
        `INSERT INTO entitlement_adjustments(id,user_id,payment_id,kind,before_at,after_at,reason,actor_id,created_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      ).bind(`entitlement-reversal-${uid()}`, payment.user_id, paymentId, "payment_reversal", before, after, `Revoked ${sourceReference} (${subscriptionSource.starts_at}-${subscriptionSource.ends_at}): ${justification}`, reviewer.id, createdAt),
      c.env.DB.prepare("UPDATE users SET entitlement_until=? WHERE id=?").bind(after, payment.user_id),
      c.env.DB.prepare("UPDATE payments SET reversed_at=? WHERE id=? AND reversed_at IS NULL").bind(createdAt, paymentId),
      ...(recoverable > 0 && payment.referrer_id
        ? [c.env.DB.prepare(
          "INSERT INTO ledger(id,from_id,to_id,amount,kind,notes,created_at,reference) VALUES(?,?,?,?,?,?,?,?)",
        ).bind(`referral-reversal-${paymentId}`, payment.referrer_id, 0, recoverable, "referral_reversal", `Compensation for ${paymentId}`, createdAt, `referral-reversal-${paymentId}`)]
        : []),
    ];
    try {
      await c.env.DB.batch(statements);
    } catch (error) {
      const duplicate = await one<{ id: string }>(c, "SELECT id FROM payment_reversals WHERE payment_id=?", paymentId);
      if (duplicate) fail(409, "This payment already has a reversal record", "already_reversed");
      throw error;
    }
    await audit(c, "payment.reversal", `payment:${paymentId}`, JSON.stringify({ justification, entitlementBefore: before, entitlementAfter: after, sourceId: subscriptionSource.id, sourceReference, sourceStartsAt: subscriptionSource.starts_at, sourceEndsAt: subscriptionSource.ends_at, referralRecovered: recoverable }));
    return c.json({
      reversal: {
        id: reversalId,
        paymentId,
        entitlementBefore: before,
        entitlementAfter: after,
        referralRecovered: recoverable,
        referralOutstanding: referral ? referral.amount - recoverable : 0,
      },
    });
  });

  app.get("/api/admin/settings", async (c) => {
    owner(c);
    const rows = await all<{ key: string; value: string }>(c, "SELECT key,value FROM settings ORDER BY key");
    const settings = rows.map(publicSetting);
    const values = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
    return c.json({
      settings,
      ...values,
      platform_lock: values.lock ?? null,
      bank_instructions: values.bank ?? null,
      seasonal: values.season ?? null,
    });
  });

  app.put("/api/admin/settings", async (c) => {
    const user = owner(c);
    fresh(c);
    const body = await input(c);
    const key = settingKey(body.key);
    const existing = await storedSetting(c, key);
    let value: string;
    if (key === "lock") {
      const raw = body.value;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(400, "Lock settings must be an object", "invalid_input");
      const lock = raw as Record<string, unknown>;
      const password = lock.password;
      const normalized = normalizeLock(lock, existing.value);
      const decoded = parseJson(normalized) as Record<string, unknown>;
      if (typeof password === "string" && password.trim()) decoded.passwordHash = await hashSecret(password.trim());
      value = JSON.stringify(decoded);
    } else {
      value = JSON.stringify(key === "bank" && body.value === undefined ? body.instructions ?? {} : body.value ?? {});
      if (value.length > 20_000) fail(400, "Setting value is too large", "invalid_input");
    }
    await run(c, "UPDATE settings SET value=? WHERE key=?", value, key);
    await audit(c, "setting.update", `setting:${key}`, JSON.stringify({ actor: user.id }));
    const setting = publicSetting({ key, value });
    return c.json({
      setting,
      [key]: setting.value,
      ...(key === "lock" ? { platform_lock: setting.value } : {}),
      ...(key === "bank" ? { bank_instructions: setting.value } : {}),
      ...(key === "season" ? { seasonal: setting.value } : {}),
    });
  });

  app.get("/api/admin/services", async (c) => {
    managerOrOwner(c);
    const services = await all<Record<string, unknown>>(c, "SELECT key,name_ar,name_en,enabled,premium,policy FROM services ORDER BY key");
    return c.json({ services: services.map((service) => ({ ...service, policy: parseJson(String(service.policy ?? "")) })) });
  });

  app.put("/api/admin/services/:key", async (c) => {
    owner(c);
    fresh(c);
    const body = await input(c);
    if (typeof body.enabled !== "boolean") fail(400, "enabled must be boolean", "invalid_input");
    const key = text(c.req.param("key"), "service key", { max: 96 });
    const current = await one<{policy:string}>(c,"SELECT policy FROM services WHERE key=?",key);
    if(!current)fail(404,"Service not found","not_found");
    const parsedPolicy=parseJson(current.policy);
    const policy:Record<string,unknown> = parsedPolicy&&typeof parsedPolicy==='object'&&!Array.isArray(parsedPolicy)?parsedPolicy as Record<string,unknown>:{};
    if(body.policy!==undefined){
      if(!body.policy||typeof body.policy!=="object"||Array.isArray(body.policy))fail(400,"policy must be an object","invalid_input");
      const proposed=body.policy as Record<string,unknown>;
      for(const source of ['trial','subscription','grant','points']){
        if(proposed[source]!==undefined){if(typeof proposed[source]!=="boolean")fail(400,"Policy source must be boolean","invalid_input");policy[source]=proposed[source];}
      }
    }
    const result = await run(c, "UPDATE services SET enabled=?,policy=? WHERE key=?", body.enabled ? 1 : 0, JSON.stringify(policy), key);
    if (!changed(result)) fail(404, "Service not found", "not_found");
    await audit(c, "service.platform", `service:${key}`, JSON.stringify({ enabled: body.enabled,policy }));
    return c.json({ service: { key, enabled: body.enabled,policy } });
  });

  app.get("/api/admin/names", async (c) => {
    owner(c);
    const names = await all<Record<string, unknown>>(
      c,
      `SELECT r.name,r.kind,r.reason,r.active,n.owner_id,n.site_id,n.created_at
       FROM reserved_names r LEFT JOIN dns_names n ON n.name=r.name ORDER BY r.name`,
    );
    return c.json({ names });
  });

  app.post("/api/admin/names", async (c) => {
    owner(c);
    fresh(c);
    const body = await input(c);
    const name = nameValue(body.name);
    const kind = text(body.kind ?? "policy", "kind", { max: 64 });
    const reason = text(body.reason, "reason", { max: 1_000 });
    const existingName = await one<{ name: string }>(c, "SELECT name FROM dns_names WHERE name=?", name);
    if (existingName) fail(409, "An owned name cannot be reserved", "name_in_use");
    await run(
      c,
      `INSERT INTO reserved_names(name,kind,reason,active) VALUES(?,?,?,1)
       ON CONFLICT(name) DO UPDATE SET kind=excluded.kind,reason=excluded.reason,active=1`,
      name,
      kind,
      reason,
    );
    await audit(c, "name.reserve", `name:${name}`, JSON.stringify({ kind, reason }));
    return c.json({ name: { name, kind, reason, active: true } });
  });

  app.post("/api/admin/names/:name/release", async (c) => {
    owner(c);
    fresh(c);
    const name = nameValue(c.req.param("name"));
    const result = await run(c, "UPDATE reserved_names SET active=0 WHERE name=? AND active=1 AND kind<>'technical'", name);
    if (!changed(result)) fail(409, "This name is not a releasable active reservation", "not_releasable");
    await audit(c, "name.release", `name:${name}`, "{}");
    return c.json({ name, active: false });
  });

  app.get("/api/admin/transfers", async (c) => {
    owner(c);
    const transfers = await all<Record<string, unknown>>(
      c,
      `SELECT t.*,f.name AS from_name,tu.name AS to_name
       FROM transfers t JOIN users f ON f.id=t.from_id JOIN users tu ON tu.id=t.to_id
       ORDER BY t.created_at DESC`,
    );
    return c.json({ transfers });
  });

  app.post("/api/admin/transfers/:id/decision", async (c) => {
    const reviewer = owner(c);
    fresh(c);
    const body = await input(c);
    const decision = decisionValue(body.decision);
    const transferId = c.req.param("id");
    const decidedAt = now();
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE transfers SET status=?,reviewer_id=?,decided_at=?
         WHERE id=? AND status='accepted'
           AND EXISTS(SELECT 1 FROM dns_names n WHERE n.name=transfers.name AND n.owner_id=transfers.from_id)`,
      ).bind(decision, reviewer.id, decidedAt, transferId),
      c.env.DB.prepare(
        `UPDATE dns_names SET owner_id=(SELECT to_id FROM transfers WHERE id=?),site_id=NULL
         WHERE name=(SELECT name FROM transfers WHERE id=?)
           AND owner_id=(SELECT from_id FROM transfers WHERE id=?)
           AND EXISTS(SELECT 1 FROM transfers WHERE id=? AND status='approved' AND reviewer_id=?)`,
      ).bind(transferId, transferId, transferId, transferId, reviewer.id),
    ]);
    if (!changed(results[0])) fail(409, "The transfer is not accepted, is stale, or the name ownership changed", "transfer_stale");
    if (decision === "approved" && !changed(results[1])) fail(409, "The name transfer could not be completed", "transfer_stale");
    const transfer = await one<Record<string, unknown>>(
      c,
      `SELECT t.*,f.name AS from_name,tu.name AS to_name
       FROM transfers t JOIN users f ON f.id=t.from_id JOIN users tu ON tu.id=t.to_id
       WHERE t.id=?`,
      transferId,
    );
    if (transfer) {
      await run(c, "INSERT INTO notifications(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)", `notification-${uid()}`, Number(transfer.from_id), "Name transfer decided", decision === "approved" ? "The accepted name transfer was approved. The prior site remains separate from the name." : "The accepted name transfer was not approved.", decidedAt);
      await run(c, "INSERT INTO notifications(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)", `notification-${uid()}`, Number(transfer.to_id), "Name transfer decided", decision === "approved" ? "The accepted name transfer was approved. No prior site content moved with the name." : "The accepted name transfer was not approved.", decidedAt);
    }
    await audit(c, "name.transfer.decision", `transfer:${transferId}`, JSON.stringify({ decision }));
    return c.json({ transfer: transfer ? { ...transfer, from_user: transfer.from_name, to_user: transfer.to_name } : null });
  });

  app.post("/api/admin/sites", async (c) => {
    const creator = managerOrOwner(c);
    fresh(c);
    const body = await input(c);
    const email = body.email === undefined || body.email === null || body.email === "" ? "" : text(body.email, "email", { min: 3, max: 320 }).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "email is invalid", "invalid_input");
    const name = body.name === undefined || body.name === null || body.name === "" ? null : nameValue(body.name);
    const draft = jsonString(body.draft, "draft");
    const authorization = text(body.authorization, "authorization", { min: 8, max: 4_000 });
    const mediaIds = proxyMediaIds(draft);
    const siteId = `site-${uid()}`;
    const handoverId = email ? `handover-${uid()}` : null;
    const createdAt = now();
    const reservationReason = `Proxy reservation for ${siteId}`;
    if (name) {
      const unavailable = await one<{ name: string }>(c, "SELECT name FROM dns_names WHERE name=?", name);
      const activeReservation = await one<{ name: string }>(c, "SELECT name FROM reserved_names WHERE name=? AND active=1", name);
      if (unavailable || activeReservation) fail(409, "Name is unavailable", "name_unavailable");
    }
    if (mediaIds.length) {
      const media = await all<{ id: string }>(
        c,
        `SELECT id FROM media
         WHERE owner_id=? AND site_id IS NULL AND purpose IN ('photo','cover','skill','work')
           AND id IN (${mediaIds.map(() => "?").join(",")})`,
        creator.id,
        ...mediaIds,
      );
      if (media.length !== mediaIds.length) fail(403, "Proxy media must be unassigned images uploaded by the authorized creator", "proxy_media_forbidden");
    }
    const mediaGuard = mediaIds.length
      ? `AND (SELECT COUNT(*) FROM media WHERE owner_id=? AND site_id IS NULL AND purpose IN ('photo','cover','skill','work') AND id IN (${mediaIds.map(() => "?").join(",")}))=?`
      : "";
    const mediaGuardArgs: Array<string | number> = mediaIds.length ? [creator.id, ...mediaIds, mediaIds.length] : [];
    const statements = [
      ...(name ? [c.env.DB.prepare(
        `INSERT INTO reserved_names(name,kind,reason,active) VALUES(?,?,?,1)
         ON CONFLICT(name) DO UPDATE SET kind=excluded.kind,reason=excluded.reason,active=1 WHERE reserved_names.active=0`,
      ).bind(name, "proxy_pending", reservationReason)] : []),
      c.env.DB.prepare(
        `INSERT INTO sites(id,user_id,manager_id,draft,draft_version,status,created_at,updated_at,authorization)
         SELECT ?,NULL,?,?,0,'proxy_pending',?,?,?
         WHERE (? IS NULL OR EXISTS(SELECT 1 FROM reserved_names WHERE name=? AND kind='proxy_pending' AND reason=? AND active=1))
         ${mediaGuard}`,
      ).bind(siteId, creator.id, draft, createdAt, createdAt, authorization, name, name, reservationReason, ...mediaGuardArgs),
      c.env.DB.prepare(
        `INSERT INTO proxy_sites(site_id,pending_name,target_email,authorization,creator_id,created_at)
         SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sites WHERE id=?)`,
      ).bind(siteId, name, email, authorization, creator.id, createdAt, siteId),
      ...(mediaIds.length ? [c.env.DB.prepare(
        `UPDATE media SET site_id=?
         WHERE owner_id=? AND site_id IS NULL AND purpose IN ('photo','cover','skill','work')
           AND id IN (${mediaIds.map(() => "?").join(",")})`,
      ).bind(siteId, creator.id, ...mediaIds)] : []),
      ...(handoverId ? [c.env.DB.prepare(
        `INSERT INTO handovers(id,site_id,target_email,creator_id,status,created_at)
         SELECT ?,?,?,?,'pending',? WHERE EXISTS(SELECT 1 FROM sites WHERE id=?)`,
      ).bind(handoverId, siteId, email, creator.id, createdAt, siteId)] : []),
      c.env.DB.prepare(
        `INSERT INTO site_custody(id,site_id,event,actor_id,manager_id,detail,created_at)
         SELECT ?,?,'proxy_created',?,?,?,? WHERE EXISTS(SELECT 1 FROM sites WHERE id=?)`,
      ).bind(`custody-create-${uid()}`, siteId, creator.id, creator.id, authorization, createdAt, siteId),
    ];
    const results = await c.env.DB.batch(statements);
    const siteStatementIndex = name ? 1 : 0;
    if (!changed(results[siteStatementIndex])) fail(409, "The requested name is no longer available", "name_unavailable");
    await audit(c, "site.proxy.create", `site:${siteId}`, JSON.stringify({ email: email || null, name, authorization }));
    return c.json({
      site: { id: siteId, status: "proxy_pending", handoverId, name },
      handover: handoverId ? { id: handoverId, targetEmail: email, status: "pending" } : null,
    }, 201);
  });

  app.post("/api/admin/sites/:id/handover", async (c) => {
    const user = managerOrOwner(c);
    fresh(c);
    const siteId = c.req.param("id");
    const site = await siteInManagerScope(c, siteId);
    const proxy = await one<{ creator_id: number; consented_at: number | null }>(c, "SELECT creator_id,consented_at FROM proxy_sites WHERE site_id=?", siteId);
    if (!proxy || proxy.consented_at !== null || site.user_id !== null) fail(409, "Only an unaccepted proxy site can be delivered by an administrator", "handover_state");
    if (user.role === "manager" && proxy.creator_id !== user.id) fail(403, "Only the authorized proxy creator can request this handover", "scope_denied");
    const body = await input(c);
    const email = text(body.email, "email", { min: 3, max: 320 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "email is invalid", "invalid_input");
    const open = await one<{ id: string }>(c, "SELECT id FROM handovers WHERE site_id=? AND status='pending'", siteId);
    if (open) fail(409, "This site already has a pending handover", "handover_pending");
    const handoverId = `handover-${uid()}`;
    const createdAt = now();
    await run(c, "INSERT INTO handovers(id,site_id,target_email,creator_id,status,created_at) VALUES(?,?,?,?,?,?)", handoverId, siteId, email, user.id, "pending", createdAt);
    await run(c, "INSERT INTO site_custody(id,site_id,event,actor_id,manager_id,handover_id,detail,created_at) VALUES(?,?,?,?,?,?,?,?)", `custody-handover-${uid()}`, siteId, "handover_requested", user.id, user.id, handoverId, `Handover requested for ${email}`, createdAt);
    await audit(c, "site.handover.request", `site:${siteId}`, JSON.stringify({ handoverId, email }));
    return c.json({ handover: { id: handoverId, siteId, targetEmail: email, status: "pending" } }, 201);
  });

  app.post("/api/admin/notifications", async (c) => {
    const body = await input(c);
    const recipients = await notificationTargets(c, body.recipient);
    const title = text(body.title, "title", { max: 200 });
    const message = text(body.body ?? "", "body", { min: 0, max: 2_000, optional: true });
    const createdAt = now();
    await c.env.DB.batch(recipients.map((recipient) => c.env.DB.prepare("INSERT INTO notifications(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)").bind(`notification-${uid()}`, recipient, title, message, createdAt)));
    await audit(c, "notification.send", `notification:${createdAt}`, JSON.stringify({ recipients, title }));
    return c.json({ delivered: recipients.length, recipients: recipients.map((id) => `C${id}`) }, 201);
  });

  app.get("/api/admin/audit", async (c) => {
    owner(c);
    const limit = integer(c.req.query("limit") ?? "100", "limit", 1, 200);
    const before = c.req.query("before") ? integer(c.req.query("before"), "before", 1) : Number.MAX_SAFE_INTEGER;
    const auditRows = await all<Record<string, unknown>>(
      c,
      `SELECT a.id,a.actor_id,a.action,a.target,a.detail,a.created_at,u.name AS actor_name,u.email AS actor_email
       FROM audit a LEFT JOIN users u ON u.id=a.actor_id
       WHERE a.id<? ORDER BY a.id DESC LIMIT ?`,
      before,
      limit,
    );
    return c.json({ audit: auditRows.map((entry) => ({ ...entry, detail: parseJson(String(entry.detail ?? "")) ?? {} })) });
  });

  app.get("/api/admin/economics", async (c) => {
    owner(c);
    const clock = now();
    const revenue = await one<{ total: number | null }>(
      c,
      "SELECT COALESCE(SUM(p.amount),0) AS total FROM payments p LEFT JOIN payment_reversals r ON r.payment_id=p.id WHERE p.status='approved' AND r.id IS NULL",
    );
    const [expenses, active, paid, trials, recentUsers, renewedUsers, completedTrials, successfulReferrals] = await Promise.all([
      one<{ total: number | null }>(c, "SELECT COALESCE(SUM(amount),0) AS total FROM expenses"),
      one<{ count: number }>(c, "SELECT COUNT(*) AS count FROM users WHERE status='active'"),
      one<{ count: number }>(c, "SELECT COUNT(DISTINCT s.user_id) AS count FROM subscriptions s JOIN payments p ON p.id=s.payment_id LEFT JOIN payment_reversals r ON r.payment_id=p.id WHERE p.status='approved' AND r.id IS NULL"),
      one<{ count: number }>(c, "SELECT COUNT(*) AS count FROM users WHERE trial_until>? AND entitlement_until<=trial_until", clock),
      one<{ count: number }>(c, "SELECT COUNT(*) AS count FROM users WHERE created_at>=?", clock - 30 * DAY),
      one<{ count: number }>(c, `SELECT COUNT(*) AS count FROM (
        SELECT s.user_id FROM subscriptions s JOIN payments p ON p.id=s.payment_id
        LEFT JOIN payment_reversals r ON r.payment_id=p.id
        WHERE p.status='approved' AND r.id IS NULL GROUP BY s.user_id HAVING COUNT(*)>=2
      )`),
      one<{ count: number }>(c, "SELECT COUNT(*) AS count FROM users WHERE trial_until>0 AND trial_until<=?", clock),
      one<{ count: number }>(c, `SELECT COUNT(*) AS count FROM ledger l
        JOIN payments p ON l.reference='referral-'||p.user_id
        LEFT JOIN payment_reversals r ON r.payment_id=p.id
        WHERE l.kind='referral' AND p.status='approved' AND r.id IS NULL`),
    ]);
    const expenseTotal = Number(expenses?.total ?? 0);
    const revenueTotal = Number(revenue?.total ?? 0);
    const activeCount = active?.count ?? 0;
    const paidCount = paid?.count ?? 0;
    const completedTrialCount = completedTrials?.count ?? 0;
    const renewalRate = paidCount ? (renewedUsers?.count ?? 0) / paidCount : null;
    const trialConversion = completedTrialCount ? paidCount / completedTrialCount : null;
    const metrics = {
      active_users: activeCount,
      cost_per_active_user: activeCount ? expenseTotal / activeCount : null,
      storage_usage: null,
      email_usage: null,
      request_usage: null,
      user_growth: recentUsers?.count ?? 0,
      renewal_rate: renewalRate,
      trial_conversion: trialConversion,
      successful_referrals: successfulReferrals?.count ?? 0,
      acquisition_cost: paidCount ? expenseTotal / paidCount : null,
      approved_revenue: revenueTotal,
      recorded_expenses: expenseTotal,
      operating_profitability: revenueTotal - expenseTotal,
    };
    return c.json({
      metrics,
      economics: {
        activeUsers: activeCount,
        paidUsers: paidCount,
        activeTrials: trials?.count ?? 0,
        approvedRevenue: revenueTotal,
        recordedExpenses: expenseTotal,
        operatingResult: revenueTotal - expenseTotal,
        costPerActiveUser: activeCount ? expenseTotal / activeCount : null,
        storageUsage: null,
        mailUsage: null,
        requestUsage: null,
        userGrowthLast30Days: recentUsers?.count ?? 0,
        renewalRate,
        trialConversionRate: trialConversion,
        successfulReferrals: successfulReferrals?.count ?? 0,
        acquisitionCost: paidCount ? expenseTotal / paidCount : null,
      },
    });
  });

  app.post("/api/admin/expenses", async (c) => {
    const user = requireFinance(c);
    const body = await input(c);
    const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) fail(400, "amount is invalid", "invalid_input");
    const label = body.description ?? body.label;
    const description = text(label, "description", { max: 2_000 });
    const notes = text(body.notes ?? "", "notes", { min: 0, max: 2_000, optional: true });
    const storedDescription = notes ? `${description}\n${notes}` : description;
    const id = `expense-${uid()}`;
    const createdAt = now();
    await run(c, "INSERT INTO expenses(id,amount,description,created_at) VALUES(?,?,?,?)", id, amount, storedDescription, createdAt);
    await audit(c, "expense.record", `expense:${id}`, JSON.stringify({ amount, description, notes, delegated: user.role === "manager" }));
    return c.json({ expense: { id, amount, description, notes, createdAt, created_at: createdAt } }, 201);
  });

  app.get("/api/admin/backup", async (c) => {
    owner(c);
    fresh(c);
    const tables: Record<string, unknown[]> = {};
    for (const table of BACKUP_TABLES) {
      tables[table] = await all<Record<string, unknown>>(c, `SELECT * FROM ${table}`);
    }
    tables.users = tables.users.map((row) => responseUser(row as Record<string, unknown>));
    tables.sites = tables.sites.map((row) => {
      const { lock_hash: _lockHash, ...safe } = row as Record<string, unknown>;
      return safe;
    });
    tables.settings = tables.settings.map((row) => publicSetting(row as { key: string; value: string }));
    await audit(c, "backup.export", "backup:operations", JSON.stringify({ tables: BACKUP_TABLES.length }));
    return c.json({
      status: "ready",
      format: "ksa-men-backup-v1",
      generatedAt: now(),
      createdAt: now(),
      excluded: ["auth_codes", "sessions", "devices", "rate_limits", "users.pin_hash", "sites.lock_hash", "settings.lock.passwordHash", "contact_requests", "conversations", "messages", "blocks", "reports"],
      restoration: {
        migrationOrder: ["0001_initial.sql", "0002_business.sql", "0003_operations.sql"],
        instructions: [
          "Create an isolated D1 database and apply migrations in order before importing data.",
          "Restore only after independently verifying the backup checksum and target database identity.",
          "Do not import auth secrets; require affected users to establish fresh sessions and credentials.",
          "Import referenced media objects separately into the configured media bucket before making profiles public.",
          "Review the audit, payment reversal, custody and entitlement adjustment tables after restoration.",
        ],
      },
      tables,
    });
  });

  app.get("/api/content/:slug", async (c) => {
    const slug = text(c.req.param("slug"), "slug", { max: 96 });
    const content = await one<Record<string, unknown>>(c, "SELECT slug,title_ar,title_en,body_ar,body_en,status,updated_at FROM content WHERE slug=? AND status='published'", slug);
    if (!content) fail(404, "Content not found", "not_found");
    return c.json({ ...content, content });
  });

  app.put("/api/admin/content/:slug", async (c) => {
    owner(c);
    fresh(c);
    const slug = text(c.req.param("slug"), "slug", { max: 96 });
    const body = await input(c);
    const existing = await one<{ title_ar: string; title_en: string; body_ar: string; body_en: string; status: string; created_at: number }>(c, "SELECT title_ar,title_en,body_ar,body_en,status,created_at FROM content WHERE slug=?", slug);
    const supplied = body.content && typeof body.content === "object" && !Array.isArray(body.content)
      ? body.content as Record<string, unknown>
      : body;
    const plainContent = typeof body.content === "string" ? body.content : undefined;
    const titleAr = text(supplied.titleAr ?? supplied.title_ar ?? existing?.title_ar, "titleAr", { max: 250 });
    const titleEn = text(supplied.titleEn ?? supplied.title_en ?? existing?.title_en, "titleEn", { max: 250 });
    const bodyAr = text(supplied.bodyAr ?? supplied.body_ar ?? plainContent ?? existing?.body_ar, "bodyAr", { min: 20, max: 100_000 });
    const bodyEn = text(supplied.bodyEn ?? supplied.body_en ?? plainContent ?? existing?.body_en, "bodyEn", { min: 20, max: 100_000 });
    const status = text(supplied.status ?? existing?.status ?? "published", "status", { max: 16 });
    if (status !== "published" && status !== "draft") fail(400, "Content status is invalid", "invalid_input");
    const updatedAt = now();
    await run(
      c,
      `INSERT INTO content(slug,title_ar,title_en,body_ar,body_en,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(slug) DO UPDATE SET title_ar=excluded.title_ar,title_en=excluded.title_en,body_ar=excluded.body_ar,body_en=excluded.body_en,status=excluded.status,updated_at=excluded.updated_at`,
      slug,
      titleAr,
      titleEn,
      bodyAr,
      bodyEn,
      status,
      existing?.created_at ?? updatedAt,
      updatedAt,
    );
    await audit(c, "content.update", `content:${slug}`, JSON.stringify({ status }));
    return c.json({
      content: {
        slug,
        title_ar: titleAr,
        title_en: titleEn,
        body_ar: bodyAr,
        body_en: bodyEn,
        status,
        updated_at: updatedAt,
      },
    });
  });

  app.get("/api/messages", async (c) => {
    const user = me(c) as Actor;
    const clock = now();
    await run(c, "UPDATE conversations SET status='expired' WHERE status='active' AND last_activity<? AND (from_id=? OR to_id=?)", clock - MESSAGE_WINDOW, user.id, user.id);
    const [requests, conversations, blocks, retention] = await Promise.all([
      all<Record<string, unknown>>(
        c,
        `SELECT r.id,r.from_id,r.to_id,r.status,r.created_at,r.decided_at,u.name AS from_name
         FROM contact_requests r JOIN users u ON u.id=r.from_id
         WHERE r.from_id=? OR r.to_id=? ORDER BY r.created_at DESC`,
        user.id,
        user.id,
      ),
      all<Record<string, unknown>>(
        c,
        `SELECT c.id,c.request_id,c.from_id,c.to_id,c.status,c.last_activity,
                CASE WHEN c.from_id=? THEN tu.id ELSE fu.id END AS other_id,
                CASE WHEN c.from_id=? THEN tu.name ELSE fu.name END AS other_name
         FROM conversations c JOIN users fu ON fu.id=c.from_id JOIN users tu ON tu.id=c.to_id
         WHERE c.from_id=? OR c.to_id=? ORDER BY c.last_activity DESC`,
        user.id,
        user.id,
        user.id,
        user.id,
      ),
      all<Record<string, unknown>>(
        c,
        `SELECT b.user_id,b.blocked_id,b.created_at,u.name AS blocked_name
         FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=? ORDER BY b.created_at DESC`,
        user.id,
      ),
      one<{ value: string }>(c, "SELECT value FROM settings WHERE key='retention'"),
    ]);
    return c.json({ requests, conversations, blocks, retention: parseJson(retention?.value) ?? {} });
  });

  app.post("/api/contact/request", async (c) => {
    const user = me(c) as Actor;
    const body = await input(c);
    const recipient = customerId(body.recipient);
    if (recipient === user.id) fail(400, "You cannot contact yourself", "invalid_input");
    await contactAllowed(c, recipient);
    if (await pairBlocked(c, user.id, recipient)) fail(403, "Contact is blocked for this pair", "blocked");
    const clock = now();
    await run(c, `UPDATE conversations SET status='expired' WHERE status='active' AND last_activity<? AND ${contactPairSql()}`, clock - MESSAGE_WINDOW, user.id, recipient, recipient, user.id);
    const activeConversation = await one<{ id: string }>(
      c,
      `SELECT id FROM conversations WHERE status='active' AND ${contactPairSql()}`,
      user.id,
      recipient,
      recipient,
      user.id,
    );
    if (activeConversation) fail(409, "An active conversation already exists for this pair", "conversation_active");
    const existing = await one<{ id: string }>(
      c,
      `SELECT id FROM contact_requests WHERE ${contactPairSql()} AND status='pending'`,
      user.id,
      recipient,
      recipient,
      user.id,
    );
    if (existing) fail(409, "A contact request is already awaiting a decision", "request_pending");
    const requestId = `contact-${uid()}`;
    const createdAt = now();
    let results: D1Change[];
    try {
      results = await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO contact_requests(id,from_id,to_id,status,created_at)
           SELECT ?,?,?,?,? WHERE NOT EXISTS(
             SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)
           )`,
        ).bind(requestId, user.id, recipient, "pending", createdAt, user.id, recipient, recipient, user.id),
        c.env.DB.prepare(
          `INSERT INTO notifications(id,user_id,title,body,created_at)
           SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM contact_requests WHERE id=? AND status='pending')`,
        ).bind(`notification-${uid()}`, recipient, "Contact request", `C${user.id} requested permission to start a text conversation.`, createdAt, requestId),
      ]) as D1Change[];
    } catch {
      if (await pairBlocked(c, user.id, recipient)) fail(403, "Contact is blocked for this pair", "blocked");
      fail(409, "A contact request is already awaiting a decision", "request_pending");
    }
    if (!changed(results[0])) fail(403, "Contact is blocked for this pair", "blocked");
    await audit(c, "contact.request", `contact:${requestId}`, JSON.stringify({ from: user.id, to: recipient }));
    return c.json({ request: { id: requestId, recipient: `C${recipient}`, status: "pending", createdAt } }, 201);
  });

  app.post("/api/contact/:id/decision", async (c) => {
    const user = me(c) as Actor;
    const body = await input(c);
    if (typeof body.accept !== "boolean") fail(400, "accept must be boolean", "invalid_input");
    const requestId = c.req.param("id");
    const request = await one<{ id: string; from_id: number; to_id: number; status: string }>(c, "SELECT id,from_id,to_id,status FROM contact_requests WHERE id=?", requestId);
    if (!request) fail(404, "Contact request not found", "not_found");
    if (request.to_id !== user.id) fail(403, "Only the recipient can decide this request", "scope_denied");
    if (request.status !== "pending") fail(409, "This request already has a decision", "request_stale");
    if (body.accept && await pairBlocked(c, request.from_id, request.to_id)) fail(403, "Contact is blocked for this pair", "blocked");
    const decidedAt = now();
    if (body.accept) {
      await run(c, `UPDATE conversations SET status='expired' WHERE status='active' AND last_activity<? AND ${contactPairSql()}`, decidedAt - MESSAGE_WINDOW, request.from_id, request.to_id, request.to_id, request.from_id);
      const activeConversation = await one<{ id: string }>(
        c,
        `SELECT id FROM conversations WHERE status='active' AND ${contactPairSql()}`,
        request.from_id,
        request.to_id,
        request.to_id,
        request.from_id,
      );
      if (activeConversation) fail(409, "An active conversation already exists for this pair", "conversation_active");
    }
    const conversationId = `conversation-${uid()}`;
    const statements = [
      c.env.DB.prepare(
        `UPDATE contact_requests SET status=?,decided_at=?
         WHERE id=? AND to_id=? AND status='pending'
           AND (?=0 OR NOT EXISTS(SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)))`,
      ).bind(body.accept ? "accepted" : "rejected", decidedAt, requestId, user.id, body.accept ? 1 : 0, request.from_id, request.to_id, request.to_id, request.from_id),
      ...(body.accept ? [c.env.DB.prepare(
        `INSERT INTO conversations(id,request_id,from_id,to_id,status,last_activity)
         SELECT ?,id,from_id,to_id,'active',? FROM contact_requests
         WHERE id=? AND status='accepted' AND NOT EXISTS(
           SELECT 1 FROM blocks WHERE (user_id=contact_requests.from_id AND blocked_id=contact_requests.to_id) OR (user_id=contact_requests.to_id AND blocked_id=contact_requests.from_id)
         )`,
      ).bind(conversationId, decidedAt, requestId)] : []),
      c.env.DB.prepare(
        `INSERT INTO notifications(id,user_id,title,body,created_at)
         SELECT ?,from_id,?,?,? FROM contact_requests WHERE id=? AND to_id=? AND status=? AND decided_at=?`,
      ).bind(`notification-${uid()}`, "Contact request decided", body.accept ? "Your contact request was accepted for a 24-hour text session." : "Your contact request was not accepted.", decidedAt, requestId, user.id, body.accept ? "accepted" : "rejected", decidedAt),
    ];
    const results = await c.env.DB.batch(statements);
    if (!changed(results[0])) fail(409, "This request is no longer awaiting a decision", "request_stale");
    if (body.accept && !changed(results[1])) fail(403, "Contact is blocked for this pair", "blocked");
    await audit(c, "contact.decision", `contact:${requestId}`, JSON.stringify({ accept: body.accept, from: request.from_id, to: user.id }));
    return c.json({ requestId, status: body.accept ? "accepted" : "rejected", conversationId: body.accept ? conversationId : null });
  });

  app.get("/api/conversations/:id", async (c) => {
    const user = me(c) as Actor;
    const id = c.req.param("id");
    const clock = now();
    await run(c, "UPDATE conversations SET status='expired' WHERE id=? AND status='active' AND last_activity<?", id, clock - MESSAGE_WINDOW);
    const conversation = await one<Record<string, unknown>>(c, "SELECT * FROM conversations WHERE id=? AND (from_id=? OR to_id=?)", id, user.id, user.id);
    if (!conversation) fail(404, "Conversation not found", "not_found");
    if (conversation.status === "expired") fail(410, "This conversation has expired; message history is unavailable", "conversation_expired");
    const messages = await all<Record<string, unknown>>(c, "SELECT id,conversation_id,sender_id,body,created_at FROM messages WHERE conversation_id=? ORDER BY created_at ASC", id);
    return c.json({ conversation, messages });
  });

  app.post("/api/conversations/:id/messages", async (c) => {
    const user = me(c) as Actor;
    const body = await input(c);
    const messageBody = text(body.body, "body", { max: 1_000 });
    if (!validMessage(messageBody)) fail(400, "Messages must be plain text with only selected positive emoji", "invalid_message");
    const id = c.req.param("id");
    const clock = now();
    const conversation = await one<{ id: string; from_id: number; to_id: number; status: string; last_activity: number }>(c, "SELECT id,from_id,to_id,status,last_activity FROM conversations WHERE id=? AND (from_id=? OR to_id=?)", id, user.id, user.id);
    if (!conversation) fail(404, "Conversation not found", "not_found");
    if (conversation.status !== "active" || conversation.last_activity < clock - MESSAGE_WINDOW) {
      await run(c, "UPDATE conversations SET status='expired' WHERE id=? AND status='active'", id);
      fail(410, "This conversation has ended; a new contact request is required", "conversation_ended");
    }
    const other = conversation.from_id === user.id ? conversation.to_id : conversation.from_id;
    if (await pairBlocked(c, user.id, other)) fail(403, "Messaging is blocked for this pair", "blocked");
    const messageId = `message-${uid()}`;
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE conversations SET last_activity=?
         WHERE id=? AND status='active' AND last_activity>=?
           AND NOT EXISTS(SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?))`,
      ).bind(clock, id, clock - MESSAGE_WINDOW, user.id, other, other, user.id),
      c.env.DB.prepare(
        `INSERT INTO messages(id,conversation_id,sender_id,body,created_at)
         SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM conversations WHERE id=? AND status='active' AND last_activity=?)`,
      ).bind(messageId, id, user.id, messageBody, clock, id, clock),
    ]);
    if (!changed(results[0]) || !changed(results[1])) fail(410, "This conversation has ended; a new contact request is required", "conversation_ended");
    return c.json({ message: { id: messageId, conversationId: id, senderId: user.id, body: messageBody, createdAt: clock } }, 201);
  });

  app.post("/api/conversations/:id/end", async (c) => {
    const user = me(c) as Actor;
    const id = c.req.param("id");
    const result = await run(c, "UPDATE conversations SET status='ended' WHERE id=? AND status='active' AND (from_id=? OR to_id=?)", id, user.id, user.id);
    if (!changed(result)) fail(409, "This conversation is not active", "conversation_ended");
    await audit(c, "conversation.end", `conversation:${id}`, JSON.stringify({ actor: user.id }));
    return c.json({ conversationId: id, status: "ended" });
  });

  app.post("/api/blocks", async (c) => {
    const user = me(c) as Actor;
    const body = await input(c);
    const blocked = customerId(body.userId, "userId");
    if (blocked === user.id) fail(400, "You cannot block yourself", "invalid_input");
    const target = await one<{ id: number }>(c, "SELECT id FROM users WHERE id=?", blocked);
    if (!target) fail(404, "User not found", "not_found");
    const createdAt = now();
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT OR IGNORE INTO blocks(user_id,blocked_id,created_at) VALUES(?,?,?)").bind(user.id, blocked, createdAt),
      c.env.DB.prepare(`UPDATE conversations SET status='ended' WHERE status='active' AND ${contactPairSql()}`).bind(user.id, blocked, blocked, user.id),
      c.env.DB.prepare(`UPDATE contact_requests SET status='cancelled',decided_at=? WHERE status='pending' AND ${contactPairSql()}`).bind(createdAt, user.id, blocked, blocked, user.id),
    ]);
    await audit(c, "conversation.block", `user:${blocked}`, JSON.stringify({ actor: user.id }));
    return c.json({ block: { userId: user.id, blockedId: blocked, createdAt }, conversationsEnded: true });
  });

  app.post("/api/reports", async (c) => {
    const user = me(c) as Actor;
    const body = await input(c);
    const conversationId = text(body.conversationId, "conversationId", { max: 128 });
    const reason = text(body.reason, "reason", { min: 3, max: 2_000 });
    const suppliedEvidence = text(body.evidence ?? reason, "evidence", { min: 3, max: 4_000 });
    const conversation = await one<{ id: string }>(c, "SELECT id FROM conversations WHERE id=? AND (from_id=? OR to_id=?)", conversationId, user.id, user.id);
    if (!conversation) fail(404, "Conversation not found", "not_found");
    const id = `report-${uid()}`;
    const createdAt = now();
    const evidence = JSON.stringify({ reporterId: user.id, statement: suppliedEvidence, recordedAt: createdAt });
    await run(c, "INSERT INTO reports(id,user_id,conversation_id,reason,evidence,status,created_at) VALUES(?,?,?,?,?,?,?)", id, user.id, conversationId, reason, evidence, "pending", createdAt);
    await audit(c, "report.create", `report:${id}`, JSON.stringify({ conversationId, reporterId: user.id }));
    return c.json({ report: { id, conversationId, status: "pending", createdAt } }, 201);
  });

  app.get("/api/admin/reports/:id/evidence", async (c) => {
    owner(c);
    fresh(c);
    const justification = text(c.req.query("justification"), "justification", { min: 8, max: 1_000 });
    const report = await one<Record<string, unknown>>(c, "SELECT id,user_id,conversation_id,reason,evidence,status,created_at FROM reports WHERE id=?", c.req.param("id"));
    if (!report) fail(404, "Report not found", "not_found");
    await audit(c, "report.evidence.view", `report:${String(report.id)}`, JSON.stringify({ justification }));
    return c.json({ report: { ...report, evidence: parseJson(String(report.evidence ?? "")) } });
  });

  app.post("/api/notifications/:id/read", async (c) => {
    const user = me(c) as Actor;
    const result = await run(c, "UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL", now(), c.req.param("id"), user.id);
    if (!changed(result)) {
      const exists = await one<{ id: string }>(c, "SELECT id FROM notifications WHERE id=? AND user_id=?", c.req.param("id"), user.id);
      if (!exists) fail(404, "Notification not found", "not_found");
    }
    return c.json({ id: c.req.param("id"), read: true });
  });
}
