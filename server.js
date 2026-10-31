const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" });
  next();
});
app.use(express.static("public"));
app.use("/api", express.json({ limit: "16kb" }));

const database = mysql.createPool({
  host: "10.200.210.117",
  port: 3306,
  user: "std-yell",
  password: "std-yell",
  database: "db_std-yell",
  waitForConnections: true,
  connectionLimit: 5,
  charset: "utf8mb4",
  timezone: "Z",
  dateStrings: ["DATE"],
  decimalNumbers: true
});

const API = "/api/v1";
const TIME_ZONE = "Asia/Bangkok";
const SESSION_COOKIE = "tln_session";
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const BOOKING_STATUSES = ["pending", "confirmed", "cancelled", "rejected"];
const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed"];
const EVENT_STATUSES = ["scheduled", "open", "closed"];
const BOOKABLE_EVENT_STATUSES = ["scheduled", "open"];
const BOOTH_AVAILABILITY = ["available", "booked", "maintenance", "unavailable"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^\+?\d{9,15}$/;
const MARKET_FIELDS = "id, market_name AS marketName, address, open_time AS openTime, close_time AS closeTime, description";
const EVENT_SELECT = "SELECT e.id, e.market_id AS marketId, e.event_name AS eventName, e.event_date AS eventDate, COALESCE(e.open_time, m.open_time) AS openTime, COALESCE(e.close_time, m.close_time) AS closeTime, e.status FROM market_events e JOIN markets m ON m.id = e.market_id";
const BOOKING_SELECT = "SELECT bk.id, bk.status, bk.price_at_booking AS price, bk.booked_at AS bookedAt, bk.cancelled_at AS cancelledAt, m.id AS marketId, m.market_name AS marketName, m.address AS marketAddress, e.id AS eventId, e.event_name AS eventName, e.event_date AS eventDate, COALESCE(e.open_time, m.open_time) AS openTime, COALESCE(e.close_time, m.close_time) AS closeTime, e.status AS eventStatus, b.id AS boothId, b.booth_code AS boothCode, b.width, b.depth, b.map_x AS mapX, b.map_y AS mapY FROM bookings bk JOIN market_events e ON e.id = bk.event_id JOIN markets m ON m.id = e.market_id JOIN booths b ON b.id = bk.booth_id";
const PROFILE_SELECT = "SELECT s.id, s.shop_name AS shopName, s.category, s.description, s.contact_phone AS contactPhone, s.updated_at AS updatedAt, u.email, u.phone FROM shops s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.user_id = ?";
const PROFILE_RULES = {
  shopName: { column: "shop_name", max: 150, required: true },
  category: { column: "category", max: 100 },
  description: { column: "description", max: 1000 },
  contactPhone: { column: "contact_phone", max: 20, phone: true }
};
const sessions = new Map();
const rateBuckets = new Map();
// Compared against when the email does not exist, so failed logins take similar time.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 10);

function fail(res, status, code, message, fields) {
  return res.status(status).json({ error: { code, message, ...(fields && Object.keys(fields).length ? { fields } : {}) } });
}
function serverError(res, label, error, message) {
  console.error(`${label} failed:`, error?.code || error?.name || "unknown");
  return fail(res, 500, "INTERNAL_ERROR", message);
}
function audit(event, details = {}) { console.log(JSON.stringify({ audit: event, at: new Date().toISOString(), ...details })); }
function sendList(res, rows, paging, total) {
  res.json({ data: rows, pagination: { page: paging.page, limit: paging.limit, total, totalPages: Math.ceil(total / paging.limit) } });
}
function toId(value) {
  const raw = String(value ?? "");
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const id = Number(raw);
  return id <= 4294967295 ? id : null;
}
function isJsonId(value) { return Number.isInteger(value) && value > 0 && value <= 4294967295; }
function isPlainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value) { return typeof value === "string" ? value.trim() : ""; }
function normalizePhone(value) { return text(value).replace(/[\s-]/g, ""); }
function likePattern(value) { return `%${value.replace(/[\\%_]/g, "\\$&")}%`; }
function nowSeconds() { return new Date(Math.floor(Date.now() / 1000) * 1000); }
function todayInMarket() { return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date()); }
function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function withBookable(event) { return { ...event, bookable: BOOKABLE_EVENT_STATUSES.includes(event.status) && event.eventDate >= todayInMarket() }; }
function bookingOut(row) {
  return {
    id: row.id, status: row.status, price: row.price, bookedAt: row.bookedAt, cancelledAt: row.cancelledAt,
    canCancel: ACTIVE_BOOKING_STATUSES.includes(row.status),
    market: { id: row.marketId, marketName: row.marketName, address: row.marketAddress },
    event: { id: row.eventId, eventName: row.eventName, eventDate: row.eventDate, openTime: row.openTime, closeTime: row.closeTime, status: row.eventStatus },
    booth: { id: row.boothId, boothCode: row.boothCode, width: row.width, depth: row.depth, mapX: row.mapX, mapY: row.mapY }
  };
}
function profileOut(row) {
  return { id: row.id, shopName: row.shopName, category: row.category, description: row.description, contactPhone: row.contactPhone, updatedAt: row.updatedAt, account: { email: row.email, phone: row.phone } };
}
function readCookie(req, name) {
  for (const part of (req.get("cookie") || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) { try { return decodeURIComponent(rest.join("=")); } catch { return ""; } }
  }
  return "";
}
function sameOrigin(req) {
  const source = req.get("origin") || req.get("referer");
  if (!source) return false;
  try { return new URL(source).host === req.get("host"); } catch { return false; }
}
function createSession(req, res, userId, shopId) {
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, { userId, shopId, expiresAt: Date.now() + SESSION_TTL_MS });
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/api", maxAge: SESSION_TTL_MS });
  return token;
}

// Validates optional query values against a rule per key: "id", "date", a max length, or a list of allowed values.
function readQuery(req, res, rules) {
  const values = {};
  const fields = {};
  for (const [key, rule] of Object.entries(rules)) {
    const raw = req.query[key];
    values[key] = null;
    if (raw === undefined || raw === "") continue;
    if (typeof raw !== "string") { fields[key] = "ส่งค่าได้เพียงค่าเดียว"; continue; }
    const value = raw.trim();
    if (rule === "id") { values[key] = toId(value); if (!values[key]) fields[key] = "รหัสไม่ถูกต้อง"; }
    else if (rule === "date") { if (isValidDate(value)) values[key] = value; else fields[key] = "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD"; }
    else if (Array.isArray(rule)) { if (rule.includes(value)) values[key] = value; else fields[key] = `ค่าที่อนุญาต: ${rule.join(", ")}`; }
    else if (value.length <= rule) values[key] = value || null;
    else fields[key] = `ยาวได้ไม่เกิน ${rule} ตัวอักษร`;
  }
  if (values.fromDate && values.toDate && values.fromDate > values.toDate) fields.toDate = "วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น";
  if (Object.keys(fields).length) { fail(res, 400, "INVALID_QUERY", "ค่าที่ใช้ค้นหาไม่ถูกต้อง", fields); return null; }
  return values;
}
function validatePage(req, res, next) {
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) return fail(res, 400, "INVALID_QUERY", "ค่า page หรือ limit ไม่ถูกต้อง (limit สูงสุด 100)");
  req.paging = { page, limit, offset: (page - 1) * limit };
  next();
}
function rateLimit(name, max, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) { bucket = { count: 0, resetAt: now + windowMs }; rateBuckets.set(key, bucket); }
    bucket.count += 1;
    if (bucket.count > max) {
      res.set("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return fail(res, 429, "RATE_LIMITED", "ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่");
    }
    next();
  };
}
function publicCache(seconds) { return (req, res, next) => { res.set("Cache-Control", seconds ? `public, max-age=${seconds}` : "no-cache"); next(); }; }

async function auth(req, res, next) {
  res.set("Cache-Control", "no-store");
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.get("authorization") || "")?.[1];
  const token = bearer || readCookie(req, SESSION_COOKIE);
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt <= Date.now()) {
    if (session) sessions.delete(token);
    return fail(res, 401, "UNAUTHORIZED", "กรุณาเข้าสู่ระบบใหม่");
  }
  // Cookie sessions are sent automatically by the browser, so state-changing requests must come from this site.
  if (!bearer && !["GET", "HEAD"].includes(req.method) && !sameOrigin(req)) return fail(res, 403, "FORBIDDEN", "คำขอนี้ไม่ได้มาจากหน้าเว็บของระบบ");
  try {
    const [rows] = await database.execute("SELECT u.is_active, s.id AS shopId FROM users u JOIN shops s ON s.user_id = u.id WHERE u.id = ? LIMIT 1", [session.userId]);
    if (!rows.length) { sessions.delete(token); return fail(res, 401, "UNAUTHORIZED", "กรุณาเข้าสู่ระบบใหม่"); }
    if (!rows[0].is_active) { sessions.delete(token); return fail(res, 403, "ACCOUNT_DISABLED", "บัญชีนี้ถูกปิดใช้งาน"); }
    req.user = { userId: session.userId, shopId: rows[0].shopId };
    req.token = token;
    next();
  } catch (error) { serverError(res, "Auth check", error, "ไม่สามารถตรวจสอบการเข้าสู่ระบบได้ในขณะนี้"); }
}

async function findActiveMarket(marketId) {
  const [rows] = await database.execute(`SELECT ${MARKET_FIELDS} FROM markets WHERE id = ? AND is_active = 1`, [marketId]);
  return rows[0] || null;
}
// Without an eventId, picks the nearest upcoming round, or the latest past round when none is upcoming.
async function resolveEvent(marketId, eventId) {
  if (eventId) {
    const [rows] = await database.execute(`${EVENT_SELECT} WHERE e.id = ? AND e.market_id = ? AND e.status <> 'cancelled'`, [eventId, marketId]);
    return rows[0] ? withBookable(rows[0]) : null;
  }
  const today = todayInMarket();
  const [rows] = await database.execute(`${EVENT_SELECT} WHERE e.market_id = ? AND e.status <> 'cancelled' ORDER BY e.event_date >= ? DESC, ABS(DATEDIFF(e.event_date, ?)) ASC LIMIT 1`, [marketId, today, today]);
  return rows[0] ? withBookable(rows[0]) : null;
}

app.get(`${API}/health`, async (req, res) => {
  res.set("Cache-Control", "no-store");
  try { await database.query("SELECT 1"); res.json({ data: { status: "ok", database: "connected" } }); }
  catch { fail(res, 503, "DATABASE_UNAVAILABLE", "ระบบฐานข้อมูลยังไม่พร้อมใช้งาน"); }
});

// ---------- A. Shop accounts ----------
app.post(`${API}/auth/register`, rateLimit("register", 10, 60 * 60 * 1000), async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {};
  const email = text(body.email).toLowerCase();
  const phone = normalizePhone(body.phone);
  const ownContactPhone = normalizePhone(body.contactPhone);
  const shopName = text(body.shopName);
  const category = text(body.category);
  const password = typeof body.password === "string" ? body.password : "";
  const fields = {};
  if (!EMAIL_PATTERN.test(email) || email.length > 255) fields.email = "กรุณากรอกอีเมลให้ถูกต้อง เช่น name@example.com";
  if (phone && !PHONE_PATTERN.test(phone)) fields.phone = "รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง (ตัวเลข 9-15 หลัก)";
  if (ownContactPhone && !PHONE_PATTERN.test(ownContactPhone)) fields.contactPhone = "รูปแบบเบอร์ติดต่อร้านไม่ถูกต้อง (ตัวเลข 9-15 หลัก)";
  if (password.length < 8) fields.password = "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร";
  else if (Buffer.byteLength(password) > 72) fields.password = "รหัสผ่านยาวเกินไป";
  if (!shopName) fields.shopName = "กรุณากรอกชื่อร้าน";
  else if (shopName.length > 150) fields.shopName = "ชื่อร้านยาวได้ไม่เกิน 150 ตัวอักษร";
  if (category.length > 100) fields.category = "ประเภทสินค้ายาวได้ไม่เกิน 100 ตัวอักษร";
  if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", fields);
  const contactPhone = ownContactPhone || phone || null;
  let connection;
  try {
    const passwordHash = await bcrypt.hash(password, 11);
    connection = await database.getConnection();
    await connection.beginTransaction();
    const [existing] = await connection.execute("SELECT id FROM users WHERE email = ? OR (phone IS NOT NULL AND phone = ?) LIMIT 1 FOR UPDATE", [email, phone || null]);
    if (existing.length) { await connection.rollback(); return fail(res, 409, "ACCOUNT_ALREADY_EXISTS", "อีเมลหรือเบอร์โทรศัพท์นี้มีบัญชีแล้ว"); }
    const now = nowSeconds();
    const [userInsert] = await connection.execute("INSERT INTO users (email, phone, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)", [email, phone || null, passwordHash, now, now]);
    const [shopInsert] = await connection.execute("INSERT INTO shops (user_id, shop_name, category, contact_phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [userInsert.insertId, shopName, category || null, contactPhone, now, now]);
    await connection.commit();
    const token = createSession(req, res, userInsert.insertId, shopInsert.insertId);
    audit("auth.registered", { userId: userInsert.insertId, shopId: shopInsert.insertId });
    res.status(201).json({ data: { user: { id: userInsert.insertId, email, phone: phone || null }, shop: { id: shopInsert.insertId, shopName, category: category || null, contactPhone }, accessToken: token } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (error.code === "ER_DUP_ENTRY") return fail(res, 409, "ACCOUNT_ALREADY_EXISTS", "อีเมลหรือเบอร์โทรศัพท์นี้มีบัญชีแล้ว");
    serverError(res, "Register", error, "ไม่สามารถสร้างบัญชีได้ในขณะนี้");
  } finally { connection?.release(); }
});

app.post(`${API}/auth/login`, rateLimit("login", 10, 15 * 60 * 1000), async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {};
  const email = text(body.login ?? body.email).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const fields = {};
  if (!EMAIL_PATTERN.test(email)) fields.login = "กรุณากรอกอีเมลให้ถูกต้อง";
  if (!password) fields.password = "กรุณากรอกรหัสผ่าน";
  if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "กรุณากรอกอีเมลและรหัสผ่าน", fields);
  try {
    const [rows] = await database.execute("SELECT u.id, u.password_hash, u.is_active, s.id AS shopId, s.shop_name AS shopName FROM users u JOIN shops s ON s.user_id = u.id WHERE u.email = ? LIMIT 1", [email]);
    const user = rows[0];
    const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid) { audit("auth.login_failed", { userId: user?.id || null }); return fail(res, 401, "INVALID_CREDENTIALS", "อีเมลหรือรหัสผ่านไม่ถูกต้อง"); }
    if (!user.is_active) return fail(res, 403, "ACCOUNT_DISABLED", "บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลตลาด");
    const token = createSession(req, res, user.id, user.shopId);
    audit("auth.login", { userId: user.id });
    res.json({ data: { user: { id: user.id }, shop: { id: user.shopId, shopName: user.shopName }, accessToken: token } });
  } catch (error) { serverError(res, "Login", error, "ไม่สามารถเข้าสู่ระบบได้ในขณะนี้"); }
});

app.post(`${API}/auth/logout`, auth, (req, res) => {
  sessions.delete(req.token);
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/api" });
  audit("auth.logout", { userId: req.user.userId });
  res.status(204).end();
});

app.get(`${API}/auth/me`, auth, async (req, res) => {
  try {
    const [rows] = await database.execute(PROFILE_SELECT, [req.user.shopId, req.user.userId]);
    if (!rows.length) return fail(res, 401, "UNAUTHORIZED", "กรุณาเข้าสู่ระบบใหม่");
    const row = rows[0];
    res.json({ data: { user: { id: req.user.userId, email: row.email, phone: row.phone }, shop: { id: row.id, shopName: row.shopName, category: row.category, description: row.description, contactPhone: row.contactPhone } } });
  } catch (error) { serverError(res, "Read account", error, "ไม่สามารถอ่านข้อมูลบัญชีได้"); }
});

// ---------- B. Markets, events and booths ----------
app.get(`${API}/markets`, publicCache(60), validatePage, async (req, res) => {
  const query = readQuery(req, res, { q: 100 });
  if (!query) return;
  try {
    const where = query.q ? "is_active = 1 AND (market_name LIKE ? OR address LIKE ?)" : "is_active = 1";
    const params = query.q ? [likePattern(query.q), likePattern(query.q)] : [];
    const [[{ total }]] = await database.execute(`SELECT COUNT(*) AS total FROM markets WHERE ${where}`, params);
    const [rows] = await database.execute(`SELECT ${MARKET_FIELDS} FROM markets WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`, [...params, req.paging.limit, req.paging.offset]);
    sendList(res, rows, req.paging, total);
  } catch (error) { serverError(res, "List markets", error, "ไม่สามารถโหลดตลาดได้"); }
});

app.get(`${API}/markets/:marketId`, publicCache(60), async (req, res) => {
  const marketId = toId(req.params.marketId);
  if (!marketId) return fail(res, 400, "INVALID_ID", "รหัสตลาดไม่ถูกต้อง");
  const query = readQuery(req, res, { fromDate: "date", toDate: "date" });
  if (!query) return;
  try {
    const market = await findActiveMarket(marketId);
    if (!market) return fail(res, 404, "MARKET_NOT_FOUND", "ไม่พบตลาดนี้");
    const [events] = await database.execute(`${EVENT_SELECT} WHERE e.market_id = ? AND e.status <> 'cancelled' AND (? IS NULL OR e.event_date >= ?) AND (? IS NULL OR e.event_date <= ?) ORDER BY e.event_date`, [marketId, query.fromDate, query.fromDate, query.toDate, query.toDate]);
    res.json({ data: { ...market, events: events.map(withBookable) } });
  } catch (error) { serverError(res, "Read market", error, "ไม่สามารถโหลดข้อมูลตลาดได้"); }
});

app.get(`${API}/markets/:marketId/events`, publicCache(60), validatePage, async (req, res) => {
  const marketId = toId(req.params.marketId);
  if (!marketId) return fail(res, 400, "INVALID_ID", "รหัสตลาดไม่ถูกต้อง");
  const query = readQuery(req, res, { fromDate: "date", toDate: "date", status: EVENT_STATUSES });
  if (!query) return;
  try {
    if (!(await findActiveMarket(marketId))) return fail(res, 404, "MARKET_NOT_FOUND", "ไม่พบตลาดนี้");
    const where = "WHERE e.market_id = ? AND e.status <> 'cancelled' AND (? IS NULL OR e.event_date >= ?) AND (? IS NULL OR e.event_date <= ?) AND (? IS NULL OR e.status = ?)";
    const params = [marketId, query.fromDate, query.fromDate, query.toDate, query.toDate, query.status, query.status];
    const [[{ total }]] = await database.execute(`SELECT COUNT(*) AS total FROM market_events e ${where}`, params);
    const [rows] = await database.execute(`${EVENT_SELECT} ${where} ORDER BY e.event_date LIMIT ? OFFSET ?`, [...params, req.paging.limit, req.paging.offset]);
    sendList(res, rows.map(withBookable), req.paging, total);
  } catch (error) { serverError(res, "List events", error, "ไม่สามารถโหลดรอบตลาดได้"); }
});

app.get(`${API}/markets/:marketId/booths`, publicCache(0), validatePage, async (req, res) => {
  const marketId = toId(req.params.marketId);
  if (!marketId) return fail(res, 400, "INVALID_ID", "รหัสตลาดไม่ถูกต้อง");
  const query = readQuery(req, res, { eventId: "id", status: BOOTH_AVAILABILITY });
  if (!query) return;
  try {
    if (!(await findActiveMarket(marketId))) return fail(res, 404, "MARKET_NOT_FOUND", "ไม่พบตลาดนี้");
    if (query.eventId && !(await resolveEvent(marketId, query.eventId))) return fail(res, 404, "EVENT_NOT_FOUND", "ไม่พบรอบตลาดนี้");
    // "booked" comes from pending/confirmed bookings in the chosen round, not from booths.status alone.
    const inner = "SELECT b.id, b.booth_code AS boothCode, b.map_x AS mapX, b.map_y AS mapY, b.width, b.depth, b.base_price AS price, CASE WHEN b.status = 'maintenance' THEN 'maintenance' WHEN b.status <> 'available' THEN 'unavailable' WHEN EXISTS (SELECT 1 FROM bookings x WHERE x.booth_id = b.id AND x.event_id = ? AND x.status IN ('pending','confirmed')) THEN 'booked' ELSE 'available' END AS availability FROM booths b WHERE b.market_id = ?";
    const params = [query.eventId, marketId];
    const filter = query.status ? " WHERE t.availability = ?" : "";
    if (query.status) params.push(query.status);
    const [[{ total }]] = await database.execute(`SELECT COUNT(*) AS total FROM (${inner}) t${filter}`, params);
    const [rows] = await database.execute(`SELECT * FROM (${inner}) t${filter} ORDER BY t.boothCode LIMIT ? OFFSET ?`, [...params, req.paging.limit, req.paging.offset]);
    sendList(res, rows, req.paging, total);
  } catch (error) { serverError(res, "List booths", error, "ไม่สามารถโหลดแผงตลาดได้"); }
});

// ---------- C. Shop bookings ----------
app.post(`${API}/bookings`, auth, async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {};
  const fields = {};
  for (const key of Object.keys(body)) if (!["eventId", "boothId"].includes(key)) fields[key] = "ไม่รับข้อมูลนี้ ระบบกำหนดให้เอง";
  if (!isJsonId(body.eventId)) fields.eventId = "กรุณาเลือกรอบตลาด";
  if (!isJsonId(body.boothId)) fields.boothId = "กรุณาเลือกแผง";
  if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลการจองไม่ถูกต้อง", fields);
  let connection;
  try {
    connection = await database.getConnection();
    await connection.beginTransaction();
    const reject = async (status, code, message) => { await connection.rollback(); return fail(res, status, code, message); };
    const [events] = await connection.execute("SELECT e.id, e.market_id, e.event_date, e.status, m.is_active FROM market_events e JOIN markets m ON m.id = e.market_id WHERE e.id = ? LOCK IN SHARE MODE", [body.eventId]);
    // Locking the booth row serialises concurrent bookings of the same booth.
    const [booths] = await connection.execute("SELECT id, market_id, booth_code, base_price, status FROM booths WHERE id = ? FOR UPDATE", [body.boothId]);
    const event = events[0];
    const booth = booths[0];
    if (!event || !booth || !event.is_active || event.market_id !== booth.market_id) return reject(404, "EVENT_OR_BOOTH_NOT_FOUND", "ไม่พบรอบตลาดหรือแผงที่เลือก");
    if (!BOOKABLE_EVENT_STATUSES.includes(event.status) || event.event_date < todayInMarket()) return reject(422, "EVENT_NOT_BOOKABLE", "รอบตลาดนี้ไม่เปิดรับจองแล้ว กรุณาเลือกรอบอื่น");
    if (booth.status !== "available") return reject(409, "BOOTH_UNAVAILABLE", "แผงนี้ไม่พร้อมให้จอง กรุณาเลือกแผงอื่น");
    const [active] = await connection.execute("SELECT id, shop_id FROM bookings WHERE event_id = ? AND booth_id = ? AND status IN ('pending','confirmed') FOR UPDATE", [event.id, booth.id]);
    if (active.some(row => row.shop_id === req.user.shopId)) return reject(409, "DUPLICATE_BOOKING", "ร้านของคุณจองแผงนี้ในรอบนี้ไว้แล้ว");
    if (active.length) return reject(409, "BOOTH_UNAVAILABLE", "แผงนี้ถูกจองแล้ว กรุณาเลือกแผงอื่น");
    const now = nowSeconds();
    const [insert] = await connection.execute("INSERT INTO bookings (event_id, booth_id, shop_id, status, price_at_booking, booked_at, created_at, updated_at) VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?)", [event.id, booth.id, req.user.shopId, booth.base_price, now, now, now]);
    await connection.commit();
    audit("booking.created", { bookingId: insert.insertId, shopId: req.user.shopId, eventId: event.id, boothId: booth.id });
    res.status(201).json({ data: { id: insert.insertId, event: { id: event.id, eventDate: event.event_date }, booth: { id: booth.id, boothCode: booth.booth_code }, status: "confirmed", price: booth.base_price, bookedAt: now.toISOString() } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code)) return fail(res, 409, "BOOTH_UNAVAILABLE", "แผงนี้ถูกจองแล้ว กรุณาเลือกแผงอื่น");
    serverError(res, "Booking", error, "ไม่สามารถจองแผงได้ในขณะนี้");
  } finally { connection?.release(); }
});

app.get(`${API}/bookings`, auth, validatePage, async (req, res) => {
  const query = readQuery(req, res, { status: BOOKING_STATUSES, fromDate: "date", toDate: "date", sort: ["eventDate", "bookedAt"], order: ["asc", "desc"] });
  if (!query) return;
  try {
    const where = "WHERE bk.shop_id = ? AND (? IS NULL OR bk.status = ?) AND (? IS NULL OR e.event_date >= ?) AND (? IS NULL OR e.event_date <= ?)";
    const params = [req.user.shopId, query.status, query.status, query.fromDate, query.fromDate, query.toDate, query.toDate];
    const column = query.sort === "bookedAt" ? "bk.booked_at" : "e.event_date";
    const order = query.order === "asc" ? "ASC" : "DESC";
    const [[{ total }]] = await database.execute(`SELECT COUNT(*) AS total FROM bookings bk JOIN market_events e ON e.id = bk.event_id ${where}`, params);
    const [rows] = await database.execute(`${BOOKING_SELECT} ${where} ORDER BY ${column} ${order}, bk.id ${order} LIMIT ? OFFSET ?`, [...params, req.paging.limit, req.paging.offset]);
    sendList(res, rows.map(bookingOut), req.paging, total);
  } catch (error) { serverError(res, "List bookings", error, "ไม่สามารถโหลดรายการจองได้"); }
});

app.get(`${API}/bookings/:bookingId`, auth, async (req, res) => {
  const bookingId = toId(req.params.bookingId);
  if (!bookingId) return fail(res, 404, "BOOKING_NOT_FOUND", "ไม่พบรายการจอง");
  try {
    const [rows] = await database.execute(`${BOOKING_SELECT} WHERE bk.id = ? AND bk.shop_id = ?`, [bookingId, req.user.shopId]);
    if (!rows.length) return fail(res, 404, "BOOKING_NOT_FOUND", "ไม่พบรายการจอง");
    res.json({ data: bookingOut(rows[0]) });
  } catch (error) { serverError(res, "Read booking", error, "ไม่สามารถโหลดรายการจองได้"); }
});

app.post(`${API}/bookings/:bookingId/cancel`, auth, async (req, res) => {
  const bookingId = toId(req.params.bookingId);
  if (!bookingId) return fail(res, 404, "BOOKING_NOT_FOUND", "ไม่พบรายการจอง");
  const body = isPlainObject(req.body) ? req.body : {};
  const fields = {};
  for (const key of Object.keys(body)) if (key !== "reason") fields[key] = "ไม่รับข้อมูลนี้";
  if (body.reason !== undefined && body.reason !== null && (typeof body.reason !== "string" || body.reason.trim().length > 500)) fields.reason = "เหตุผลต้องเป็นข้อความไม่เกิน 500 ตัวอักษร";
  if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", fields);
  let connection;
  try {
    connection = await database.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute("SELECT status FROM bookings WHERE id = ? AND shop_id = ? FOR UPDATE", [bookingId, req.user.shopId]);
    const reject = async (status, code, message) => { await connection.rollback(); return fail(res, status, code, message); };
    if (!rows.length) return reject(404, "BOOKING_NOT_FOUND", "ไม่พบรายการจอง");
    if (rows[0].status === "cancelled") return reject(409, "BOOKING_ALREADY_CANCELLED", "รายการนี้ถูกยกเลิกแล้ว");
    if (!ACTIVE_BOOKING_STATUSES.includes(rows[0].status)) return reject(422, "CANCELLATION_NOT_ALLOWED", "รายการนี้ไม่สามารถยกเลิกได้");
    const now = nowSeconds();
    await connection.execute("UPDATE bookings SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ? AND shop_id = ?", [now, now, bookingId, req.user.shopId]);
    await connection.commit();
    audit("booking.cancelled", { bookingId, shopId: req.user.shopId, reasonProvided: Boolean(text(body.reason)) });
    res.json({ data: { id: bookingId, status: "cancelled", cancelledAt: now.toISOString() } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    serverError(res, "Cancel booking", error, "ไม่สามารถยกเลิกการจองได้");
  } finally { connection?.release(); }
});

// ---------- D. Shop profile ----------
app.get(`${API}/shop/profile`, auth, async (req, res) => {
  try {
    const [rows] = await database.execute(PROFILE_SELECT, [req.user.shopId, req.user.userId]);
    if (!rows.length) return fail(res, 404, "SHOP_NOT_FOUND", "ไม่พบข้อมูลร้าน");
    res.json({ data: profileOut(rows[0]) });
  } catch (error) { serverError(res, "Read profile", error, "ไม่สามารถโหลดข้อมูลร้านได้"); }
});

app.patch(`${API}/shop/profile`, auth, async (req, res) => {
  if (!isPlainObject(req.body) || !Object.keys(req.body).length) return fail(res, 400, "VALIDATION_ERROR", "กรุณาส่งข้อมูลที่ต้องการแก้ไขอย่างน้อยหนึ่งรายการ");
  const fields = {};
  const updates = [];
  const values = [];
  for (const [key, raw] of Object.entries(req.body)) {
    const rule = PROFILE_RULES[key];
    if (!rule) { fields[key] = "ไม่สามารถแก้ไขข้อมูลนี้ได้"; continue; }
    if (raw !== null && typeof raw !== "string") { fields[key] = "ต้องเป็นข้อความ"; continue; }
    const value = rule.phone ? normalizePhone(raw) : text(raw);
    if (rule.required && !value) fields[key] = "กรุณากรอกชื่อร้าน";
    else if (value.length > rule.max) fields[key] = `ยาวได้ไม่เกิน ${rule.max} ตัวอักษร`;
    else if (rule.phone && value && !PHONE_PATTERN.test(value)) fields[key] = "รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง (ตัวเลข 9-15 หลัก)";
    else { updates.push(`${rule.column} = ?`); values.push(value || null); }
  }
  if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", fields);
  try {
    await database.execute(`UPDATE shops SET ${updates.join(", ")}, updated_at = ? WHERE id = ? AND user_id = ?`, [...values, nowSeconds(), req.user.shopId, req.user.userId]);
    const [rows] = await database.execute(PROFILE_SELECT, [req.user.shopId, req.user.userId]);
    if (!rows.length) return fail(res, 404, "SHOP_NOT_FOUND", "ไม่พบข้อมูลร้าน");
    audit("shop.profile_updated", { shopId: req.user.shopId, fields: Object.keys(req.body) });
    res.json({ data: profileOut(rows[0]) });
  } catch (error) { serverError(res, "Update profile", error, "ไม่สามารถบันทึกข้อมูลร้านได้"); }
});

// ---------- E. Public data for customers and the QR page ----------
app.get(`${API}/public/markets/:marketId/map`, publicCache(0), async (req, res) => {
  const marketId = toId(req.params.marketId);
  if (!marketId) return fail(res, 400, "INVALID_ID", "รหัสตลาดไม่ถูกต้อง");
  const query = readQuery(req, res, { eventId: "id" });
  if (!query) return;
  try {
    const market = await findActiveMarket(marketId);
    if (!market) return fail(res, 404, "MARKET_NOT_FOUND", "ไม่พบตลาดนี้");
    const event = await resolveEvent(marketId, query.eventId);
    if (query.eventId && !event) return fail(res, 404, "EVENT_NOT_FOUND", "ไม่พบรอบตลาดนี้");
    const eventId = event?.id || null;
    // Only confirmed bookings publish shop details; account email/phone are never selected.
    const [rows] = await database.execute("SELECT b.id, b.booth_code AS boothCode, b.map_x AS mapX, b.map_y AS mapY, b.width, b.depth, CASE WHEN bk.id IS NOT NULL THEN 'occupied' WHEN b.status = 'maintenance' THEN 'maintenance' WHEN b.status <> 'available' THEN 'unavailable' WHEN EXISTS (SELECT 1 FROM bookings x WHERE x.booth_id = b.id AND x.event_id = ? AND x.status = 'pending') THEN 'occupied' ELSE 'available' END AS availability, s.id AS shopId, s.shop_name AS shopName, s.category, s.description AS shopDescription, s.contact_phone AS contactPhone FROM booths b LEFT JOIN bookings bk ON bk.booth_id = b.id AND bk.event_id = ? AND bk.status = 'confirmed' LEFT JOIN shops s ON s.id = bk.shop_id WHERE b.market_id = ? ORDER BY b.booth_code", [eventId, eventId, marketId]);
    const booths = rows.map(({ shopId, shopName, category, shopDescription, contactPhone, ...booth }) => ({ ...booth, shop: shopId ? { id: shopId, shopName, category, description: shopDescription, contactPhone } : null }));
    res.json({ data: { market, event, mode: event ? "event" : "general", booths } });
  } catch (error) { serverError(res, "Public map", error, "ไม่สามารถโหลดแผนผังตลาดได้"); }
});

app.get(`${API}/public/markets/:marketId/shops`, publicCache(0), validatePage, async (req, res) => {
  const marketId = toId(req.params.marketId);
  if (!marketId) return fail(res, 400, "INVALID_QUERY", "รหัสตลาดไม่ถูกต้อง");
  const query = readQuery(req, res, { eventId: "id", q: 100, category: 100, sort: ["shopName", "boothCode"], order: ["asc", "desc"] });
  if (!query) return;
  try {
    if (!(await findActiveMarket(marketId))) return fail(res, 404, "MARKET_NOT_FOUND", "ไม่พบตลาดนี้");
    const event = await resolveEvent(marketId, query.eventId);
    if (query.eventId && !event) return fail(res, 404, "EVENT_NOT_FOUND", "ไม่พบรอบตลาดนี้");
    if (!event) return sendList(res, [], req.paging, 0);
    let where = "WHERE bk.event_id = ? AND bk.status = 'confirmed' AND b.market_id = ?";
    const params = [event.id, marketId];
    if (query.q) { where += " AND (s.shop_name LIKE ? OR s.description LIKE ? OR s.category LIKE ?)"; params.push(likePattern(query.q), likePattern(query.q), likePattern(query.q)); }
    if (query.category) { where += " AND s.category = ?"; params.push(query.category); }
    const from = "FROM bookings bk JOIN shops s ON s.id = bk.shop_id JOIN booths b ON b.id = bk.booth_id";
    const column = query.sort === "boothCode" ? "b.booth_code" : "s.shop_name";
    const order = query.order === "desc" ? "DESC" : "ASC";
    const [[{ total }]] = await database.execute(`SELECT COUNT(*) AS total ${from} ${where}`, params);
    const [rows] = await database.execute(`SELECT s.id, s.shop_name AS shopName, s.category, s.description, s.contact_phone AS contactPhone, bk.event_id AS eventId, b.id AS boothId, b.booth_code AS boothCode, b.map_x AS mapX, b.map_y AS mapY ${from} ${where} ORDER BY ${column} ${order}, b.booth_code LIMIT ? OFFSET ?`, [...params, req.paging.limit, req.paging.offset]);
    sendList(res, rows, req.paging, total);
  } catch (error) { serverError(res, "Search shops", error, "ไม่สามารถค้นหาร้านค้าได้"); }
});

app.get(`${API}/public/shops/:shopId`, publicCache(0), async (req, res) => {
  const shopId = toId(req.params.shopId);
  if (!shopId) return fail(res, 404, "SHOP_NOT_FOUND", "ไม่พบข้อมูลร้าน");
  const query = readQuery(req, res, { eventId: "id" });
  if (!query) return;
  try {
    const today = todayInMarket();
    const [rows] = await database.execute(`SELECT s.id, s.shop_name AS shopName, s.category, s.description, s.contact_phone AS contactPhone, m.id AS marketId, m.market_name AS marketName, m.address, e.id AS eventId, e.event_name AS eventName, e.event_date AS eventDate, COALESCE(e.open_time, m.open_time) AS openTime, COALESCE(e.close_time, m.close_time) AS closeTime, b.id AS boothId, b.booth_code AS boothCode, b.map_x AS mapX, b.map_y AS mapY FROM bookings bk JOIN shops s ON s.id = bk.shop_id JOIN market_events e ON e.id = bk.event_id JOIN markets m ON m.id = e.market_id JOIN booths b ON b.id = bk.booth_id WHERE bk.shop_id = ? AND bk.status = 'confirmed' AND e.status <> 'cancelled' AND m.is_active = 1 AND (? IS NULL OR e.id = ?) ORDER BY e.event_date >= ? DESC, ABS(DATEDIFF(e.event_date, ?)) ASC, b.booth_code`, [shopId, query.eventId, query.eventId, today, today]);
    if (!rows.length) return fail(res, 404, "SHOP_NOT_FOUND", query.eventId ? "ร้านนี้ไม่ได้เข้าร่วมรอบตลาดที่เลือก" : "ไม่พบข้อมูลร้านที่เผยแพร่");
    const first = rows[0];
    res.json({ data: {
      id: first.id, shopName: first.shopName, category: first.category, description: first.description, contactPhone: first.contactPhone,
      market: { id: first.marketId, marketName: first.marketName, address: first.address },
      event: { id: first.eventId, eventName: first.eventName, eventDate: first.eventDate, openTime: first.openTime, closeTime: first.closeTime },
      booths: rows.filter(row => row.eventId === first.eventId).map(row => ({ id: row.boothId, boothCode: row.boothCode, mapX: row.mapX, mapY: row.mapY }))
    } });
  } catch (error) { serverError(res, "Public shop", error, "ไม่สามารถโหลดข้อมูลร้านได้"); }
});

app.use("/api", (req, res) => fail(res, 404, "NOT_FOUND", "ไม่พบ endpoint ที่เรียก"));
app.use((req, res) => res.status(404).type("html").send('<!doctype html><meta charset="utf-8"><title>ไม่พบหน้า</title><p>ไม่พบหน้าที่ต้องการ <a href="/">กลับหน้าแผนผังตลาด</a></p>'));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === "entity.too.large") return fail(res, 413, "PAYLOAD_TOO_LARGE", "ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป");
  if (error.type === "entity.parse.failed") return fail(res, 400, "VALIDATION_ERROR", "รูปแบบ JSON ไม่ถูกต้อง");
  serverError(res, "Request", error, "เกิดข้อผิดพลาดภายในระบบ");
});

async function initializeDatabase() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(20) NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      UNIQUE KEY uq_users_email (email),
      UNIQUE KEY uq_users_phone (phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS shops (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      shop_name VARCHAR(150) NOT NULL,
      category VARCHAR(100) NULL,
      description TEXT NULL,
      contact_phone VARCHAR(20) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_shops_user (user_id),
      INDEX idx_shops_category (category),
      CONSTRAINT fk_shops_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS markets (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      market_name VARCHAR(150) NOT NULL,
      address VARCHAR(500) NULL,
      open_time TIME NULL,
      close_time TIME NULL,
      description TEXT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS market_events (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      market_id INT UNSIGNED NOT NULL,
      event_name VARCHAR(150) NOT NULL,
      event_date DATE NOT NULL,
      open_time TIME NULL,
      close_time TIME NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_events_market_date (market_id, event_date),
      CONSTRAINT fk_events_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE RESTRICT ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS booths (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      market_id INT UNSIGNED NOT NULL,
      booth_code VARCHAR(30) NOT NULL,
      map_x DECIMAL(8,3) NULL,
      map_y DECIMAL(8,3) NULL,
      width DECIMAL(6,2) NULL,
      depth DECIMAL(6,2) NULL,
      base_price DECIMAL(10,2) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'available',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_booths_market_code (market_id, booth_code),
      INDEX idx_booths_market_status (market_id, status),
      CONSTRAINT fk_booths_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE RESTRICT ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    // active_slot is NULL unless the booking is pending/confirmed, so the unique key allows only one active booking per booth per round.
    `CREATE TABLE IF NOT EXISTS bookings (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      event_id INT UNSIGNED NOT NULL,
      booth_id INT UNSIGNED NOT NULL,
      shop_id INT UNSIGNED NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
      price_at_booking DECIMAL(10,2) NOT NULL,
      booked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      cancelled_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      active_slot VARCHAR(30) AS (CASE WHEN status IN ('pending', 'confirmed') THEN CONCAT(event_id, ':', booth_id) END) PERSISTENT,
      INDEX idx_bookings_shop_status (shop_id, status),
      INDEX idx_bookings_event_booth_status (event_id, booth_id, status),
      UNIQUE KEY uq_bookings_active_slot (active_slot),
      CONSTRAINT fk_bookings_event FOREIGN KEY (event_id) REFERENCES market_events(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_bookings_booth FOREIGN KEY (booth_id) REFERENCES booths(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_bookings_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE RESTRICT ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ];
  for (const statement of statements) await database.query(statement);
  await seedInitialData();
}

// Starter market data prepared by the project owner (version 1 has no Admin screens). Runs only when no market exists yet.
async function seedInitialData() {
  const [[{ total }]] = await database.query("SELECT COUNT(*) AS total FROM markets");
  if (total > 0) return;
  const zones = [
    { letter: "A", xs: [10, 24, 38], ys: [16, 33], price: 150, width: 2, depth: 2 },
    { letter: "B", xs: [62, 76, 90], ys: [16, 33], price: 150, width: 2, depth: 2 },
    { letter: "C", xs: [10, 24, 38], ys: [67, 84], price: 120, width: 2, depth: 2 },
    { letter: "D", xs: [62, 76, 90], ys: [67, 84], price: 200, width: 3, depth: 2 }
  ];
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const now = nowSeconds();
    const [market] = await connection.execute("INSERT INTO markets (market_name, address, open_time, close_time, description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)", ["ตลาดนัดสวนกลาง", "ลานกิจกรรมชุมชน ถนนตัวอย่าง", "09:00:00", "16:00:00", "ตลาดนัดชุมชนทุกวันเสาร์ รวมผักสด อาหาร ขนม และงานฝีมือจากคนในชุมชน", now, now]);
    for (const zone of zones) {
      let number = 1;
      for (const y of zone.ys) for (const x of zone.xs) {
        const code = `${zone.letter}${String(number++).padStart(2, "0")}`;
        await connection.execute("INSERT INTO booths (market_id, booth_code, map_x, map_y, width, depth, base_price, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [market.insertId, code, x, y, zone.width, zone.depth, zone.price, code === "D06" ? "maintenance" : "available", now, now]);
      }
    }
    const date = new Date(`${todayInMarket()}T00:00:00Z`);
    while (date.getUTCDay() !== 6) date.setUTCDate(date.getUTCDate() + 1);
    for (let week = 0; week < 8; week += 1) {
      await connection.execute("INSERT INTO market_events (market_id, event_name, event_date, open_time, close_time, status, created_at) VALUES (?, ?, ?, NULL, NULL, 'scheduled', ?)", [market.insertId, "ตลาดนัดวันเสาร์", date.toISOString().slice(0, 10), now]);
      date.setUTCDate(date.getUTCDate() + 7);
    }
    await connection.commit();
    console.log("Seeded starter market data");
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token);
  for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
}, 10 * 60 * 1000).unref();

initializeDatabase()
  .then(() => console.log("Database is ready"))
  .catch(error => console.error("Database initialization failed:", error.code || error.message || "unknown"))
  .finally(() => app.listen(3201, () => console.log("Server is running at http://localhost:3201")));
