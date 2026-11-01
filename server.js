const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// Managed runtime variables take precedence over local configuration.
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const requiredEnv = ["PORT", "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"];
for (const key of requiredEnv) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}
const port = Number(process.env.PORT);
const dbPort = Number(process.env.DB_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) throw new Error("Invalid DB_PORT");

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" });
  next();
});
app.use(express.static("public"));
// Shop photos arrive as base64 JSON, so only that route gets a larger body limit.
app.use("/api/v1/shop/profile/image", express.json({ limit: "3mb" }));
app.use("/api", express.json({ limit: "16kb" }));

const database = mysql.createPool({
  host: process.env.DB_HOST,
  port: dbPort,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
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
const MARKET_TYPES = ["weekly", "morning", "evening", "walking_street", "border", "community"];
// Generous box around Tak province (the southern tip of Umphang is near 15.3°N, Tha Song Yang reaches 97.6°E).
const TAK_BOUNDS = { lat: [15, 18], lng: [97.3, 99.8] };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Thai numbers: 0 + 8–9 digits (landline/mobile) or the same number written with +66.
const PHONE_PATTERN = /^(0\d{8,9}|\+66\d{8,9})$/;
const PHONE_MESSAGE = "เบอร์โทรไม่ถูกต้อง ใช้ตัวเลข 9–10 หลักขึ้นต้นด้วย 0 เช่น 0812345678";
const MARKET_COLUMNS = "m.id, m.code, m.market_name AS marketName, m.address, m.subdistrict, m.district_id AS districtId, d.name_th AS districtName, m.latitude, m.longitude, m.market_type AS marketType, m.open_days AS openDays, m.open_time AS openTime, m.close_time AS closeTime, m.description, m.organizer, m.contact_phone AS contactPhone, m.image_url AS imageUrl, m.is_active AS isActive";
const MARKET_FROM = "FROM markets m LEFT JOIN districts d ON d.id = m.district_id";
const EVENT_SELECT = "SELECT e.id, e.market_id AS marketId, e.event_name AS eventName, e.event_date AS eventDate, COALESCE(e.open_time, m.open_time) AS openTime, COALESCE(e.close_time, m.close_time) AS closeTime, e.status FROM market_events e JOIN markets m ON m.id = e.market_id";
const BOOTH_FIELDS = "b.zone, b.has_electricity AS hasElectricity, b.has_roof AS hasRoof, b.note";
const BOOKING_SELECT = `SELECT bk.id, bk.status, bk.price_at_booking AS price, bk.booked_at AS bookedAt, bk.cancelled_at AS cancelledAt, m.id AS marketId, m.market_name AS marketName, m.address AS marketAddress, d.name_th AS districtName, e.id AS eventId, e.event_name AS eventName, e.event_date AS eventDate, COALESCE(e.open_time, m.open_time) AS openTime, COALESCE(e.close_time, m.close_time) AS closeTime, e.status AS eventStatus, b.id AS boothId, b.booth_code AS boothCode, b.width, b.depth, b.map_x AS mapX, b.map_y AS mapY, ${BOOTH_FIELDS} FROM bookings bk JOIN market_events e ON e.id = bk.event_id JOIN markets m ON m.id = e.market_id LEFT JOIN districts d ON d.id = m.district_id JOIN booths b ON b.id = bk.booth_id`;
const PROFILE_SELECT = "SELECT s.id, s.shop_name AS shopName, s.category_id AS categoryId, c.name AS category, s.description, s.contact_name AS contactName, s.contact_phone AS contactPhone, s.social_url AS socialUrl, s.image_url AS imageUrl, s.updated_at AS updatedAt, u.email, u.phone FROM shops s JOIN users u ON u.id = s.user_id LEFT JOIN categories c ON c.id = s.category_id WHERE s.id = ? AND s.user_id = ?";
const PROFILE_RULES = {
  shopName: { column: "shop_name", max: 150, required: true },
  description: { column: "description", max: 1000 },
  contactName: { column: "contact_name", max: 100 },
  contactPhone: { column: "contact_phone", max: 20, phone: true },
  socialUrl: { column: "social_url", max: 255, url: true }
};
const SHOP_IMAGE_DIR = path.resolve("public", "images", "shops");
const IMAGE_TYPES = [
  { ext: "jpg", test: buffer => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  { ext: "png", test: buffer => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "webp", test: buffer => buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP" }
];
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
// Writes to stdout and to audit_logs; a failed log write never fails the request.
function audit(action, details = {}) {
  console.log(JSON.stringify({ audit: action, at: new Date().toISOString(), ...details }));
  const actor = details.adminId ?? (action === "auth.login_failed" ? null : details.userId) ?? null;
  database.execute("INSERT INTO audit_logs (action, actor_user_id, details, created_at) VALUES (?, ?, ?, ?)", [action, actor, JSON.stringify(details), nowSeconds()])
    .catch(error => console.error("Audit log failed:", error?.code || "unknown"));
}
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
function addDays(value, days) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function weekday(value) { return new Date(`${value}T00:00:00Z`).getUTCDay(); }
function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
// "today" | "tomorrow" | "weekend" | YYYY-MM-DD → the dates a market must have a round on.
function datesFor(openOn) {
  const today = todayInMarket();
  if (openOn === "today") return [today];
  if (openOn === "tomorrow") return [addDays(today, 1)];
  if (openOn === "weekend") {
    const dates = [];
    for (let offset = 0; offset < 7 && dates.length < 2; offset += 1) {
      const date = addDays(today, offset);
      if ([0, 6].includes(weekday(date))) { dates.push(date); if (weekday(date) === 0) break; }
    }
    return dates;
  }
  return isValidDate(openOn) ? [openOn] : null;
}
function parseDays(value) { return String(value || "").split(",").filter(day => /^[0-6]$/.test(day)).map(Number); }
function distanceKm(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function withBookable(event) { return { ...event, bookable: BOOKABLE_EVENT_STATUSES.includes(event.status) && event.eventDate >= todayInMarket() }; }
function marketOut(row, admin = false) {
  const market = {
    id: row.id, code: row.code, marketName: row.marketName, address: row.address, subdistrict: row.subdistrict,
    district: row.districtId ? { id: row.districtId, name: row.districtName } : null,
    latitude: row.latitude, longitude: row.longitude, marketType: row.marketType, openDays: parseDays(row.openDays),
    openTime: row.openTime, closeTime: row.closeTime, description: row.description, organizer: row.organizer, contactPhone: row.contactPhone, imageUrl: row.imageUrl
  };
  if (admin) market.isActive = Boolean(row.isActive);
  return market;
}
function boothOut(row) { return { ...row, hasElectricity: Boolean(row.hasElectricity), hasRoof: Boolean(row.hasRoof) }; }
function bookingOut(row) {
  return {
    id: row.id, status: row.status, price: row.price, bookedAt: row.bookedAt, cancelledAt: row.cancelledAt,
    canCancel: ACTIVE_BOOKING_STATUSES.includes(row.status),
    market: { id: row.marketId, marketName: row.marketName, address: row.marketAddress, districtName: row.districtName },
    event: { id: row.eventId, eventName: row.eventName, eventDate: row.eventDate, openTime: row.openTime, closeTime: row.closeTime, status: row.eventStatus },
    booth: { id: row.boothId, boothCode: row.boothCode, width: row.width, depth: row.depth, mapX: row.mapX, mapY: row.mapY, zone: row.zone, hasElectricity: Boolean(row.hasElectricity), hasRoof: Boolean(row.hasRoof), note: row.note }
  };
}
function profileOut(row) {
  return { id: row.id, shopName: row.shopName, categoryId: row.categoryId, category: row.category, description: row.description, contactName: row.contactName, contactPhone: row.contactPhone, socialUrl: row.socialUrl, imageUrl: row.imageUrl, updatedAt: row.updatedAt, account: { email: row.email, phone: row.phone } };
}
function isHttpUrl(value) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
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
// Only a SHA-256 of the token is stored, so a leaked sessions table cannot be replayed.
function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
async function createSession(req, res, userId, executor = database) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = nowSeconds();
  await executor.execute("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)", [hashToken(token), userId, new Date(now.getTime() + SESSION_TTL_MS), now]);
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/api", maxAge: SESSION_TTL_MS });
  return token;
}
async function categoryExists(categoryId) {
  const [rows] = await database.execute("SELECT id FROM categories WHERE id = ?", [categoryId]);
  return rows.length > 0;
}

// Validates optional query values against a rule per key: "id", "date", a max length, a list of allowed values or a { min, max } number range.
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
    else if (typeof rule === "object") {
      const number = Number(value);
      if (value && Number.isFinite(number) && number >= rule.min && number <= rule.max) values[key] = number;
      else fields[key] = `ต้องเป็นตัวเลข ${rule.min}–${rule.max}`;
    }
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
  if (!token || token.length > 200) return fail(res, 401, "UNAUTHORIZED", "กรุณาเข้าสู่ระบบใหม่");
  try {
    const [rows] = await database.execute("SELECT u.id, u.is_active, u.role, s.id AS shopId FROM sessions ss JOIN users u ON u.id = ss.user_id LEFT JOIN shops s ON s.user_id = u.id WHERE ss.token_hash = ? AND ss.expires_at > ? LIMIT 1", [hashToken(token), new Date()]);
    if (!rows.length) return fail(res, 401, "UNAUTHORIZED", "กรุณาเข้าสู่ระบบใหม่");
    if (!rows[0].is_active) {
      await database.execute("DELETE FROM sessions WHERE user_id = ?", [rows[0].id]);
      return fail(res, 403, "ACCOUNT_DISABLED", "บัญชีนี้ถูกปิดใช้งาน");
    }
    // Cookie sessions are sent automatically by the browser, so state-changing requests must come from this site.
    if (!bearer && !["GET", "HEAD"].includes(req.method) && !sameOrigin(req)) return fail(res, 403, "FORBIDDEN", "คำขอนี้ไม่ได้มาจากหน้าเว็บของระบบ");
    req.user = { userId: rows[0].id, shopId: rows[0].shopId, role: rows[0].role };
    req.token = token;
    next();
  } catch (error) { serverError(res, "Auth check", error, "ไม่สามารถตรวจสอบการเข้าสู่ระบบได้ในขณะนี้"); }
}

function requireShop(req, res, next) {
  if (!req.user.shopId) return fail(res, 403, "FORBIDDEN", "บัญชีนี้ไม่มีร้านค้า");
  next();
}
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return fail(res, 403, "FORBIDDEN", "เฉพาะผู้ดูแลตลาดเท่านั้น");
  next();
}

async function findActiveMarket(marketId) {
  const [rows] = await database.execute(`SELECT ${MARKET_COLUMNS} ${MARKET_FROM} WHERE m.id = ? AND m.is_active = 1`, [marketId]);
  return rows[0] ? marketOut(rows[0]) : null;
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
  const categoryId = body.categoryId ?? null;
  const password = typeof body.password === "string" ? body.password : "";
  const fields = {};
  for (const key of Object.keys(body)) if (!["email", "phone", "password", "shopName", "categoryId", "contactPhone"].includes(key)) fields[key] = "ไม่รับข้อมูลนี้";
  if (!EMAIL_PATTERN.test(email) || email.length > 255) fields.email = "กรุณากรอกอีเมลให้ถูกต้อง เช่น name@example.com";
  if (phone && !PHONE_PATTERN.test(phone)) fields.phone = PHONE_MESSAGE;
  if (ownContactPhone && !PHONE_PATTERN.test(ownContactPhone)) fields.contactPhone = PHONE_MESSAGE;
  if (password.length < 8) fields.password = "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร";
  else if (Buffer.byteLength(password) > 72) fields.password = "รหัสผ่านยาวเกินไป";
  else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) fields.password = "รหัสผ่านต้องมีทั้งตัวอักษรภาษาอังกฤษและตัวเลข";
  if (!shopName) fields.shopName = "กรุณากรอกชื่อร้าน";
  else if (shopName.length > 150) fields.shopName = "ชื่อร้านยาวได้ไม่เกิน 150 ตัวอักษร";
  if (categoryId !== null && !isJsonId(categoryId)) fields.categoryId = "กรุณาเลือกประเภทสินค้าจากรายการ";
  if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", fields);
  const contactPhone = ownContactPhone || phone || null;
  let connection;
  try {
    if (categoryId !== null && !(await categoryExists(categoryId))) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", { categoryId: "ไม่พบประเภทสินค้านี้" });
    const passwordHash = await bcrypt.hash(password, 11);
    connection = await database.getConnection();
    await connection.beginTransaction();
    const [existing] = await connection.execute("SELECT id FROM users WHERE email = ? OR (phone IS NOT NULL AND phone = ?) LIMIT 1 FOR UPDATE", [email, phone || null]);
    if (existing.length) { await connection.rollback(); return fail(res, 409, "ACCOUNT_ALREADY_EXISTS", "อีเมลหรือเบอร์โทรศัพท์นี้มีบัญชีแล้ว"); }
    const now = nowSeconds();
    const [userInsert] = await connection.execute("INSERT INTO users (email, phone, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)", [email, phone || null, passwordHash, now, now]);
    const [shopInsert] = await connection.execute("INSERT INTO shops (user_id, shop_name, category_id, contact_phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [userInsert.insertId, shopName, categoryId, contactPhone, now, now]);
    const token = await createSession(req, res, userInsert.insertId, connection);
    await connection.commit();
    audit("auth.registered", { userId: userInsert.insertId, shopId: shopInsert.insertId });
    res.status(201).json({ data: { user: { id: userInsert.insertId, email, phone: phone || null }, shop: { id: shopInsert.insertId, shopName, categoryId, contactPhone }, accessToken: token } });
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
  if (!EMAIL_PATTERN.test(email) || email.length > 255) fields.login = "กรุณากรอกอีเมลให้ถูกต้อง";
  if (!password) fields.password = "กรุณากรอกรหัสผ่าน";
  else if (Buffer.byteLength(password) > 72) fields.password = "รหัสผ่านยาวเกินไป";
  if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "กรุณากรอกอีเมลและรหัสผ่าน", fields);
  try {
    const [rows] = await database.execute("SELECT u.id, u.password_hash, u.is_active, u.role, s.id AS shopId, s.shop_name AS shopName FROM users u LEFT JOIN shops s ON s.user_id = u.id WHERE u.email = ? LIMIT 1", [email]);
    const user = rows[0];
    const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid) { audit("auth.login_failed", { userId: user?.id || null }); return fail(res, 401, "INVALID_CREDENTIALS", "อีเมลหรือรหัสผ่านไม่ถูกต้อง"); }
    if (!user.is_active) return fail(res, 403, "ACCOUNT_DISABLED", "บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลตลาด");
    const token = await createSession(req, res, user.id);
    audit("auth.login", { userId: user.id });
    res.json({ data: { user: { id: user.id, role: user.role }, shop: user.shopId ? { id: user.shopId, shopName: user.shopName } : null, accessToken: token } });
  } catch (error) { serverError(res, "Login", error, "ไม่สามารถเข้าสู่ระบบได้ในขณะนี้"); }
});

app.post(`${API}/auth/logout`, auth, async (req, res) => {
  try {
    await database.execute("DELETE FROM sessions WHERE token_hash = ?", [hashToken(req.token)]);
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/api" });
    audit("auth.logout", { userId: req.user.userId });
    res.status(204).end();
  } catch (error) { serverError(res, "Logout", error, "ไม่สามารถออกจากระบบได้ในขณะนี้"); }
});

app.get(`${API}/auth/me`, auth, async (req, res) => {
  try {
    const [users] = await database.execute("SELECT email, phone, role FROM users WHERE id = ?", [req.user.userId]);
    if (!users.length) return fail(res, 401, "UNAUTHORIZED", "กรุณาเข้าสู่ระบบใหม่");
    const [shops] = req.user.shopId ? await database.execute(PROFILE_SELECT, [req.user.shopId, req.user.userId]) : [[]];
    const shop = shops[0] ? profileOut(shops[0]) : null;
    if (shop) delete shop.account;
    res.json({ data: { user: { id: req.user.userId, email: users[0].email, phone: users[0].phone, role: users[0].role }, shop } });
  } catch (error) { serverError(res, "Read account", error, "ไม่สามารถอ่านข้อมูลบัญชีได้"); }
});

// ---------- B. Province, markets, events and booths ----------
app.get(`${API}/districts`, publicCache(300), async (req, res) => {
  try {
    const [rows] = await database.execute("SELECT d.id, d.code, d.name_th AS name, d.name_en AS nameEn, d.latitude, d.longitude, (SELECT COUNT(*) FROM markets m WHERE m.district_id = d.id AND m.is_active = 1) AS marketCount FROM districts d ORDER BY d.sort_order, d.id");
    res.json({ data: rows });
  } catch (error) { serverError(res, "List districts", error, "ไม่สามารถโหลดรายชื่ออำเภอได้"); }
});

app.get(`${API}/categories`, publicCache(300), async (req, res) => {
  try {
    const [rows] = await database.execute("SELECT id, name, icon FROM categories ORDER BY sort_order, id");
    res.json({ data: rows });
  } catch (error) { serverError(res, "List categories", error, "ไม่สามารถโหลดประเภทสินค้าได้"); }
});

// Province-wide market finder. q also matches products sold in the next 14 days; lat/lng sorts by distance.
app.get(`${API}/markets`, publicCache(60), validatePage, async (req, res) => {
  const query = readQuery(req, res, { q: 100, districtId: "id", type: MARKET_TYPES, openOn: 10, lat: { min: TAK_BOUNDS.lat[0] - 1, max: TAK_BOUNDS.lat[1] + 1 }, lng: { min: TAK_BOUNDS.lng[0] - 1, max: TAK_BOUNDS.lng[1] + 1 } });
  if (!query) return;
  const dates = query.openOn ? datesFor(query.openOn) : null;
  if (query.openOn && !dates) return fail(res, 400, "INVALID_QUERY", "ค่าที่ใช้ค้นหาไม่ถูกต้อง", { openOn: "ใช้ today, tomorrow, weekend หรือ YYYY-MM-DD" });
  if ((query.lat === null) !== (query.lng === null)) return fail(res, 400, "INVALID_QUERY", "ค่าที่ใช้ค้นหาไม่ถูกต้อง", { lat: "ต้องส่ง lat และ lng คู่กัน" });
  try {
    const today = todayInMarket();
    const from = dates ? dates[0] : today;
    let where = "WHERE m.is_active = 1";
    const params = [];
    if (query.districtId) { where += " AND m.district_id = ?"; params.push(query.districtId); }
    if (query.type) { where += " AND m.market_type = ?"; params.push(query.type); }
    if (query.q) {
      const like = likePattern(query.q);
      where += " AND (m.market_name LIKE ? OR m.address LIKE ? OR m.subdistrict LIKE ? OR d.name_th LIKE ? OR EXISTS (SELECT 1 FROM bookings x JOIN market_events xe ON xe.id = x.event_id JOIN shops xs ON xs.id = x.shop_id LEFT JOIN categories xc ON xc.id = xs.category_id WHERE xe.market_id = m.id AND x.status = 'confirmed' AND xe.status <> 'cancelled' AND xe.event_date BETWEEN ? AND ? AND (xs.shop_name LIKE ? OR xs.description LIKE ? OR xc.name LIKE ?)))";
      params.push(like, like, like, like, today, addDays(today, 13), like, like, like);
    }
    if (dates) { where += ` AND EXISTS (SELECT 1 FROM market_events xe WHERE xe.market_id = m.id AND xe.status <> 'cancelled' AND xe.event_date IN (${dates.map(() => "?").join(", ")}))`; params.push(...dates); }
    const [rows] = await database.execute(`SELECT ${MARKET_COLUMNS}, (SELECT e.id FROM market_events e WHERE e.market_id = m.id AND e.status <> 'cancelled' AND e.event_date >= ? ORDER BY e.event_date LIMIT 1) AS nextEventId, (SELECT COUNT(*) FROM booths b WHERE b.market_id = m.id AND b.status = 'available') AS boothCount ${MARKET_FROM} ${where} ORDER BY d.sort_order, m.market_name LIMIT 500`, [from, ...params]);
    const eventIds = rows.map(row => row.nextEventId).filter(Boolean);
    const [events] = eventIds.length ? await database.query("SELECT e.id, e.market_id AS marketId, e.event_name AS eventName, e.event_date AS eventDate, COALESCE(e.open_time, m.open_time) AS openTime, COALESCE(e.close_time, m.close_time) AS closeTime, e.status, (SELECT COUNT(*) FROM bookings x WHERE x.event_id = e.id AND x.status = 'confirmed') AS shopCount FROM market_events e JOIN markets m ON m.id = e.market_id WHERE e.id IN (?)", [eventIds]) : [[]];
    const eventById = new Map(events.map(event => [event.id, withBookable(event)]));
    let markets = rows.map(row => ({ ...marketOut(row), boothCount: row.boothCount, nextEvent: eventById.get(row.nextEventId) || null }));
    if (query.lat !== null) {
      markets = markets.map(market => ({ ...market, distanceKm: market.latitude == null ? null : Math.round(distanceKm(query.lat, query.lng, market.latitude, market.longitude) * 10) / 10 }));
      markets.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    }
    sendList(res, markets.slice(req.paging.offset, req.paging.offset + req.paging.limit), req.paging, markets.length);
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
    const [events] = await database.execute(`${EVENT_SELECT} WHERE e.market_id = ? AND e.status <> 'cancelled' AND (? IS NULL OR e.event_date >= ?) AND (? IS NULL OR e.event_date <= ?) ORDER BY e.event_date LIMIT 400`, [marketId, query.fromDate, query.fromDate, query.toDate, query.toDate]);
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
    const inner = `SELECT b.id, b.booth_code AS boothCode, b.map_x AS mapX, b.map_y AS mapY, b.width, b.depth, b.base_price AS price, ${BOOTH_FIELDS}, CASE WHEN b.status = 'maintenance' THEN 'maintenance' WHEN b.status <> 'available' THEN 'unavailable' WHEN EXISTS (SELECT 1 FROM bookings x WHERE x.booth_id = b.id AND x.event_id = ? AND x.status IN ('pending','confirmed')) THEN 'booked' ELSE 'available' END AS availability FROM booths b WHERE b.market_id = ?`;
    const params = [query.eventId, marketId];
    const filter = query.status ? " WHERE t.availability = ?" : "";
    if (query.status) params.push(query.status);
    const [[{ total }]] = await database.execute(`SELECT COUNT(*) AS total FROM (${inner}) t${filter}`, params);
    const [rows] = await database.execute(`SELECT * FROM (${inner}) t${filter} ORDER BY t.boothCode LIMIT ? OFFSET ?`, [...params, req.paging.limit, req.paging.offset]);
    sendList(res, rows.map(boothOut), req.paging, total);
  } catch (error) { serverError(res, "List booths", error, "ไม่สามารถโหลดแผงตลาดได้"); }
});

app.get(`${API}/markets/:marketId/booths/:boothId/events`, publicCache(0), async (req, res) => {
  const marketId = toId(req.params.marketId);
  const boothId = toId(req.params.boothId);
  if (!marketId || !boothId) return fail(res, 400, "INVALID_ID", "รหัสตลาดหรือรหัสแผงไม่ถูกต้อง");
  try {
    if (!(await findActiveMarket(marketId))) return fail(res, 404, "MARKET_NOT_FOUND", "ไม่พบตลาดนี้");
    const [booths] = await database.execute(`SELECT b.id, b.booth_code AS boothCode, b.map_x AS mapX, b.map_y AS mapY, b.width, b.depth, b.base_price AS price, b.status, ${BOOTH_FIELDS} FROM booths b WHERE b.id = ? AND b.market_id = ?`, [boothId, marketId]);
    if (!booths.length) return fail(res, 404, "BOOTH_NOT_FOUND", "ไม่พบแผงนี้ในตลาด");
    // Same availability rule as the booth list, evaluated for every upcoming round; never exposes who booked.
    const [events] = await database.execute("SELECT e.id, e.market_id AS marketId, e.event_name AS eventName, e.event_date AS eventDate, COALESCE(e.open_time, m.open_time) AS openTime, COALESCE(e.close_time, m.close_time) AS closeTime, e.status, CASE WHEN b.status = 'maintenance' THEN 'maintenance' WHEN b.status <> 'available' THEN 'unavailable' WHEN EXISTS (SELECT 1 FROM bookings x WHERE x.booth_id = b.id AND x.event_id = e.id AND x.status IN ('pending','confirmed')) THEN 'booked' ELSE 'available' END AS availability FROM market_events e JOIN markets m ON m.id = e.market_id JOIN booths b ON b.id = ? AND b.market_id = e.market_id WHERE e.market_id = ? AND e.status <> 'cancelled' AND e.event_date >= ? ORDER BY e.event_date LIMIT 100", [boothId, marketId, todayInMarket()]);
    res.json({ data: { booth: boothOut(booths[0]), events: events.map(withBookable) } });
  } catch (error) { serverError(res, "Booth rounds", error, "ไม่สามารถโหลดสถานะแผงได้"); }
});

// ---------- C. Shop bookings ----------
// Creates one confirmed booking in its own transaction. Returns { booking } or { status, code, message }.
async function bookBooth(userId, shopId, eventId, boothId) {
  let connection;
  try {
    connection = await database.getConnection();
    await connection.beginTransaction();
    const reject = async (status, code, message) => { await connection.rollback(); return { status, code, message }; };
    const [events] = await connection.execute("SELECT e.id, e.market_id, e.event_date, e.status, m.is_active FROM market_events e JOIN markets m ON m.id = e.market_id WHERE e.id = ? LOCK IN SHARE MODE", [eventId]);
    // Locking the booth row serialises concurrent bookings of the same booth.
    const [booths] = await connection.execute("SELECT id, market_id, booth_code, base_price, status FROM booths WHERE id = ? FOR UPDATE", [boothId]);
    const event = events[0];
    const booth = booths[0];
    if (!event || !booth || !event.is_active || event.market_id !== booth.market_id) return reject(404, "EVENT_OR_BOOTH_NOT_FOUND", "ไม่พบรอบตลาดหรือแผงที่เลือก");
    if (!BOOKABLE_EVENT_STATUSES.includes(event.status) || event.event_date < todayInMarket()) return reject(422, "EVENT_NOT_BOOKABLE", "รอบตลาดนี้ไม่เปิดรับจองแล้ว กรุณาเลือกรอบอื่น");
    if (booth.status !== "available") return reject(409, "BOOTH_UNAVAILABLE", "แผงนี้ไม่พร้อมให้จอง กรุณาเลือกแผงอื่น");
    const [active] = await connection.execute("SELECT id, shop_id FROM bookings WHERE event_id = ? AND booth_id = ? AND status IN ('pending','confirmed') FOR UPDATE", [event.id, booth.id]);
    if (active.some(row => row.shop_id === shopId)) return reject(409, "DUPLICATE_BOOKING", "ร้านของคุณจองแผงนี้ในรอบนี้ไว้แล้ว");
    if (active.length) return reject(409, "BOOTH_UNAVAILABLE", "แผงนี้ถูกจองแล้ว กรุณาเลือกแผงอื่น");
    const now = nowSeconds();
    const [insert] = await connection.execute("INSERT INTO bookings (event_id, booth_id, shop_id, status, price_at_booking, booked_at, created_at, updated_at) VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?)", [event.id, booth.id, shopId, booth.base_price, now, now, now]);
    await connection.commit();
    audit("booking.created", { bookingId: insert.insertId, userId, shopId, eventId: event.id, boothId: booth.id });
    return { booking: { id: insert.insertId, event: { id: event.id, eventDate: event.event_date }, booth: { id: booth.id, boothCode: booth.booth_code }, status: "confirmed", price: booth.base_price, bookedAt: now.toISOString() } };
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code)) return { status: 409, code: "BOOTH_UNAVAILABLE", message: "แผงนี้ถูกจองแล้ว กรุณาเลือกแผงอื่น" };
    throw error;
  } finally { connection?.release(); }
}

app.post(`${API}/bookings`, auth, requireShop, async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {};
  const fields = {};
  for (const key of Object.keys(body)) if (!["eventId", "boothId"].includes(key)) fields[key] = "ไม่รับข้อมูลนี้ ระบบกำหนดให้เอง";
  if (!isJsonId(body.eventId)) fields.eventId = "กรุณาเลือกรอบตลาด";
  if (!isJsonId(body.boothId)) fields.boothId = "กรุณาเลือกแผง";
  if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลการจองไม่ถูกต้อง", fields);
  try {
    const result = await bookBooth(req.user.userId, req.user.shopId, body.eventId, body.boothId);
    if (!result.booking) return fail(res, result.status, result.code, result.message);
    res.status(201).json({ data: result.booking });
  } catch (error) { serverError(res, "Booking", error, "ไม่สามารถจองแผงได้ในขณะนี้"); }
});

// Books one booth for several rounds. Each round is its own transaction, so a taken round does not block the others.
app.post(`${API}/bookings/batch`, auth, requireShop, async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {};
  const fields = {};
  for (const key of Object.keys(body)) if (!["eventIds", "boothId"].includes(key)) fields[key] = "ไม่รับข้อมูลนี้ ระบบกำหนดให้เอง";
  if (!isJsonId(body.boothId)) fields.boothId = "กรุณาเลือกแผง";
  if (!Array.isArray(body.eventIds) || !body.eventIds.length || body.eventIds.length > 12 || !body.eventIds.every(isJsonId) || new Set(body.eventIds).size !== body.eventIds.length) fields.eventIds = "เลือกรอบตลาดได้ 1–12 รอบ ไม่ซ้ำกัน";
  if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลการจองไม่ถูกต้อง", fields);
  try {
    const created = [];
    const failed = [];
    for (const eventId of body.eventIds) {
      const result = await bookBooth(req.user.userId, req.user.shopId, eventId, body.boothId);
      if (result.booking) created.push(result.booking);
      else failed.push({ eventId, code: result.code, message: result.message });
    }
    if (!created.length) return fail(res, 409, "NO_BOOKING_CREATED", "ไม่สามารถจองรอบที่เลือกได้เลย", Object.fromEntries(failed.map(item => [String(item.eventId), item.message])));
    res.status(201).json({ data: { created, failed } });
  } catch (error) { serverError(res, "Batch booking", error, "ไม่สามารถจองแผงได้ในขณะนี้"); }
});

app.get(`${API}/bookings`, auth, requireShop, validatePage, async (req, res) => {
  const query = readQuery(req, res, { status: BOOKING_STATUSES, fromDate: "date", toDate: "date", marketId: "id", sort: ["eventDate", "bookedAt"], order: ["asc", "desc"] });
  if (!query) return;
  try {
    const where = "WHERE bk.shop_id = ? AND (? IS NULL OR bk.status = ?) AND (? IS NULL OR e.event_date >= ?) AND (? IS NULL OR e.event_date <= ?) AND (? IS NULL OR e.market_id = ?)";
    const params = [req.user.shopId, query.status, query.status, query.fromDate, query.fromDate, query.toDate, query.toDate, query.marketId, query.marketId];
    const column = query.sort === "bookedAt" ? "bk.booked_at" : "e.event_date";
    const order = query.order === "asc" ? "ASC" : "DESC";
    const [[{ total }]] = await database.execute(`SELECT COUNT(*) AS total FROM bookings bk JOIN market_events e ON e.id = bk.event_id ${where}`, params);
    const [rows] = await database.execute(`${BOOKING_SELECT} ${where} ORDER BY ${column} ${order}, bk.id ${order} LIMIT ? OFFSET ?`, [...params, req.paging.limit, req.paging.offset]);
    sendList(res, rows.map(bookingOut), req.paging, total);
  } catch (error) { serverError(res, "List bookings", error, "ไม่สามารถโหลดรายการจองได้"); }
});

app.get(`${API}/bookings/:bookingId`, auth, requireShop, async (req, res) => {
  const bookingId = toId(req.params.bookingId);
  if (!bookingId) return fail(res, 404, "BOOKING_NOT_FOUND", "ไม่พบรายการจอง");
  try {
    const [rows] = await database.execute(`${BOOKING_SELECT} WHERE bk.id = ? AND bk.shop_id = ?`, [bookingId, req.user.shopId]);
    if (!rows.length) return fail(res, 404, "BOOKING_NOT_FOUND", "ไม่พบรายการจอง");
    res.json({ data: bookingOut(rows[0]) });
  } catch (error) { serverError(res, "Read booking", error, "ไม่สามารถโหลดรายการจองได้"); }
});

app.post(`${API}/bookings/:bookingId/cancel`, auth, requireShop, async (req, res) => {
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
    audit("booking.cancelled", { bookingId, shopId: req.user.shopId, userId: req.user.userId, reasonProvided: Boolean(text(body.reason)) });
    res.json({ data: { id: bookingId, status: "cancelled", cancelledAt: now.toISOString() } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    serverError(res, "Cancel booking", error, "ไม่สามารถยกเลิกการจองได้");
  } finally { connection?.release(); }
});

// ---------- D. Shop profile ----------
app.get(`${API}/shop/profile`, auth, requireShop, async (req, res) => {
  try {
    const [rows] = await database.execute(PROFILE_SELECT, [req.user.shopId, req.user.userId]);
    if (!rows.length) return fail(res, 404, "SHOP_NOT_FOUND", "ไม่พบข้อมูลร้าน");
    res.json({ data: profileOut(rows[0]) });
  } catch (error) { serverError(res, "Read profile", error, "ไม่สามารถโหลดข้อมูลร้านได้"); }
});

app.patch(`${API}/shop/profile`, auth, requireShop, async (req, res) => {
  if (!isPlainObject(req.body) || !Object.keys(req.body).length) return fail(res, 400, "VALIDATION_ERROR", "กรุณาส่งข้อมูลที่ต้องการแก้ไขอย่างน้อยหนึ่งรายการ");
  const fields = {};
  const updates = [];
  const values = [];
  for (const [key, raw] of Object.entries(req.body)) {
    if (key === "categoryId") {
      if (raw !== null && !isJsonId(raw)) fields.categoryId = "กรุณาเลือกประเภทสินค้าจากรายการ";
      else { updates.push("category_id = ?"); values.push(raw); }
      continue;
    }
    const rule = PROFILE_RULES[key];
    if (!rule) { fields[key] = "ไม่สามารถแก้ไขข้อมูลนี้ได้"; continue; }
    if (raw !== null && typeof raw !== "string") { fields[key] = "ต้องเป็นข้อความ"; continue; }
    const value = rule.phone ? normalizePhone(raw) : text(raw);
    if (rule.required && !value) fields[key] = "กรุณากรอกชื่อร้าน";
    else if (value.length > rule.max) fields[key] = `ยาวได้ไม่เกิน ${rule.max} ตัวอักษร`;
    else if (rule.phone && value && !PHONE_PATTERN.test(value)) fields[key] = PHONE_MESSAGE;
    else if (rule.url && value && !isHttpUrl(value)) fields[key] = "ลิงก์ต้องขึ้นต้นด้วย https:// หรือ http://";
    else { updates.push(`${rule.column} = ?`); values.push(value || null); }
  }
  if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", fields);
  try {
    if (isJsonId(req.body.categoryId) && !(await categoryExists(req.body.categoryId))) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", { categoryId: "ไม่พบประเภทสินค้านี้" });
    await database.execute(`UPDATE shops SET ${updates.join(", ")}, updated_at = ? WHERE id = ? AND user_id = ?`, [...values, nowSeconds(), req.user.shopId, req.user.userId]);
    const [rows] = await database.execute(PROFILE_SELECT, [req.user.shopId, req.user.userId]);
    if (!rows.length) return fail(res, 404, "SHOP_NOT_FOUND", "ไม่พบข้อมูลร้าน");
    audit("shop.profile_updated", { shopId: req.user.shopId, userId: req.user.userId, fields: Object.keys(req.body) });
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
    const [rows] = await database.execute(`SELECT b.id, b.booth_code AS boothCode, b.map_x AS mapX, b.map_y AS mapY, b.width, b.depth, ${BOOTH_FIELDS}, CASE WHEN bk.id IS NOT NULL THEN 'occupied' WHEN b.status = 'maintenance' THEN 'maintenance' WHEN b.status <> 'available' THEN 'unavailable' WHEN EXISTS (SELECT 1 FROM bookings x WHERE x.booth_id = b.id AND x.event_id = ? AND x.status = 'pending') THEN 'occupied' ELSE 'available' END AS availability, s.id AS shopId, s.shop_name AS shopName, c.name AS category, c.icon AS categoryIcon, s.description AS shopDescription, s.contact_phone AS contactPhone, s.social_url AS socialUrl, s.image_url AS imageUrl FROM booths b LEFT JOIN bookings bk ON bk.booth_id = b.id AND bk.event_id = ? AND bk.status = 'confirmed' LEFT JOIN shops s ON s.id = bk.shop_id LEFT JOIN categories c ON c.id = s.category_id WHERE b.market_id = ? ORDER BY b.booth_code`, [eventId, eventId, marketId]);
    const booths = rows.map(({ shopId, shopName, category, categoryIcon, shopDescription, contactPhone, socialUrl, imageUrl, ...booth }) => ({ ...boothOut(booth), shop: shopId ? { id: shopId, shopName, category, categoryIcon, description: shopDescription, contactPhone, socialUrl, imageUrl } : null }));
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
    if (query.q) { where += " AND (s.shop_name LIKE ? OR s.description LIKE ? OR c.name LIKE ?)"; params.push(likePattern(query.q), likePattern(query.q), likePattern(query.q)); }
    if (query.category) { where += " AND c.name = ?"; params.push(query.category); }
    const from = "FROM bookings bk JOIN shops s ON s.id = bk.shop_id JOIN booths b ON b.id = bk.booth_id LEFT JOIN categories c ON c.id = s.category_id";
    const column = query.sort === "boothCode" ? "b.booth_code" : "s.shop_name";
    const order = query.order === "desc" ? "DESC" : "ASC";
    const [[{ total }]] = await database.execute(`SELECT COUNT(*) AS total ${from} ${where}`, params);
    const [rows] = await database.execute(`SELECT s.id, s.shop_name AS shopName, c.name AS category, c.icon AS categoryIcon, s.description, s.contact_phone AS contactPhone, s.social_url AS socialUrl, s.image_url AS imageUrl, bk.event_id AS eventId, b.id AS boothId, b.booth_code AS boothCode, b.zone, b.map_x AS mapX, b.map_y AS mapY ${from} ${where} ORDER BY ${column} ${order}, b.booth_code LIMIT ? OFFSET ?`, [...params, req.paging.limit, req.paging.offset]);
    sendList(res, rows, req.paging, total);
  } catch (error) { serverError(res, "Search shops", error, "ไม่สามารถค้นหาร้านค้าได้"); }
});

// Finds products across the whole province: confirmed shops in the next 14 days whose name, category or description matches.
app.get(`${API}/public/search`, publicCache(0), validatePage, async (req, res) => {
  const query = readQuery(req, res, { q: 100, districtId: "id" });
  if (!query) return;
  if (!query.q) return fail(res, 400, "INVALID_QUERY", "ค่าที่ใช้ค้นหาไม่ถูกต้อง", { q: "กรุณาพิมพ์คำที่ต้องการค้นหา" });
  try {
    const today = todayInMarket();
    const like = likePattern(query.q);
    const where = "WHERE bk.status = 'confirmed' AND e.status <> 'cancelled' AND m.is_active = 1 AND e.event_date BETWEEN ? AND ? AND (s.shop_name LIKE ? OR s.description LIKE ? OR c.name LIKE ?) AND (? IS NULL OR m.district_id = ?)";
    const params = [today, addDays(today, 13), like, like, like, query.districtId, query.districtId];
    const from = "FROM bookings bk JOIN shops s ON s.id = bk.shop_id LEFT JOIN categories c ON c.id = s.category_id JOIN market_events e ON e.id = bk.event_id JOIN markets m ON m.id = e.market_id LEFT JOIN districts d ON d.id = m.district_id JOIN booths b ON b.id = bk.booth_id";
    const [[{ total }]] = await database.execute(`SELECT COUNT(*) AS total ${from} ${where}`, params);
    const [rows] = await database.execute(`SELECT s.id AS shopId, s.shop_name AS shopName, c.name AS category, c.icon AS categoryIcon, s.image_url AS imageUrl, m.id AS marketId, m.market_name AS marketName, d.name_th AS districtName, e.id AS eventId, e.event_date AS eventDate, COALESCE(e.open_time, m.open_time) AS openTime, COALESCE(e.close_time, m.close_time) AS closeTime, b.booth_code AS boothCode ${from} ${where} ORDER BY e.event_date, m.market_name, b.booth_code LIMIT ? OFFSET ?`, [...params, req.paging.limit, req.paging.offset]);
    sendList(res, rows.map(row => ({
      shop: { id: row.shopId, shopName: row.shopName, category: row.category, categoryIcon: row.categoryIcon, imageUrl: row.imageUrl },
      market: { id: row.marketId, marketName: row.marketName, districtName: row.districtName },
      event: { id: row.eventId, eventDate: row.eventDate, openTime: row.openTime, closeTime: row.closeTime },
      boothCode: row.boothCode
    })), req.paging, total);
  } catch (error) { serverError(res, "Province search", error, "ไม่สามารถค้นหาสินค้าได้"); }
});

app.get(`${API}/public/shops/:shopId`, publicCache(0), async (req, res) => {
  const shopId = toId(req.params.shopId);
  if (!shopId) return fail(res, 404, "SHOP_NOT_FOUND", "ไม่พบข้อมูลร้าน");
  const query = readQuery(req, res, { eventId: "id" });
  if (!query) return;
  try {
    const today = todayInMarket();
    const from = "FROM bookings bk JOIN shops s ON s.id = bk.shop_id LEFT JOIN categories c ON c.id = s.category_id JOIN market_events e ON e.id = bk.event_id JOIN markets m ON m.id = e.market_id LEFT JOIN districts d ON d.id = m.district_id JOIN booths b ON b.id = bk.booth_id WHERE bk.shop_id = ? AND bk.status = 'confirmed' AND e.status <> 'cancelled' AND m.is_active = 1";
    const [rows] = await database.execute(`SELECT s.id, s.shop_name AS shopName, c.name AS category, c.icon AS categoryIcon, s.description, s.contact_phone AS contactPhone, s.social_url AS socialUrl, s.image_url AS imageUrl, m.id AS marketId, m.market_name AS marketName, m.address, d.name_th AS districtName, e.id AS eventId, e.event_name AS eventName, e.event_date AS eventDate, COALESCE(e.open_time, m.open_time) AS openTime, COALESCE(e.close_time, m.close_time) AS closeTime, b.id AS boothId, b.booth_code AS boothCode, b.zone, b.map_x AS mapX, b.map_y AS mapY ${from} AND (? IS NULL OR e.id = ?) ORDER BY e.event_date >= ? DESC, ABS(DATEDIFF(e.event_date, ?)) ASC, b.booth_code LIMIT 50`, [shopId, query.eventId, query.eventId, today, today]);
    if (!rows.length) return fail(res, 404, "SHOP_NOT_FOUND", query.eventId ? "ร้านนี้ไม่ได้เข้าร่วมรอบตลาดที่เลือก" : "ไม่พบข้อมูลร้านที่เผยแพร่");
    const first = rows[0];
    // Every upcoming round across the province, so customers can find the shop on other days and in other markets.
    const [schedule] = await database.execute(`SELECT e.id AS eventId, e.event_date AS eventDate, COALESCE(e.open_time, m.open_time) AS openTime, COALESCE(e.close_time, m.close_time) AS closeTime, m.id AS marketId, m.market_name AS marketName, d.name_th AS districtName, b.booth_code AS boothCode ${from} AND e.event_date >= ? ORDER BY e.event_date, m.market_name LIMIT 12`, [shopId, today]);
    res.json({ data: {
      id: first.id, shopName: first.shopName, category: first.category, categoryIcon: first.categoryIcon, description: first.description, contactPhone: first.contactPhone, socialUrl: first.socialUrl, imageUrl: first.imageUrl,
      market: { id: first.marketId, marketName: first.marketName, address: first.address, districtName: first.districtName },
      event: { id: first.eventId, eventName: first.eventName, eventDate: first.eventDate, openTime: first.openTime, closeTime: first.closeTime },
      booths: rows.filter(row => row.eventId === first.eventId).map(row => ({ id: row.boothId, boothCode: row.boothCode, zone: row.zone, mapX: row.mapX, mapY: row.mapY })),
      schedule: schedule.map(row => ({ event: { id: row.eventId, eventDate: row.eventDate, openTime: row.openTime, closeTime: row.closeTime }, market: { id: row.marketId, marketName: row.marketName, districtName: row.districtName }, boothCode: row.boothCode }))
    } });
  } catch (error) { serverError(res, "Public shop", error, "ไม่สามารถโหลดข้อมูลร้านได้"); }
});

app.post(`${API}/shop/profile/image`, auth, requireShop, async (req, res) => {
  const image = isPlainObject(req.body) && typeof req.body.image === "string" ? req.body.image : "";
  const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(image);
  const buffer = match ? Buffer.from(match[1], "base64") : null;
  // Trust the file's own bytes, not the declared type.
  const type = buffer && IMAGE_TYPES.find(item => item.test(buffer));
  if (!type || buffer.length > 2 * 1024 * 1024) return fail(res, 400, "VALIDATION_ERROR", "รูปไม่ถูกต้อง", { image: "ใช้ไฟล์รูป JPG, PNG หรือ WEBP ขนาดไม่เกิน 2 MB" });
  try {
    const name = `shop-${req.user.shopId}-${crypto.randomBytes(8).toString("hex")}.${type.ext}`;
    await fs.promises.writeFile(path.join(SHOP_IMAGE_DIR, name), buffer);
    await database.execute("UPDATE shops SET image_url = ?, updated_at = ? WHERE id = ? AND user_id = ?", [`/images/shops/${name}`, nowSeconds(), req.user.shopId, req.user.userId]);
    const [rows] = await database.execute(PROFILE_SELECT, [req.user.shopId, req.user.userId]);
    audit("shop.image_updated", { shopId: req.user.shopId, userId: req.user.userId, bytes: buffer.length });
    res.json({ data: profileOut(rows[0]) });
  } catch (error) { serverError(res, "Upload shop image", error, "ไม่สามารถบันทึกรูปร้านได้"); }
});

app.delete(`${API}/shop/profile/image`, auth, requireShop, async (req, res) => {
  try {
    await database.execute("UPDATE shops SET image_url = NULL, updated_at = ? WHERE id = ? AND user_id = ?", [nowSeconds(), req.user.shopId, req.user.userId]);
    const [rows] = await database.execute(PROFILE_SELECT, [req.user.shopId, req.user.userId]);
    audit("shop.image_removed", { shopId: req.user.shopId, userId: req.user.userId });
    res.json({ data: profileOut(rows[0]) });
  } catch (error) { serverError(res, "Remove shop image", error, "ไม่สามารถลบรูปร้านได้"); }
});

// ---------- F. Market admin (role = 'admin', manages every market in the province) ----------
const ADMIN_EVENT_STATUSES = ["scheduled", "open", "closed", "cancelled"];
const BOOTH_STATUSES = ["available", "unavailable", "maintenance"];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const MARKET_RULES = {
  code: { column: "code", type: "text", max: 20, pattern: /^[A-Z0-9][A-Z0-9-]{1,19}$/, upper: true, patternMessage: "ใช้ตัวอักษรภาษาอังกฤษ ตัวเลข และ - 2–20 ตัว เช่น TAK-MS-01" },
  marketName: { column: "market_name", type: "text", max: 150, required: true },
  districtId: { column: "district_id", type: "id", required: true },
  subdistrict: { column: "subdistrict", type: "text", max: 100 },
  address: { column: "address", type: "text", max: 500 },
  latitude: { column: "latitude", type: "number", min: TAK_BOUNDS.lat[0], max: TAK_BOUNDS.lat[1], required: true, rangeMessage: "ละติจูดต้องอยู่ในจังหวัดตาก (15.0–18.0)" },
  longitude: { column: "longitude", type: "number", min: TAK_BOUNDS.lng[0], max: TAK_BOUNDS.lng[1], required: true, rangeMessage: "ลองจิจูดต้องอยู่ในจังหวัดตาก (97.3–99.8)" },
  marketType: { column: "market_type", type: "enum", values: MARKET_TYPES, required: true },
  openDays: { column: "open_days", type: "days", required: true },
  openTime: { column: "open_time", type: "time", required: true },
  closeTime: { column: "close_time", type: "time", required: true },
  description: { column: "description", type: "text", max: 2000 },
  organizer: { column: "organizer", type: "text", max: 150 },
  contactPhone: { column: "contact_phone", type: "phone" },
  isActive: { column: "is_active", type: "bool" }
};
const EVENT_RULES = {
  eventName: { column: "event_name", type: "text", max: 150, required: true },
  eventDate: { column: "event_date", type: "date", required: true },
  openTime: { column: "open_time", type: "time" },
  closeTime: { column: "close_time", type: "time" },
  status: { column: "status", type: "enum", values: ADMIN_EVENT_STATUSES }
};
const BOOTH_RULES = {
  boothCode: { column: "booth_code", type: "text", max: 30, required: true, pattern: /^[0-9A-Zก-ฮ][0-9A-Zก-ฮ-]{0,29}$/u, upper: true, patternMessage: "ใช้ตัวอักษร ตัวเลข และ - เท่านั้น เช่น A07" },
  zone: { column: "zone", type: "text", max: 50 },
  mapX: { column: "map_x", type: "number", min: 0, max: 100 },
  mapY: { column: "map_y", type: "number", min: 0, max: 100 },
  width: { column: "width", type: "number", min: 0.5, max: 50 },
  depth: { column: "depth", type: "number", min: 0.5, max: 50 },
  price: { column: "base_price", type: "number", min: 0, max: 100000, required: true },
  status: { column: "status", type: "enum", values: BOOTH_STATUSES },
  hasElectricity: { column: "has_electricity", type: "bool" },
  hasRoof: { column: "has_roof", type: "bool" },
  note: { column: "note", type: "text", max: 255 }
};
const adminOnly = [auth, requireAdmin];

// Validates an admin JSON body against rules; returns column → value for the accepted fields.
function readBody(body, rules, partial, extraKeys = []) {
  const values = {};
  const fields = {};
  if (!isPlainObject(body)) return { values, fields: { body: "ต้องส่งข้อมูลเป็น JSON" } };
  for (const key of Object.keys(body)) if (!rules[key] && !extraKeys.includes(key)) fields[key] = "ไม่สามารถแก้ไขข้อมูลนี้ได้";
  for (const [key, rule] of Object.entries(rules)) {
    let raw = typeof body[key] === "string" ? body[key].trim() : body[key];
    if (raw === undefined) { if (!partial && rule.required) fields[key] = "จำเป็นต้องกรอก"; continue; }
    if (raw === null || raw === "" || (Array.isArray(raw) && !raw.length)) { if (rule.required) fields[key] = "จำเป็นต้องกรอก"; else values[rule.column] = null; continue; }
    if (rule.type === "text") {
      if (typeof raw !== "string") { fields[key] = "ต้องเป็นข้อความ"; continue; }
      if (rule.upper) raw = raw.toUpperCase();
      if (raw.length > rule.max) fields[key] = `ยาวได้ไม่เกิน ${rule.max} ตัวอักษร`;
      else if (rule.pattern && !rule.pattern.test(raw)) fields[key] = rule.patternMessage;
      else values[rule.column] = raw;
    } else if (rule.type === "time") {
      if (typeof raw === "string" && TIME_PATTERN.test(raw)) values[rule.column] = raw.length === 5 ? `${raw}:00` : raw;
      else fields[key] = "เวลาต้องอยู่ในรูปแบบ HH:MM";
    } else if (rule.type === "date") {
      if (typeof raw === "string" && isValidDate(raw)) values[rule.column] = raw;
      else fields[key] = "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD";
    } else if (rule.type === "number") {
      if (typeof raw === "number" && Number.isFinite(raw) && raw >= rule.min && raw <= rule.max) values[rule.column] = raw;
      else fields[key] = rule.rangeMessage || `ต้องเป็นตัวเลข ${rule.min}–${rule.max}`;
    } else if (rule.type === "id") {
      if (isJsonId(raw)) values[rule.column] = raw;
      else fields[key] = "กรุณาเลือกจากรายการ";
    } else if (rule.type === "enum") {
      if (rule.values.includes(raw)) values[rule.column] = raw;
      else fields[key] = `ค่าที่อนุญาต: ${rule.values.join(", ")}`;
    } else if (rule.type === "bool") {
      if (typeof raw === "boolean") values[rule.column] = raw ? 1 : 0;
      else fields[key] = "ต้องเป็น true หรือ false";
    } else if (rule.type === "days") {
      // Weekdays as 0 (Sunday) – 6 (Saturday), stored sorted as "0,6".
      if (Array.isArray(raw) && raw.every(day => Number.isInteger(day) && day >= 0 && day <= 6) && new Set(raw).size === raw.length) values[rule.column] = [...raw].sort().join(",");
      else fields[key] = "เลือกวันเปิดตลาดอย่างน้อย 1 วัน (0 = อาทิตย์ … 6 = เสาร์) ไม่ซ้ำกัน";
    } else if (rule.type === "phone") {
      const phone = typeof raw === "string" ? raw.replace(/[\s-]/g, "") : "";
      if (PHONE_PATTERN.test(phone)) values[rule.column] = phone;
      else fields[key] = PHONE_MESSAGE;
    }
  }
  if (partial && !Object.keys(values).length && !Object.keys(fields).length) fields.body = "กรุณาส่งข้อมูลที่ต้องการแก้ไขอย่างน้อยหนึ่งรายการ";
  return { values, fields };
}
// Checks rules that span several fields, using the stored row for fields the request leaves out.
function checkTimes(values, current, fields, keys = { open: "open_time", close: "close_time" }) {
  const open = values[keys.open] !== undefined ? values[keys.open] : current?.[keys.open];
  const close = values[keys.close] !== undefined ? values[keys.close] : current?.[keys.close];
  if (open && close && close <= open) fields.closeTime = "เวลาปิดต้องหลังเวลาเปิด";
}
async function districtExists(districtId) {
  const [rows] = await database.execute("SELECT id FROM districts WHERE id = ?", [districtId]);
  return rows.length > 0;
}
function csvCell(value) {
  let cell = value == null ? "" : String(value);
  // A leading = + - @ would run as a formula when the file is opened in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
const ADMIN_MARKET_STATS = "(SELECT COUNT(*) FROM market_events e WHERE e.market_id = m.id AND e.status <> 'cancelled' AND e.event_date >= ?) AS upcomingEvents, (SELECT MAX(e.event_date) FROM market_events e WHERE e.market_id = m.id AND e.status <> 'cancelled') AS lastEventDate, (SELECT COUNT(*) FROM booths b WHERE b.market_id = m.id) AS boothCount";
const ADMIN_EVENT_SELECT = "SELECT e.id, e.market_id AS marketId, e.event_name AS eventName, e.event_date AS eventDate, e.open_time AS ownOpenTime, e.close_time AS ownCloseTime, COALESCE(e.open_time, m.open_time) AS openTime, COALESCE(e.close_time, m.close_time) AS closeTime, e.status, (SELECT COUNT(*) FROM bookings x WHERE x.event_id = e.id AND x.status IN ('pending','confirmed')) AS bookedCount, (SELECT COALESCE(SUM(x.price_at_booking), 0) FROM bookings x WHERE x.event_id = e.id AND x.status = 'confirmed') AS revenue FROM market_events e JOIN markets m ON m.id = e.market_id";
const ADMIN_BOOTH_SELECT = "SELECT b.id, b.market_id AS marketId, b.booth_code AS boothCode, b.map_x AS mapX, b.map_y AS mapY, b.width, b.depth, b.base_price AS price, b.status, b.zone, b.has_electricity AS hasElectricity, b.has_roof AS hasRoof, b.note FROM booths b";
async function readAdminMarket(marketId) {
  const [rows] = await database.execute(`SELECT ${MARKET_COLUMNS}, ${ADMIN_MARKET_STATS} ${MARKET_FROM} WHERE m.id = ?`, [todayInMarket(), marketId]);
  return rows[0] ? { ...marketOut(rows[0], true), upcomingEvents: rows[0].upcomingEvents, lastEventDate: rows[0].lastEventDate, boothCount: rows[0].boothCount } : null;
}

app.get(`${API}/admin/overview`, ...adminOnly, async (req, res) => {
  const query = readQuery(req, res, { marketId: "id" });
  if (!query) return;
  try {
    const today = todayInMarket();
    const week = addDays(today, 6);
    const month = addDays(today, 29);
    const [[shops]] = await database.execute("SELECT COUNT(*) AS total, COALESCE(SUM(u.is_active = 1), 0) AS active FROM shops s JOIN users u ON u.id = s.user_id");
    const [[markets]] = await database.execute("SELECT COUNT(*) AS total, COALESCE(SUM(is_active = 1), 0) AS active FROM markets");
    const [districts] = await database.execute("SELECT d.id, d.name_th AS name, (SELECT COUNT(*) FROM markets m WHERE m.district_id = d.id AND m.is_active = 1) AS markets, (SELECT COUNT(*) FROM market_events e JOIN markets m ON m.id = e.market_id WHERE m.district_id = d.id AND e.status <> 'cancelled' AND e.event_date BETWEEN ? AND ?) AS eventsNext7, (SELECT COUNT(*) FROM bookings x JOIN market_events e ON e.id = x.event_id JOIN markets m ON m.id = e.market_id WHERE m.district_id = d.id AND x.status = 'confirmed' AND e.event_date BETWEEN ? AND ?) AS bookingsNext7, (SELECT COALESCE(SUM(x.price_at_booking), 0) FROM bookings x JOIN market_events e ON e.id = x.event_id JOIN markets m ON m.id = e.market_id WHERE m.district_id = d.id AND x.status = 'confirmed' AND e.event_date BETWEEN ? AND ?) AS revenue30 FROM districts d ORDER BY d.sort_order, d.id", [today, week, today, week, today, month]);
    // Markets whose schedule runs out within three weeks need new rounds before shops can keep booking.
    const [lowRounds] = await database.execute("SELECT * FROM (SELECT m.id, m.market_name AS marketName, (SELECT MAX(e.event_date) FROM market_events e WHERE e.market_id = m.id AND e.status <> 'cancelled') AS lastEventDate FROM markets m WHERE m.is_active = 1) t WHERE t.lastEventDate IS NULL OR t.lastEventDate < ? ORDER BY t.lastEventDate", [addDays(today, 21)]);
    let nextEvent = null;
    if (query.marketId) {
      const [next] = await database.execute(`${ADMIN_EVENT_SELECT} WHERE e.market_id = ? AND e.status <> 'cancelled' AND e.event_date >= ? ORDER BY e.event_date LIMIT 1`, [query.marketId, today]);
      if (next.length) {
        const [[booths]] = await database.execute("SELECT COUNT(*) AS total, COALESCE(SUM(status = 'available'), 0) AS usable FROM booths WHERE market_id = ?", [query.marketId]);
        nextEvent = { ...withBookable(next[0]), boothTotal: booths.total, boothUsable: Number(booths.usable) };
      }
    }
    const rows = districts.map(row => ({ ...row, revenue30: Number(row.revenue30) }));
    res.json({ data: {
      shops: { total: shops.total, active: Number(shops.active) },
      markets: { total: markets.total, active: Number(markets.active) },
      bookingsNext7: rows.reduce((sum, row) => sum + row.bookingsNext7, 0),
      revenueNext30: rows.reduce((sum, row) => sum + row.revenue30, 0),
      districts: rows, lowRounds, nextEvent
    } });
  } catch (error) { serverError(res, "Admin overview", error, "ไม่สามารถโหลดภาพรวมได้"); }
});

app.get(`${API}/admin/markets`, ...adminOnly, async (req, res) => {
  try {
    const [rows] = await database.execute(`SELECT ${MARKET_COLUMNS}, ${ADMIN_MARKET_STATS} ${MARKET_FROM} ORDER BY d.sort_order, m.market_name, m.id`, [todayInMarket()]);
    const data = rows.map(row => ({ ...marketOut(row, true), upcomingEvents: row.upcomingEvents, lastEventDate: row.lastEventDate, boothCount: row.boothCount }));
    res.json({ data, pagination: { page: 1, limit: data.length || 1, total: data.length, totalPages: data.length ? 1 : 0 } });
  } catch (error) { serverError(res, "Admin markets", error, "ไม่สามารถโหลดข้อมูลตลาดได้"); }
});

app.post(`${API}/admin/markets`, ...adminOnly, async (req, res) => {
  const { values, fields } = readBody(req.body, MARKET_RULES, false);
  checkTimes(values, null, fields);
  if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", fields);
  try {
    if (!(await districtExists(values.district_id))) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", { districtId: "ไม่พบอำเภอนี้" });
    const now = nowSeconds();
    const data = { is_active: 1, ...values, created_at: now, updated_at: now };
    const [insert] = await database.execute(`INSERT INTO markets (${Object.keys(data).join(", ")}) VALUES (${Object.keys(data).map(() => "?").join(", ")})`, Object.values(data));
    if (!values.code) await database.execute("UPDATE markets SET code = ? WHERE id = ?", [`TAK-${String(insert.insertId).padStart(4, "0")}`, insert.insertId]);
    audit("admin.market_created", { adminId: req.user.userId, marketId: insert.insertId });
    res.status(201).json({ data: await readAdminMarket(insert.insertId) });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return fail(res, 409, "MARKET_CODE_EXISTS", "รหัสตลาดนี้มีอยู่แล้ว", { code: "รหัสตลาดซ้ำ" });
    serverError(res, "Admin create market", error, "ไม่สามารถเพิ่มตลาดได้");
  }
});

app.patch(`${API}/admin/markets/:marketId`, ...adminOnly, async (req, res) => {
  const marketId = toId(req.params.marketId);
  if (!marketId) return fail(res, 400, "INVALID_ID", "รหัสตลาดไม่ถูกต้อง");
  const { values, fields } = readBody(req.body, MARKET_RULES, true);
  if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", fields);
  try {
    const [current] = await database.execute("SELECT open_time, close_time FROM markets WHERE id = ?", [marketId]);
    if (!current.length) return fail(res, 404, "MARKET_NOT_FOUND", "ไม่พบตลาดนี้");
    checkTimes(values, current[0], fields);
    if (values.district_id && !(await districtExists(values.district_id))) fields.districtId = "ไม่พบอำเภอนี้";
    if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", fields);
    const columns = Object.keys(values);
    await database.execute(`UPDATE markets SET ${columns.map(column => `${column} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...Object.values(values), nowSeconds(), marketId]);
    audit("admin.market_updated", { adminId: req.user.userId, marketId, fields: columns });
    res.json({ data: await readAdminMarket(marketId) });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return fail(res, 409, "MARKET_CODE_EXISTS", "รหัสตลาดนี้มีอยู่แล้ว", { code: "รหัสตลาดซ้ำ" });
    serverError(res, "Admin update market", error, "ไม่สามารถบันทึกข้อมูลตลาดได้");
  }
});

app.get(`${API}/admin/markets/:marketId/events`, ...adminOnly, validatePage, async (req, res) => {
  const marketId = toId(req.params.marketId);
  if (!marketId) return fail(res, 400, "INVALID_ID", "รหัสตลาดไม่ถูกต้อง");
  const query = readQuery(req, res, { fromDate: "date", toDate: "date", status: ADMIN_EVENT_STATUSES, order: ["asc", "desc"] });
  if (!query) return;
  try {
    const where = "WHERE e.market_id = ? AND (? IS NULL OR e.event_date >= ?) AND (? IS NULL OR e.event_date <= ?) AND (? IS NULL OR e.status = ?)";
    const params = [marketId, query.fromDate, query.fromDate, query.toDate, query.toDate, query.status, query.status];
    const order = query.order === "desc" ? "DESC" : "ASC";
    const [[{ total }]] = await database.execute(`SELECT COUNT(*) AS total FROM market_events e ${where}`, params);
    const [rows] = await database.execute(`${ADMIN_EVENT_SELECT} ${where} ORDER BY e.event_date ${order}, e.id ${order} LIMIT ? OFFSET ?`, [...params, req.paging.limit, req.paging.offset]);
    sendList(res, rows.map(withBookable), req.paging, total);
  } catch (error) { serverError(res, "Admin events", error, "ไม่สามารถโหลดรอบตลาดได้"); }
});

// Creates rounds from eventDate onwards: the same weekday for repeatWeeks weeks ("weekly"),
// or every open day of the market within those weeks ("openDays"). Dates that already have a round are skipped.
app.post(`${API}/admin/markets/:marketId/events`, ...adminOnly, async (req, res) => {
  const marketId = toId(req.params.marketId);
  if (!marketId) return fail(res, 400, "INVALID_ID", "รหัสตลาดไม่ถูกต้อง");
  const { values, fields } = readBody(req.body, EVENT_RULES, false, ["repeatWeeks", "pattern"]);
  const repeatWeeks = req.body?.repeatWeeks === undefined ? 1 : req.body.repeatWeeks;
  const pattern = req.body?.pattern === undefined ? "weekly" : req.body.pattern;
  if (!Number.isInteger(repeatWeeks) || repeatWeeks < 1 || repeatWeeks > 26) fields.repeatWeeks = "จำนวนสัปดาห์ต้องเป็น 1–26";
  if (!["weekly", "openDays"].includes(pattern)) fields.pattern = "ค่าที่อนุญาต: weekly, openDays";
  if (values.event_date && values.event_date < todayInMarket()) fields.eventDate = "สร้างรอบย้อนหลังไม่ได้ เลือกวันนี้หรือวันถัดไป";
  checkTimes(values, null, fields);
  if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", fields);
  let connection;
  try {
    const [markets] = await database.execute("SELECT id, open_days FROM markets WHERE id = ?", [marketId]);
    if (!markets.length) return fail(res, 404, "MARKET_NOT_FOUND", "ไม่พบตลาดนี้");
    const dates = [];
    if (pattern === "openDays") {
      const days = parseDays(markets[0].open_days);
      for (let offset = 0; offset < repeatWeeks * 7; offset += 1) { const date = addDays(values.event_date, offset); if (days.includes(weekday(date))) dates.push(date); }
      if (!dates.length) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", { pattern: "ตลาดนี้ยังไม่ได้กำหนดวันเปิด ตั้งค่าที่แท็บข้อมูลตลาดก่อน" });
    } else for (let week = 0; week < repeatWeeks; week += 1) dates.push(addDays(values.event_date, week * 7));
    connection = await database.getConnection();
    await connection.beginTransaction();
    const created = [];
    const skipped = [];
    for (const eventDate of dates) {
      const [existing] = await connection.execute("SELECT id FROM market_events WHERE market_id = ? AND event_date = ? AND status <> 'cancelled' LIMIT 1", [marketId, eventDate]);
      if (existing.length) { skipped.push(eventDate); continue; }
      const [insert] = await connection.execute("INSERT INTO market_events (market_id, event_name, event_date, open_time, close_time, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [marketId, values.event_name, eventDate, values.open_time ?? null, values.close_time ?? null, values.status || "scheduled", nowSeconds()]);
      created.push(insert.insertId);
    }
    await connection.commit();
    const [rows] = created.length ? await database.query(`${ADMIN_EVENT_SELECT} WHERE e.id IN (?) ORDER BY e.event_date`, [created]) : [[]];
    audit("admin.events_created", { adminId: req.user.userId, marketId, count: created.length, pattern });
    res.status(created.length ? 201 : 200).json({ data: { created: rows.map(withBookable), skippedDates: skipped } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    serverError(res, "Admin create events", error, "ไม่สามารถเพิ่มรอบตลาดได้");
  } finally { connection?.release(); }
});

// Cancelling a round also cancels its active bookings, so shops see the change in their booking history.
app.patch(`${API}/admin/events/:eventId`, ...adminOnly, async (req, res) => {
  const eventId = toId(req.params.eventId);
  if (!eventId) return fail(res, 400, "INVALID_ID", "รหัสรอบตลาดไม่ถูกต้อง");
  const { values, fields } = readBody(req.body, EVENT_RULES, true);
  if (values.event_date && values.event_date < todayInMarket()) fields.eventDate = "ย้ายรอบไปวันที่ผ่านมาแล้วไม่ได้";
  if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", fields);
  let connection;
  try {
    connection = await database.getConnection();
    await connection.beginTransaction();
    const reject = async (status, code, message, extra) => { await connection.rollback(); return fail(res, status, code, message, extra); };
    const [events] = await connection.execute("SELECT id, market_id, event_date, status, open_time, close_time FROM market_events WHERE id = ? FOR UPDATE", [eventId]);
    if (!events.length) return reject(404, "EVENT_NOT_FOUND", "ไม่พบรอบตลาดนี้");
    checkTimes(values, events[0], fields);
    if (Object.keys(fields).length) return reject(400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", fields);
    const finalStatus = values.status || events[0].status;
    if (values.event_date && values.event_date !== events[0].event_date && finalStatus !== "cancelled") {
      const [clash] = await connection.execute("SELECT id FROM market_events WHERE market_id = ? AND event_date = ? AND status <> 'cancelled' AND id <> ? LIMIT 1", [events[0].market_id, values.event_date, eventId]);
      if (clash.length) return reject(409, "EVENT_DATE_EXISTS", "ตลาดนี้มีรอบในวันที่เลือกอยู่แล้ว", { eventDate: "มีรอบในวันนี้อยู่แล้ว" });
    }
    const columns = Object.keys(values);
    await connection.execute(`UPDATE market_events SET ${columns.map(column => `${column} = ?`).join(", ")} WHERE id = ?`, [...Object.values(values), eventId]);
    let cancelledBookings = 0;
    if (values.status === "cancelled" && events[0].status !== "cancelled") {
      const now = nowSeconds();
      const [result] = await connection.execute("UPDATE bookings SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE event_id = ? AND status IN ('pending','confirmed')", [now, now, eventId]);
      cancelledBookings = result.affectedRows;
    }
    await connection.commit();
    const [rows] = await database.execute(`${ADMIN_EVENT_SELECT} WHERE e.id = ?`, [eventId]);
    audit("admin.event_updated", { adminId: req.user.userId, eventId, fields: columns, cancelledBookings });
    res.json({ data: { ...withBookable(rows[0]), cancelledBookings } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    serverError(res, "Admin update event", error, "ไม่สามารถบันทึกรอบตลาดได้");
  } finally { connection?.release(); }
});

app.get(`${API}/admin/markets/:marketId/booths`, ...adminOnly, async (req, res) => {
  const marketId = toId(req.params.marketId);
  if (!marketId) return fail(res, 400, "INVALID_ID", "รหัสตลาดไม่ถูกต้อง");
  try {
    const [rows] = await database.execute(`${ADMIN_BOOTH_SELECT} WHERE b.market_id = ? ORDER BY b.booth_code LIMIT 500`, [marketId]);
    res.json({ data: rows.map(boothOut), pagination: { page: 1, limit: 500, total: rows.length, totalPages: rows.length ? 1 : 0 } });
  } catch (error) { serverError(res, "Admin booths", error, "ไม่สามารถโหลดแผงได้"); }
});

app.post(`${API}/admin/markets/:marketId/booths`, ...adminOnly, async (req, res) => {
  const marketId = toId(req.params.marketId);
  if (!marketId) return fail(res, 400, "INVALID_ID", "รหัสตลาดไม่ถูกต้อง");
  const { values, fields } = readBody(req.body, BOOTH_RULES, false);
  if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", fields);
  try {
    const [markets] = await database.execute("SELECT id FROM markets WHERE id = ?", [marketId]);
    if (!markets.length) return fail(res, 404, "MARKET_NOT_FOUND", "ไม่พบตลาดนี้");
    const now = nowSeconds();
    const data = { status: "available", ...values, market_id: marketId, created_at: now, updated_at: now };
    const [insert] = await database.execute(`INSERT INTO booths (${Object.keys(data).join(", ")}) VALUES (${Object.keys(data).map(() => "?").join(", ")})`, Object.values(data));
    const [rows] = await database.execute(`${ADMIN_BOOTH_SELECT} WHERE b.id = ?`, [insert.insertId]);
    audit("admin.booth_created", { adminId: req.user.userId, marketId, boothId: insert.insertId });
    res.status(201).json({ data: boothOut(rows[0]) });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return fail(res, 409, "BOOTH_CODE_EXISTS", "หมายเลขแผงนี้มีอยู่แล้ว", { boothCode: "หมายเลขแผงซ้ำ" });
    serverError(res, "Admin create booth", error, "ไม่สามารถเพิ่มแผงได้");
  }
});

app.patch(`${API}/admin/booths/:boothId`, ...adminOnly, async (req, res) => {
  const boothId = toId(req.params.boothId);
  if (!boothId) return fail(res, 400, "INVALID_ID", "รหัสแผงไม่ถูกต้อง");
  const { values, fields } = readBody(req.body, BOOTH_RULES, true);
  if (Object.keys(fields).length) return fail(res, 400, "VALIDATION_ERROR", "ข้อมูลที่ส่งมาไม่ถูกต้อง", fields);
  try {
    const columns = Object.keys(values);
    const [result] = await database.execute(`UPDATE booths SET ${columns.map(column => `${column} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...Object.values(values), nowSeconds(), boothId]);
    if (!result.affectedRows) return fail(res, 404, "BOOTH_NOT_FOUND", "ไม่พบแผงนี้");
    const [rows] = await database.execute(`${ADMIN_BOOTH_SELECT} WHERE b.id = ?`, [boothId]);
    // Existing bookings stay valid when a booth is closed, so the admin is told how many still need handling.
    const [[{ activeBookings }]] = await database.execute("SELECT COUNT(*) AS activeBookings FROM bookings x JOIN market_events e ON e.id = x.event_id WHERE x.booth_id = ? AND x.status IN ('pending','confirmed') AND e.event_date >= ?", [boothId, todayInMarket()]);
    audit("admin.booth_updated", { adminId: req.user.userId, boothId, fields: columns });
    res.json({ data: { ...boothOut(rows[0]), activeBookings } });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return fail(res, 409, "BOOTH_CODE_EXISTS", "หมายเลขแผงนี้มีอยู่แล้ว", { boothCode: "หมายเลขแผงซ้ำ" });
    serverError(res, "Admin update booth", error, "ไม่สามารถบันทึกแผงได้");
  }
});

// Shared by the bookings table and its CSV export so both always show the same rows.
function adminBookingFilter(query) {
  let where = "WHERE (? IS NULL OR e.market_id = ?) AND (? IS NULL OR bk.event_id = ?) AND (? IS NULL OR bk.status = ?) AND (? IS NULL OR e.event_date >= ?) AND (? IS NULL OR e.event_date <= ?)";
  const params = [query.marketId, query.marketId, query.eventId, query.eventId, query.status, query.status, query.fromDate, query.fromDate, query.toDate, query.toDate];
  if (query.q) { where += " AND (s.shop_name LIKE ? OR b.booth_code LIKE ? OR u.email LIKE ?)"; params.push(likePattern(query.q), likePattern(query.q), likePattern(query.q)); }
  return { where, params };
}
const ADMIN_BOOKING_QUERY = { marketId: "id", eventId: "id", status: BOOKING_STATUSES, q: 100, fromDate: "date", toDate: "date" };
const ADMIN_BOOKING_FROM = "FROM bookings bk JOIN shops s ON s.id = bk.shop_id JOIN users u ON u.id = s.user_id LEFT JOIN categories c ON c.id = s.category_id JOIN market_events e ON e.id = bk.event_id JOIN markets m ON m.id = e.market_id JOIN booths b ON b.id = bk.booth_id";
const ADMIN_BOOKING_COLUMNS = "bk.id, bk.status, bk.price_at_booking AS price, bk.booked_at AS bookedAt, bk.cancelled_at AS cancelledAt, m.id AS marketId, m.market_name AS marketName, e.id AS eventId, e.event_name AS eventName, e.event_date AS eventDate, b.id AS boothId, b.booth_code AS boothCode, s.id AS shopId, s.shop_name AS shopName, c.name AS category, s.contact_name AS contactName, s.contact_phone AS contactPhone, u.email, u.is_active AS isActive";

app.get(`${API}/admin/bookings`, ...adminOnly, validatePage, async (req, res) => {
  const query = readQuery(req, res, ADMIN_BOOKING_QUERY);
  if (!query) return;
  try {
    const { where, params } = adminBookingFilter(query);
    const [[{ total }]] = await database.execute(`SELECT COUNT(*) AS total ${ADMIN_BOOKING_FROM} ${where}`, params);
    const [rows] = await database.execute(`SELECT ${ADMIN_BOOKING_COLUMNS} ${ADMIN_BOOKING_FROM} ${where} ORDER BY e.event_date DESC, b.booth_code LIMIT ? OFFSET ?`, [...params, req.paging.limit, req.paging.offset]);
    sendList(res, rows.map(row => ({
      id: row.id, status: row.status, price: row.price, bookedAt: row.bookedAt, cancelledAt: row.cancelledAt,
      market: { id: row.marketId, marketName: row.marketName },
      event: { id: row.eventId, eventName: row.eventName, eventDate: row.eventDate },
      booth: { id: row.boothId, boothCode: row.boothCode },
      shop: { id: row.shopId, shopName: row.shopName, category: row.category, contactName: row.contactName, contactPhone: row.contactPhone, email: row.email, isActive: Boolean(row.isActive) }
    })), req.paging, total);
  } catch (error) { serverError(res, "Admin bookings", error, "ไม่สามารถโหลดรายการจองได้"); }
});

app.get(`${API}/admin/bookings/export`, ...adminOnly, async (req, res) => {
  const query = readQuery(req, res, ADMIN_BOOKING_QUERY);
  if (!query) return;
  try {
    const { where, params } = adminBookingFilter(query);
    const [rows] = await database.execute(`SELECT ${ADMIN_BOOKING_COLUMNS} ${ADMIN_BOOKING_FROM} ${where} ORDER BY e.event_date DESC, m.market_name, b.booth_code LIMIT 10000`, params);
    const header = ["เลขที่การจอง", "สถานะ", "ตลาด", "วันจัดงาน", "รอบ", "แผง", "ร้าน", "ประเภทสินค้า", "ผู้ติดต่อ", "เบอร์ติดต่อ", "อีเมล", "ค่าเช่า", "จองเมื่อ (UTC)", "ยกเลิกเมื่อ (UTC)"];
    const lines = rows.map(row => [row.id, row.status, row.marketName, row.eventDate, row.eventName, row.boothCode, row.shopName, row.category, row.contactName, row.contactPhone, row.email, row.price, row.bookedAt?.toISOString?.() ?? row.bookedAt, row.cancelledAt?.toISOString?.() ?? row.cancelledAt].map(csvCell).join(","));
    audit("admin.bookings_exported", { adminId: req.user.userId, rows: rows.length });
    // The BOM makes Excel read the Thai text as UTF-8.
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="bookings-${todayInMarket()}.csv"` });
    res.send(`﻿${[header.join(","), ...lines].join("\r\n")}\r\n`);
  } catch (error) { serverError(res, "Admin bookings export", error, "ไม่สามารถส่งออกรายการจองได้"); }
});

// Allowed transitions: pending → confirmed/rejected/cancelled, confirmed → rejected/cancelled.
app.post(`${API}/admin/bookings/:bookingId/status`, ...adminOnly, async (req, res) => {
  const bookingId = toId(req.params.bookingId);
  if (!bookingId) return fail(res, 404, "BOOKING_NOT_FOUND", "ไม่พบรายการจอง");
  const status = req.body?.status;
  if (!["confirmed", "rejected", "cancelled"].includes(status)) return fail(res, 400, "VALIDATION_ERROR", "สถานะไม่ถูกต้อง", { status: "ค่าที่อนุญาต: confirmed, rejected, cancelled" });
  let connection;
  try {
    connection = await database.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute("SELECT status FROM bookings WHERE id = ? FOR UPDATE", [bookingId]);
    if (!rows.length) { await connection.rollback(); return fail(res, 404, "BOOKING_NOT_FOUND", "ไม่พบรายการจอง"); }
    const allowed = { pending: ["confirmed", "rejected", "cancelled"], confirmed: ["rejected", "cancelled"] }[rows[0].status] || [];
    if (!allowed.includes(status)) { await connection.rollback(); return fail(res, 409, "INVALID_STATUS_CHANGE", "เปลี่ยนสถานะรายการนี้ไม่ได้"); }
    const now = nowSeconds();
    await connection.execute("UPDATE bookings SET status = ?, cancelled_at = ?, updated_at = ? WHERE id = ?", [status, status === "cancelled" ? now : null, now, bookingId]);
    await connection.commit();
    audit("admin.booking_status", { adminId: req.user.userId, bookingId, from: rows[0].status, to: status });
    res.json({ data: { id: bookingId, status, cancelledAt: status === "cancelled" ? now.toISOString() : null } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (error.code === "ER_DUP_ENTRY") return fail(res, 409, "BOOTH_UNAVAILABLE", "แผงนี้มีการจองอื่นที่ยังใช้งานอยู่");
    serverError(res, "Admin booking status", error, "ไม่สามารถเปลี่ยนสถานะการจองได้");
  } finally { connection?.release(); }
});

app.get(`${API}/admin/shops`, ...adminOnly, validatePage, async (req, res) => {
  const query = readQuery(req, res, { q: 100, status: ["active", "disabled"], categoryId: "id" });
  if (!query) return;
  try {
    let where = "WHERE 1 = 1";
    const params = [];
    if (query.q) { where += " AND (s.shop_name LIKE ? OR u.email LIKE ? OR c.name LIKE ? OR s.contact_phone LIKE ?)"; params.push(...Array(4).fill(likePattern(query.q))); }
    if (query.status) { where += " AND u.is_active = ?"; params.push(query.status === "active" ? 1 : 0); }
    if (query.categoryId) { where += " AND s.category_id = ?"; params.push(query.categoryId); }
    const from = "FROM shops s JOIN users u ON u.id = s.user_id LEFT JOIN categories c ON c.id = s.category_id";
    const [[{ total }]] = await database.execute(`SELECT COUNT(*) AS total ${from} ${where}`, params);
    const [rows] = await database.execute(`SELECT s.id, s.shop_name AS shopName, c.name AS category, s.contact_name AS contactName, s.contact_phone AS contactPhone, s.image_url AS imageUrl, s.created_at AS createdAt, u.id AS userId, u.email, u.phone, u.role, u.is_active AS isActive, (SELECT COUNT(*) FROM bookings x JOIN market_events xe ON xe.id = x.event_id WHERE x.shop_id = s.id AND x.status = 'confirmed' AND xe.event_date >= ?) AS upcomingBookings, (SELECT COUNT(*) FROM bookings x WHERE x.shop_id = s.id) AS totalBookings, (SELECT COUNT(DISTINCT xe.market_id) FROM bookings x JOIN market_events xe ON xe.id = x.event_id WHERE x.shop_id = s.id AND x.status = 'confirmed') AS marketCount ${from} ${where} ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`, [todayInMarket(), ...params, req.paging.limit, req.paging.offset]);
    sendList(res, rows.map(row => ({ ...row, isActive: Boolean(row.isActive) })), req.paging, total);
  } catch (error) { serverError(res, "Admin shops", error, "ไม่สามารถโหลดรายชื่อร้านได้"); }
});

app.patch(`${API}/admin/shops/:shopId`, ...adminOnly, async (req, res) => {
  const shopId = toId(req.params.shopId);
  if (!shopId) return fail(res, 400, "INVALID_ID", "รหัสร้านไม่ถูกต้อง");
  if (!isPlainObject(req.body) || typeof req.body.isActive !== "boolean" || Object.keys(req.body).length !== 1) return fail(res, 400, "VALIDATION_ERROR", "ส่งได้เฉพาะ isActive (true/false)", { isActive: "ต้องเป็น true หรือ false" });
  try {
    const [shops] = await database.execute("SELECT user_id AS userId FROM shops WHERE id = ?", [shopId]);
    if (!shops.length) return fail(res, 404, "SHOP_NOT_FOUND", "ไม่พบร้านนี้");
    if (shops[0].userId === req.user.userId) return fail(res, 422, "CANNOT_DISABLE_SELF", "ปิดใช้งานบัญชีของตัวเองไม่ได้");
    await database.execute("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?", [req.body.isActive ? 1 : 0, nowSeconds(), shops[0].userId]);
    if (!req.body.isActive) await database.execute("DELETE FROM sessions WHERE user_id = ?", [shops[0].userId]);
    audit("admin.shop_status", { adminId: req.user.userId, shopId, isActive: req.body.isActive });
    res.json({ data: { id: shopId, isActive: req.body.isActive } });
  } catch (error) { serverError(res, "Admin shop status", error, "ไม่สามารถเปลี่ยนสถานะร้านได้"); }
});

app.get(`${API}/admin/audit`, ...adminOnly, validatePage, async (req, res) => {
  const query = readQuery(req, res, { group: ["auth", "booking", "shop", "admin"], fromDate: "date", toDate: "date" });
  if (!query) return;
  try {
    // Dates are Thai calendar days; created_at is stored in UTC.
    const where = "WHERE (? IS NULL OR a.action LIKE ?) AND (? IS NULL OR a.created_at >= ?) AND (? IS NULL OR a.created_at < ?)";
    const fromUtc = query.fromDate ? new Date(`${query.fromDate}T00:00:00+07:00`) : null;
    const toUtc = query.toDate ? new Date(`${addDays(query.toDate, 1)}T00:00:00+07:00`) : null;
    const params = [query.group, query.group ? `${query.group}.%` : null, fromUtc, fromUtc, toUtc, toUtc];
    const [[{ total }]] = await database.execute(`SELECT COUNT(*) AS total FROM audit_logs a ${where}`, params);
    const [rows] = await database.execute(`SELECT a.id, a.action, a.details, a.created_at AS createdAt, u.id AS actorId, u.email AS actorEmail, u.role AS actorRole FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`, [...params, req.paging.limit, req.paging.offset]);
    sendList(res, rows.map(row => {
      let details = {};
      try { details = typeof row.details === "string" ? JSON.parse(row.details) : row.details || {}; } catch { /* keep an empty object for a damaged row */ }
      return { id: row.id, action: row.action, details, createdAt: row.createdAt, actor: row.actorId ? { id: row.actorId, email: row.actorEmail, role: row.actorRole } : null };
    }), req.paging, total);
  } catch (error) { serverError(res, "Admin audit", error, "ไม่สามารถโหลดประวัติการทำงานได้"); }
});

app.use("/api", (req, res) => fail(res, 404, "NOT_FOUND", "ไม่พบ endpoint ที่เรียก"));
app.use((req, res) => res.status(404).type("html").send('<!doctype html><meta charset="utf-8"><title>ไม่พบหน้า</title><p>ไม่พบหน้าที่ต้องการ <a href="/">กลับหน้าแรกตากหลาดนัด</a></p>'));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === "entity.too.large") return fail(res, 413, "PAYLOAD_TOO_LARGE", "ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป");
  if (error.type === "entity.parse.failed") return fail(res, 400, "VALIDATION_ERROR", "รูปแบบ JSON ไม่ถูกต้อง");
  serverError(res, "Request", error, "เกิดข้อผิดพลาดภายในระบบ");
});

setInterval(() => {
  const now = Date.now();
  database.execute("DELETE FROM sessions WHERE expires_at <= ?", [new Date(now)]).catch(error => console.error("Session cleanup failed:", error?.code || "unknown"));
  for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
}, 10 * 60 * 1000).unref();

// Schema and seed data are applied separately through the database UI (migration.sql).
fs.mkdirSync(SHOP_IMAGE_DIR, { recursive: true });
app.listen(port, () => console.log(`Server is listening on port ${port}`));
