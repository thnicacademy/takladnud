const TIME_ZONE = "Asia/Bangkok";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^\+?\d{9,15}$/;
const ZOOM_STEPS = [1, 1.5, 2, 2.5];
const PLACEHOLDER_IMAGE = "/images/shop-placeholder.svg";
const BOOKING_STATUS = {
  pending: { label: "รอตรวจสอบ", icon: "⏳", tone: "pending" },
  confirmed: { label: "จองสำเร็จ", icon: "✓", tone: "success" },
  cancelled: { label: "ยกเลิกแล้ว", icon: "✕", tone: "muted" },
  rejected: { label: "ไม่อนุมัติ", icon: "!", tone: "danger" }
};
const BOOTH_STATUS = {
  available: { label: "ว่าง", icon: "✓" },
  booked: { label: "ไม่ว่าง", icon: "●" },
  occupied: { label: "มีร้านค้า", icon: "●" },
  maintenance: { label: "ปิดปรับปรุง", icon: "✕" },
  unavailable: { label: "ไม่เปิดให้จอง", icon: "✕" }
};
const EVENT_STATUS = {
  scheduled: { label: "ตามกำหนด · รับจอง", tone: "info" },
  open: { label: "เปิดขาย · รับจอง", tone: "success" },
  closed: { label: "ปิดรับจอง", tone: "muted" },
  cancelled: { label: "งดตลาด", tone: "danger" }
};
const ADMIN_TABS = { overview: "ภาพรวมตลาด", events: "รอบตลาด", booths: "แผงและผัง", bookings: "การจองทั้งหมด", shops: "ร้านค้า", market: "ข้อมูลตลาด" };

const state = {
  user: null,
  shop: null,
  markets: [],
  market: null,
  customer: { eventId: null, map: null, shops: [], view: "map", loaded: false, requestId: 0 },
  booths: { marketId: null, eventId: null, events: [], items: [], view: "list" },
  bookings: { page: 1, time: "upcoming", status: "", order: "asc" },
  admin: { market: null, eventsFilter: "upcoming", booths: [], selectedBoothId: null, draft: null, bookings: { eventId: "", status: "", q: "", page: 1 }, shops: { q: "", status: "", page: 1 } },
  zoom: { customer: 0, booth: 0, admin: 0 },
  loginNotice: "",
  marketScroll: 0,
  firstRoute: true,
  expiredNotified: false,
  toastTimer: null,
  searchTimer: null
};
const initialParams = new URLSearchParams(location.search);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = "") => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const toPositiveInt = value => (/^[1-9]\d*$/.test(String(value ?? "")) ? Number(value) : null);
const normalizePhone = value => String(value || "").trim().replace(/[\s-]/g, "");
const isAdmin = () => state.user?.role === "admin";

// ---------- API ----------
async function api(url, options = {}) {
  const init = { method: options.method || "GET", headers: { Accept: "application/json" }, credentials: "same-origin" };
  if (options.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  let response;
  try { response = await fetch(url, init); }
  catch { throw Object.assign(new Error("เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"), { status: 0, fields: {} }); }
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
    error.code = payload?.error?.code;
    error.status = response.status;
    error.fields = payload?.error?.fields || {};
    if (response.status === 401 && state.user && !options.quiet401) handleExpiredSession();
    throw error;
  }
  return payload;
}

async function loadSession() {
  try {
    const { data } = await api("/api/v1/auth/me", { quiet401: true });
    state.user = data.user;
    state.shop = data.shop;
  } catch {
    state.user = null;
    state.shop = null;
  }
}

function handleExpiredSession() {
  state.user = null;
  state.shop = null;
  if (state.expiredNotified) return;
  state.expiredNotified = true;
  state.loginNotice = "หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่อีกครั้ง";
  const { path, params } = currentRoute();
  setTimeout(() => go(`/login?next=${encodeURIComponent(path + (params.toString() ? `?${params}` : ""))}`), 0);
}

// ---------- Formatting ----------
const dateFormatter = new Intl.DateTimeFormat("th-TH", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDateFormatter = new Intl.DateTimeFormat("th-TH", { timeZone: TIME_ZONE, day: "numeric", month: "short", year: "2-digit" });
const dateTimeFormatter = new Intl.DateTimeFormat("th-TH", { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
function todayISO(offsetDays = 0) { return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(Date.now() + offsetDays * 86400000)); }
function dateFromISO(value) { return new Date(`${value}T12:00:00+07:00`); }
function addDaysISO(value, days) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function formatDate(value) { return value ? dateFormatter.format(dateFromISO(value)) : "-"; }
function formatShortDate(value) { return value ? shortDateFormatter.format(dateFromISO(value)) : "-"; }
function formatDateTime(value) { return value ? `${dateTimeFormatter.format(new Date(value))} น.` : "-"; }
function formatTimeRange(open, close) {
  const start = open ? open.slice(0, 5) : "";
  const end = close ? close.slice(0, 5) : "";
  if (start && end) return `${start}–${end} น.`;
  return start ? `เปิด ${start} น.` : "ไม่ระบุเวลา";
}
function formatMoney(value) { return `${Number(value || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`; }
function formatSize(width, depth) { return width && depth ? `${Number(width)} × ${Number(depth)} เมตร` : "ไม่ระบุขนาด"; }
function positionText(booth) {
  const zone = /^[A-Za-z]/.test(booth.boothCode || "") ? `โซน ${booth.boothCode[0].toUpperCase()} · ` : "";
  if (booth.mapX == null || booth.mapY == null) return `${zone}ไม่ระบุตำแหน่ง`;
  const side = booth.mapX < 45 ? "ฝั่งซ้าย" : booth.mapX > 55 ? "ฝั่งขวา" : "กลางตลาด";
  const row = booth.mapY < 50 ? "แถวด้านใน" : "แถวใกล้ทางเข้า";
  return `${zone}${side} ${row}`;
}
function eventLabel(event) {
  const past = event.eventDate < todayISO() ? " (ผ่านไปแล้ว)" : "";
  return `${formatDate(event.eventDate)} · ${event.eventName}${past}`;
}

// ---------- UI helpers ----------
function notify(message, tone = "info") {
  const toast = $("#toast");
  const icon = { success: "✓", error: "!", info: "ℹ" }[tone] || "ℹ";
  toast.className = `toast toast-${tone} is-visible`;
  toast.innerHTML = `<span class="toast-icon" aria-hidden="true">${icon}</span><span>${escapeHtml(message)}</span>`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 4500);
}
function stateBox(kind, message, extra = "", art = "") {
  const icon = { loading: "", empty: "○", error: "!" }[kind] ?? "○";
  const visual = art ? `<img class="state-art" src="/images/${art}.svg" alt="" width="200" height="160">` : `<span class="state-icon" aria-hidden="true">${icon}</span>`;
  return `<div class="state-box state-${kind}" ${kind === "error" ? 'role="alert"' : ""}>${visual}<p>${escapeHtml(message)}</p>${extra}</div>`;
}
const retryButton = '<button type="button" class="button button-outline" data-retry>ลองอีกครั้ง</button>';
function bookingBadge(status) {
  const info = BOOKING_STATUS[status] || { label: status, icon: "•", tone: "muted" };
  return `<span class="badge badge-${info.tone}"><span aria-hidden="true">${info.icon}</span> ${escapeHtml(info.label)}</span>`;
}
function boothBadge(availability) {
  const info = BOOTH_STATUS[availability] || BOOTH_STATUS.unavailable;
  return `<span class="badge badge-booth is-${escapeHtml(availability)}"><span aria-hidden="true">${info.icon}</span> ${info.label}</span>`;
}
function eventBadge(status) {
  const info = EVENT_STATUS[status] || { label: status, tone: "muted" };
  return `<span class="badge badge-${info.tone}">${escapeHtml(info.label)}</span>`;
}
function shopImage(url) { return url || PLACEHOLDER_IMAGE; }
function setFormErrors(form, fields = {}) {
  $$("[data-error-for]", form).forEach(element => {
    const message = fields[element.dataset.errorFor] || "";
    element.textContent = message;
    const input = form.elements.namedItem(element.dataset.errorFor);
    if (input && message) input.setAttribute("aria-invalid", "true");
    else if (input) input.removeAttribute("aria-invalid");
  });
  const first = Object.keys(fields).map(name => form.elements.namedItem(name)).find(Boolean);
  if (first) first.focus();
}
function setAlert(element, message, tone = "error") {
  element.hidden = !message;
  element.className = `form-alert form-alert-${tone}`;
  element.textContent = message || "";
}
function setBusy(button, busy, busyText) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}
function detailRow(label, value) { return `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`; }
function field(name, label, input, hint = "") {
  const id = `f-${name}-${Math.random().toString(36).slice(2, 7)}`;
  return `<div class="field"><label for="${id}">${escapeHtml(label)}</label>${input.replace("<input", `<input id="${id}" name="${name}"`).replace("<select", `<select id="${id}" name="${name}"`).replace("<textarea", `<textarea id="${id}" name="${name}"`)}${hint ? `<p class="hint">${escapeHtml(hint)}</p>` : ""}<p class="field-error" data-error-for="${name}"></p></div>`;
}
function pagerHtml(page, totalPages) {
  if (totalPages <= 1) return "";
  return `<button type="button" class="button button-outline" data-page-to="${page - 1}" ${page <= 1 ? "disabled" : ""}><span aria-hidden="true">←</span> ก่อนหน้า</button><span>หน้า ${page} จาก ${totalPages}</span><button type="button" class="button button-outline" data-page-to="${page + 1}" ${page >= totalPages ? "disabled" : ""}>ถัดไป <span aria-hidden="true">→</span></button>`;
}

function confirmDialog({ title, body, okText = "ยืนยัน", cancelText = "ยกเลิก", danger = false }) {
  const dialog = $("#confirm-dialog");
  $("#confirm-dialog-title").textContent = title;
  $("#confirm-dialog-body").innerHTML = body;
  $("#confirm-dialog-ok").textContent = okText;
  $("#confirm-dialog-ok").className = `button ${danger ? "button-danger" : "button-primary"}`;
  $("#confirm-dialog-cancel").textContent = cancelText;
  dialog.returnValue = "";
  return new Promise(resolve => {
    dialog.addEventListener("close", () => resolve({ ok: dialog.returnValue === "ok", form: $("#confirm-dialog-form") }), { once: true });
    dialog.showModal();
    $("#confirm-dialog-cancel").focus();
  });
}

function drawQr(box, url, title) {
  if (typeof window.qrcode !== "function") { box.innerHTML = '<p class="hint">สร้างภาพ QR ไม่ได้ในขณะนี้ ใช้ลิงก์แทน</p>'; return; }
  const qr = window.qrcode(0, "M");
  qr.addData(url);
  qr.make();
  box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true, title });
}

// ---------- Map ----------
function pinPosition(booth, index) {
  return {
    x: Math.max(5, Math.min(95, Number(booth.mapX ?? 12 + (index % 6) * 15))),
    y: Math.max(7, Math.min(93, Number(booth.mapY ?? 15 + Math.floor(index / 6) * 18)))
  };
}
// mode: "customer" (public map), "booth" (shop picks an available booth) or "admin" (every booth is editable).
function renderMap(canvas, booths, { mode, matchIds = null, highlightIds = null, planOrder = null, route = null, selectedId = null, interactive = true }) {
  canvas.dataset.mode = mode;
  if (!booths.length) { canvas.innerHTML = stateBox("empty", "ยังไม่มีข้อมูลแผงในตลาดนี้"); return; }
  const decor = '<span class="map-walkway map-walkway-h" aria-hidden="true"><span>ทางเดิน</span></span><span class="map-walkway map-walkway-v" aria-hidden="true"></span><span class="map-entrance" aria-hidden="true">⬇ ทางเข้าตลาด</span>';
  const routeSvg = route && route.length ? `<svg class="map-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${[{ x: 50, y: 97 }, ...route].map(point => `${point.x},${point.y}`).join(" ")}"/></svg>` : "";
  canvas.innerHTML = decor + routeSvg + booths.map((booth, index) => {
    const { x, y } = pinPosition(booth, index);
    const status = booth.availability || "unavailable";
    const shop = booth.shop;
    const classes = ["booth-pin", `is-${status}`];
    if (matchIds) classes.push(matchIds.has(booth.id) ? "is-match" : "is-dimmed");
    if (highlightIds) classes.push(highlightIds.has(booth.id) ? "is-highlight" : "is-dimmed");
    if (selectedId != null && booth.id === selectedId) classes.push("is-selected");
    const order = planOrder?.get(booth.id);
    let caption;
    let label;
    if (mode === "customer") {
      caption = shop ? shop.shopName : status === "available" ? "แผงว่าง" : BOOTH_STATUS[status]?.label || "";
      label = shop ? `แผง ${booth.boothCode}: ${shop.shopName}${shop.category ? ` (${shop.category})` : ""}${order ? ` ลำดับเดินที่ ${order}` : ""}` : `แผง ${booth.boothCode}: ${caption}`;
    } else if (mode === "admin") {
      caption = `${BOOTH_STATUS[status]?.label || ""} · ${Number(booth.price)}฿`;
      label = `แผง ${booth.boothCode}: ${caption} — แตะเพื่อแก้ไข`;
    } else {
      caption = `${BOOTH_STATUS[status]?.icon || ""} ${BOOTH_STATUS[status]?.label || ""}${status === "available" ? ` · ${Number(booth.price)}฿` : ""}`;
      label = `แผง ${booth.boothCode}: ${BOOTH_STATUS[status]?.label || ""}${status === "available" ? ` ค่าเช่า ${formatMoney(booth.price)}` : ""}`;
    }
    const inner = `${order ? `<span class="plan-badge" aria-hidden="true">${order}</span>` : ""}<strong>${escapeHtml(booth.boothCode)}</strong><small>${escapeHtml(caption)}</small>`;
    const style = `left:${x}%;top:${y}%`;
    if (!interactive) return `<span class="${classes.join(" ")}" style="${style}" role="img" aria-label="${escapeHtml(label)}">${inner}</span>`;
    const disabled = mode === "booth" && status !== "available" ? "disabled" : "";
    return `<button type="button" class="${classes.join(" ")}" style="${style}" data-booth-id="${Number(booth.id)}" ${shop ? `data-shop-id="${Number(shop.id)}"` : ""} aria-label="${escapeHtml(label)}" ${disabled}>${inner}</button>`;
  }).join("");
}
function applyZoom(name, step) {
  const canvas = { customer: $("#customer-map"), booth: $("#booth-map"), admin: $("#admin-map") }[name];
  if (!canvas) return;
  const viewport = canvas.parentElement;
  const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / (viewport.scrollWidth || 1);
  const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / (viewport.scrollHeight || 1);
  state.zoom[name] = step;
  const level = ZOOM_STEPS[step];
  canvas.style.setProperty("--zoom", level);
  const controls = $(`[data-zoom-for="${name}"]`);
  if (controls) {
    $(".zoom-level", controls).textContent = `${Math.round(level * 100)}%`;
    $('[data-zoom="-1"]', controls).disabled = step === 0;
    $('[data-zoom="1"]', controls).disabled = step === ZOOM_STEPS.length - 1;
  }
  viewport.scrollLeft = centerX * viewport.scrollWidth - viewport.clientWidth / 2;
  viewport.scrollTop = centerY * viewport.scrollHeight - viewport.clientHeight / 2;
}
function zoomControls(name) {
  return `<div class="zoom-controls" data-zoom-for="${name}"><button type="button" class="button button-small button-outline" data-zoom="-1" aria-label="ย่อแผนผัง">− ย่อ</button><span class="zoom-level" aria-live="polite">100%</span><button type="button" class="button button-small button-outline" data-zoom="1" aria-label="ขยายแผนผัง">+ ขยาย</button><button type="button" class="button button-small button-text" data-zoom="0">พอดีจอ</button></div>`;
}

// ---------- Visit plan (customer, stored only in this browser) ----------
function planKey() { return `tln-plan-${state.market?.id || 0}`; }
function readPlan() {
  try {
    const items = JSON.parse(localStorage.getItem(planKey()) || "[]");
    return Array.isArray(items) ? items.filter(item => item && Number.isInteger(item.id)) : [];
  } catch { return []; }
}
function writePlan(items) {
  try { localStorage.setItem(planKey(), JSON.stringify(items)); }
  catch { notify("บันทึกแผนในเครื่องนี้ไม่ได้ (เบราว์เซอร์ปิดการเก็บข้อมูล)", "error"); }
}
function isPlanned(shopId) { return readPlan().some(item => item.id === shopId); }
function togglePlan(shopId, shopName) {
  const items = readPlan();
  const index = items.findIndex(item => item.id === shopId);
  if (index >= 0) { items.splice(index, 1); notify(`นำ ${shopName} ออกจากแผนแล้ว`); }
  else { items.push({ id: shopId, shopName }); notify(`เพิ่ม ${shopName} ในร้านที่อยากแวะแล้ว`, "success"); }
  writePlan(items);
}
function planToggleButton(shopId, shopName) {
  const planned = isPlanned(shopId);
  return `<button type="button" class="plan-toggle" data-plan-shop="${Number(shopId)}" data-plan-name="${escapeHtml(shopName)}" aria-pressed="${planned}" aria-label="${planned ? "นำออกจาก" : "เพิ่มใน"}ร้านที่อยากแวะ: ${escapeHtml(shopName)}"><span aria-hidden="true">${planned ? "★" : "☆"}</span> ${planned ? "อยู่ในแผน" : "อยากแวะ"}</button>`;
}
// Orders planned shops by walking distance: nearest-neighbour from the entrance (bottom centre of the map).
function planStops() {
  const booths = state.customer.map?.booths || [];
  const byShop = new Map();
  booths.forEach((booth, index) => { if (booth.shop && !byShop.has(booth.shop.id)) byShop.set(booth.shop.id, { booth, position: pinPosition(booth, index) }); });
  const items = readPlan();
  const remaining = items.filter(item => byShop.has(item.id)).map(item => ({ ...item, ...byShop.get(item.id), shopName: byShop.get(item.id).booth.shop.shopName }));
  const absent = items.filter(item => !byShop.has(item.id));
  const ordered = [];
  let current = { x: 50, y: 100 };
  while (remaining.length) {
    let best = 0;
    let bestDistance = Infinity;
    remaining.forEach((stop, index) => {
      const dx = (stop.position.x - current.x) * 1.6;
      const dy = stop.position.y - current.y;
      if (dx * dx + dy * dy < bestDistance) { bestDistance = dx * dx + dy * dy; best = index; }
    });
    const [stop] = remaining.splice(best, 1);
    ordered.push(stop);
    current = stop.position;
  }
  return { ordered, absent };
}
function renderPlan() {
  const { ordered, absent } = planStops();
  $("#plan-count").textContent = String(ordered.length + absent.length);
  $("#plan-clear").hidden = !(ordered.length + absent.length);
  const eventQuery = state.customer.eventId ? `?event=${state.customer.eventId}` : "";
  $("#plan-list").innerHTML = ordered.length + absent.length
    ? ordered.map((stop, index) => `<li><span class="plan-step" aria-hidden="true">${index + 1}</span><a href="#/store/${stop.id}${eventQuery}"><strong>แผง ${escapeHtml(stop.booth.boothCode)}</strong> · ${escapeHtml(stop.shopName)}</a><button type="button" class="button button-small button-text" data-plan-shop="${stop.id}" data-plan-name="${escapeHtml(stop.shopName)}">นำออก</button></li>`).join("")
      + absent.map(item => `<li class="is-absent"><span class="plan-step" aria-hidden="true">–</span><span>${escapeHtml(item.shopName)} — ไม่ได้มาขายในรอบนี้</span><button type="button" class="button button-small button-text" data-plan-shop="${item.id}" data-plan-name="${escapeHtml(item.shopName)}">นำออก</button></li>`).join("")
    : '<li class="plan-empty">ยังไม่มีร้านในแผน กด “☆ อยากแวะ” ที่รายชื่อร้านหรือหน้าร้านเพื่อเพิ่ม</li>';
  return ordered;
}

// ---------- Router ----------
const routes = [
  { pattern: /^\/$/, page: "market", title: "แผนผังตลาด", render: renderMarketPage },
  { pattern: /^\/store\/(\d+)$/, page: "store", title: "รายละเอียดร้านค้า", render: renderStorePage },
  { pattern: /^\/login$/, page: "login", title: "เข้าสู่ระบบร้านค้า", render: renderLoginPage, guest: true },
  { pattern: /^\/register$/, page: "register", title: "สมัครสมาชิกร้านค้า", render: renderRegisterPage, guest: true },
  { pattern: /^\/dashboard$/, page: "dashboard", title: "หน้าหลักร้านค้า", render: renderDashboard, shop: true },
  { pattern: /^\/booths$/, page: "booths", title: "เลือกแผง", render: renderBoothsPage, shop: true },
  { pattern: /^\/confirm$/, page: "confirm", title: "ยืนยันการจอง", render: renderConfirmPage, shop: true },
  { pattern: /^\/bookings$/, page: "bookings", title: "การจองของฉัน", render: renderBookingsPage, shop: true },
  { pattern: /^\/bookings\/(\d+)$/, page: "booking", title: "รายละเอียดการจอง", render: renderBookingPage, shop: true },
  { pattern: /^\/profile$/, page: "profile", title: "ข้อมูลร้าน", render: renderProfilePage, shop: true },
  { pattern: /^\/admin(?:\/(events|booths|bookings|shops|market))?$/, page: "admin", title: "ผู้ดูแลตลาด", render: renderAdminPage, admin: true }
];
function currentRoute() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, search = ""] = raw.split("?");
  return { path: path || "/", params: new URLSearchParams(search) };
}
function go(path) {
  if (location.hash === `#${path}`) route();
  else location.hash = `#${path}`;
}
function homePath() { return state.shop ? "/dashboard" : isAdmin() ? "/admin" : "/"; }
function safeNext(value) { return value && value.startsWith("/") && !value.startsWith("//") ? value : homePath(); }

async function route() {
  const { path, params } = currentRoute();
  closeMenu();
  let match = null;
  const found = routes.find(item => (match = item.pattern.exec(path)));
  if ((found?.shop || found?.admin) && !state.user) {
    state.loginNotice = state.loginNotice || "กรุณาเข้าสู่ระบบก่อนใช้งานส่วนนี้";
    return go(`/login?next=${encodeURIComponent(path + (params.toString() ? `?${params}` : ""))}`);
  }
  if (found?.guest && state.user) return go(homePath());
  if (found?.admin && !isAdmin()) { notify("หน้านี้สำหรับผู้ดูแลตลาดเท่านั้น", "error"); return go(homePath()); }
  if (found?.shop && !state.shop) { notify("บัญชีนี้ยังไม่มีร้านค้า", "error"); return go(homePath()); }
  const previous = $("[data-page]:not([hidden])")?.dataset.page;
  if (previous === "market") state.marketScroll = window.scrollY;
  const page = found ? found.page : "notfound";
  // Keep the customer's search and scroll only for the map ↔ shop detail round trip; elsewhere bookings may have changed.
  if (!["market", "store"].includes(page)) state.customer.loaded = false;
  $$("[data-page]").forEach(section => { section.hidden = section.dataset.page !== page; });
  document.title = `${found ? found.title : "ไม่พบหน้า"} | ตากหลาดนัด`;
  renderNav(path);
  window.scrollTo(0, 0);
  if (found) {
    try { await found.render(params, match[1]); }
    catch (error) { console.error(error); notify("เกิดข้อผิดพลาดในการแสดงหน้า กรุณาลองใหม่", "error"); }
  }
  if (page === "market" && previous === "store") window.scrollTo(0, state.marketScroll);
  if (!state.firstRoute) $(`[data-page="${page}"] .page-title`)?.focus({ preventScroll: page === "market" });
  state.firstRoute = false;
}

function renderNav(path) {
  const links = [["/", "แผนผังตลาด"]];
  if (state.shop) links.push(["/dashboard", "หน้าหลักร้าน"], ["/booths", "จองแผง"], ["/bookings", "การจองของฉัน"], ["/profile", "ข้อมูลร้าน"]);
  if (isAdmin()) links.push(["/admin", "ผู้ดูแลตลาด"]);
  if (!state.user) links.push(["/register", "สมัครร้านค้า"]);
  const current = href => (href === "/" ? path === "/" || path.startsWith("/store") : path === href || path.startsWith(`${href}/`) || (href === "/booths" && path === "/confirm"));
  $("#main-nav").innerHTML = links.map(([href, label]) => `<a href="#${href}" ${href === "/admin" ? 'class="nav-admin"' : ""} ${current(href) ? 'aria-current="page"' : ""}>${label}</a>`).join("")
    + (state.user
      ? `<span class="nav-shop" title="บัญชีที่เข้าสู่ระบบ"><img src="${escapeHtml(shopImage(state.shop?.imageUrl))}" alt=""><span>${escapeHtml(state.shop?.shopName || state.user.email || "")}</span></span><button type="button" class="button button-small button-outline" data-logout>ออกจากระบบ</button>`
      : `<a class="button button-small button-primary" href="#/login" ${path === "/login" ? 'aria-current="page"' : ""}>เข้าสู่ระบบร้านค้า</a>`);
  $("#shop-cta").hidden = Boolean(state.user);
}
function closeMenu() {
  $("#main-nav").classList.remove("is-open");
  $("#menu-toggle").setAttribute("aria-expanded", "false");
}

async function logout() {
  try { await api("/api/v1/auth/logout", { method: "POST", quiet401: true }); } catch { /* the session is cleared locally either way */ }
  state.user = null;
  state.shop = null;
  state.bookings.page = 1;
  notify("ออกจากระบบเรียบร้อยแล้ว", "success");
  go("/");
}

// ---------- Market data ----------
async function ensureMarket() {
  if (state.market) return state.market;
  let marketId = toPositiveInt(initialParams.get("market"));
  if (!marketId) {
    const { data } = await api("/api/v1/markets?limit=1");
    if (!data.length) throw Object.assign(new Error("ยังไม่มีข้อมูลตลาดในระบบ"), { status: 404 });
    marketId = data[0].id;
  }
  const { data } = await api(`/api/v1/markets/${marketId}`);
  state.market = data;
  return data;
}

// ---------- Customer: market map ----------
async function renderMarketPage() {
  if (state.customer.loaded) { renderCustomerResults(); return; }
  $("#customer-map").innerHTML = stateBox("loading", "กำลังโหลดแผนผังตลาด...");
  $("#shop-list").innerHTML = stateBox("loading", "กำลังโหลดรายชื่อร้าน...");
  try {
    const market = await ensureMarket();
    fillMarketInfo(market);
    await loadCustomerMap(toPositiveInt(initialParams.get("event")));
    state.customer.loaded = true;
  } catch (error) {
    const message = error.status === 404 || error.status === 400 ? "ไม่พบตลาดจากลิงก์นี้ กรุณาสแกน QR Code อีกครั้ง หรือกลับไปหน้าแรก" : error.message;
    $("#market-name").textContent = "ไม่สามารถโหลดข้อมูลตลาดได้";
    $("#customer-map").innerHTML = stateBox("error", message, retryButton);
    $("#shop-list").innerHTML = "";
    $("#customer-summary").textContent = "";
  }
}
function fillMarketInfo(market) {
  $("#market-name").textContent = market.marketName;
  $("#market-description").textContent = market.description || "ดูตำแหน่งร้านค้า ค้นหาสินค้าที่สนใจ และวางแผนเดินตลาดได้ตั้งแต่ก่อนออกจากบ้าน";
  $("#market-address").textContent = market.address || "ไม่ระบุสถานที่";
  $("#hero-nav-link").href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${market.marketName} ${market.address || ""}`.trim())}`;
  const today = todayISO();
  const past = market.events.filter(event => event.eventDate < today).slice(-3);
  const events = [...market.events.filter(event => event.eventDate >= today), ...past.reverse()];
  const select = $("#customer-event");
  select.disabled = !events.length;
  select.innerHTML = events.length ? events.map(event => `<option value="${event.id}">${escapeHtml(eventLabel(event))}</option>`).join("") : '<option value="">ยังไม่มีรอบตลาด</option>';
}
async function loadCustomerMap(eventId) {
  let payload;
  try { payload = await api(`/api/v1/public/markets/${state.market.id}/map${eventId ? `?eventId=${eventId}` : ""}`); }
  catch (error) {
    if (eventId && error.status === 404 && error.code === "EVENT_NOT_FOUND") {
      notify("ไม่พบรอบตลาดที่ระบุในลิงก์ จึงแสดงรอบที่ใกล้ที่สุดแทน", "error");
      return loadCustomerMap(null);
    }
    throw error;
  }
  const data = payload.data;
  state.customer.map = data;
  state.customer.eventId = data.event?.id || null;
  const select = $("#customer-event");
  if (data.event && ![...select.options].some(option => Number(option.value) === data.event.id)) select.insertAdjacentHTML("beforeend", `<option value="${data.event.id}">${escapeHtml(eventLabel(data.event))}</option>`);
  select.value = String(state.customer.eventId || "");
  $("#market-date").textContent = data.event ? formatDate(data.event.eventDate) : "ยังไม่มีรอบตลาดที่กำหนด";
  $("#market-time").textContent = formatTimeRange(data.event?.openTime || data.market.openTime, data.event?.closeTime || data.market.closeTime);
  const categorySelect = $("#category-filter");
  const selected = categorySelect.value;
  const categories = [...new Set(data.booths.map(booth => booth.shop?.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
  categorySelect.innerHTML = '<option value="">ทุกประเภท</option>' + categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
  categorySelect.value = categories.includes(selected) ? selected : "";
  renderCategoryChips(categories);
  renderMarketQr();
  await loadCustomerShops();
}
function renderCategoryChips(categories) {
  const current = $("#category-filter").value;
  $("#category-chips").innerHTML = categories.length
    ? [["", "ทั้งหมด"], ...categories.map(category => [category, category])].map(([value, label]) => `<button type="button" class="category-chip" data-category="${escapeHtml(value)}" aria-pressed="${value === current}">${escapeHtml(label)}</button>`).join("")
    : "";
}
async function loadCustomerShops() {
  const requestId = ++state.customer.requestId;
  const params = new URLSearchParams({ limit: "100", sort: "boothCode" });
  if (state.customer.eventId) params.set("eventId", state.customer.eventId);
  const query = $("#shop-search").value.trim().slice(0, 100);
  const category = $("#category-filter").value;
  if (query) params.set("q", query);
  if (category) params.set("category", category);
  $$("#category-chips [data-category]").forEach(chip => chip.setAttribute("aria-pressed", String(chip.dataset.category === category)));
  const list = $("#shop-list");
  list.setAttribute("aria-busy", "true");
  try {
    const { data } = await api(`/api/v1/public/markets/${state.market.id}/shops?${params}`);
    if (requestId !== state.customer.requestId) return;
    state.customer.shops = data;
    renderCustomerResults();
  } catch (error) {
    if (requestId !== state.customer.requestId) return;
    state.customer.loaded = false;
    list.innerHTML = stateBox("error", error.message, retryButton);
  } finally { list.removeAttribute("aria-busy"); }
}
function renderCustomerResults() {
  const map = state.customer.map;
  if (!map) return;
  const shops = state.customer.shops;
  const query = $("#shop-search").value.trim();
  const category = $("#category-filter").value;
  const filtering = Boolean(query || category);
  $("#shop-count").textContent = String(shops.length);
  let summary;
  if (!map.event) summary = "ยังไม่มีรอบตลาดที่กำหนด จึงแสดงผังแผงทั่วไป";
  else if (filtering) summary = shops.length ? `พบ ${shops.length} ร้านที่ตรงกับการค้นหา (แสดงด้วยเครื่องหมาย ★ บนแผนผัง)` : `ไม่พบร้านที่ตรงกับ${query ? ` “${query}”` : ""}${category ? ` ในประเภท “${category}”` : ""}`;
  else summary = `${formatDate(map.event.eventDate)} · มีร้านค้า ${shops.length} ร้าน จาก ${map.booths.length} แผง`;
  $("#customer-summary").textContent = summary;
  const eventQuery = state.customer.eventId ? `?event=${state.customer.eventId}` : "";
  $("#shop-list").innerHTML = shops.length
    ? shops.map((shop, index) => `<div class="shop-row"><a class="shop-row-link" href="#/store/${Number(shop.id)}${eventQuery}">${shop.imageUrl ? `<img class="shop-avatar" src="${escapeHtml(shop.imageUrl)}" alt="" width="52" height="52" loading="lazy">` : `<span class="shop-avatar tone-${index % 3}" aria-hidden="true">${escapeHtml((shop.shopName || "ร").slice(0, 1))}</span>`}<span class="shop-info"><strong>${escapeHtml(shop.shopName)}</strong><small>${escapeHtml(shop.category || "ร้านค้าทั่วไป")}</small></span><span class="booth-code">แผง ${escapeHtml(shop.boothCode)}</span></a>${planToggleButton(shop.id, shop.shopName)}</div>`).join("")
    : stateBox("empty", filtering ? "ไม่พบร้านที่ตรงกับการค้นหา ลองเปลี่ยนคำค้นหาหรือเลือก “ทุกประเภท”" : map.event ? "ยังไม่มีร้านค้ายืนยันเข้าร่วมรอบนี้" : "ยังไม่มีรอบตลาด จึงยังไม่มีรายชื่อร้าน", "", "empty-shops");
  const ordered = renderPlan();
  const planOrder = new Map(ordered.map((stop, index) => [stop.booth.id, index + 1]));
  renderMap($("#customer-map"), map.booths, { mode: "customer", matchIds: filtering ? new Set(shops.map(shop => shop.boothId)) : null, planOrder, route: $("#plan-route").checked ? ordered.map(stop => stop.position) : null });
  applyZoom("customer", state.zoom.customer);
  setCustomerView(state.customer.view);
}
function setCustomerView(view) {
  state.customer.view = view;
  $$("[data-customer-view]").forEach(button => {
    const active = button.dataset.customerView === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#customer-layout").classList.toggle("is-list-view", view === "list");
  $("#customer-layout").classList.toggle("is-map-view", view === "map");
}
function marketQrUrl() {
  const url = new URL("/", location.origin);
  if (state.market) url.searchParams.set("market", state.market.id);
  if ($("#qr-fixed-event").checked && state.customer.eventId) url.searchParams.set("event", state.customer.eventId);
  return url.toString();
}
function renderMarketQr() {
  const url = marketQrUrl();
  $("#qr-url").href = url;
  $("#qr-url").textContent = url;
  drawQr($("#qr-image"), url, "QR Code แผนผังตลาด");
}

// ---------- Customer: shop detail ----------
async function renderStorePage(params, shopId) {
  const content = $("#store-content");
  content.innerHTML = stateBox("loading", "กำลังโหลดข้อมูลร้าน...");
  const eventId = toPositiveInt(params.get("event"));
  try {
    const { data } = await api(`/api/v1/public/shops/${shopId}${eventId ? `?eventId=${eventId}` : ""}`);
    document.title = `${data.shopName} | ตากหลาดนัด`;
    const booth = data.booths[0];
    content.innerHTML = `<article class="card store-card">
        <img class="store-cover" src="${escapeHtml(shopImage(data.imageUrl))}" alt="${data.imageUrl ? `รูปร้าน ${escapeHtml(data.shopName)}` : ""}" width="800" height="350">
        <div class="store-body">
          <p class="eyebrow">ร้านค้าใน${escapeHtml(data.market.marketName)}</p>
          <h1 class="page-title" tabindex="-1">${escapeHtml(data.shopName)}</h1>
          <p><span class="chip">${escapeHtml(data.category || "ร้านค้าทั่วไป")}</span></p>
          <p class="store-description">${escapeHtml(data.description || "ร้านนี้ยังไม่ได้เพิ่มคำอธิบาย แวะชมสินค้าได้ที่แผง")}</p>
          <div class="store-actions" id="store-actions">${planToggleButton(data.id, data.shopName)}${data.socialUrl ? `<a class="button button-soft" href="${escapeHtml(data.socialUrl)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">🔗</span> ติดตามร้าน</a>` : ""}</div>
          <dl class="detail-list">
            ${detailRow("หมายเลขแผง", data.booths.map(item => `<span class="booth-code booth-code-large">${escapeHtml(item.boothCode)}</span>`).join(" "))}
            ${detailRow("ตำแหน่ง", escapeHtml(positionText(booth)))}
            ${detailRow("วันที่ขาย", escapeHtml(formatDate(data.event.eventDate)))}
            ${detailRow("เวลาเปิด–ปิดตลาด", escapeHtml(formatTimeRange(data.event.openTime, data.event.closeTime)))}
            ${detailRow("ติดต่อร้าน", data.contactPhone ? `<a class="button button-primary" href="tel:${escapeHtml(data.contactPhone)}"><span aria-hidden="true">📞</span> โทร ${escapeHtml(data.contactPhone)}</a>` : "ร้านไม่ได้ระบุเบอร์ติดต่อ")}
          </dl>
        </div>
      </article>
      <section class="card map-panel">
        <h2>ตำแหน่งบนแผนผัง</h2>
        <div class="map-viewport" id="store-map-viewport"><div class="map-canvas" id="store-map">${stateBox("loading", "กำลังโหลดแผนผัง...")}</div></div>
        <p class="hint">แผงของร้านนี้แสดงด้วยกรอบสีเข้มและเครื่องหมาย ★</p>
      </section>`;
    let map = state.customer.map;
    if (!map || map.event?.id !== data.event.id) map = (await api(`/api/v1/public/markets/${data.market.id}/map?eventId=${data.event.id}`)).data;
    renderMap($("#store-map"), map.booths, { mode: "customer", highlightIds: new Set(data.booths.map(item => item.id)), interactive: false });
    const viewport = $("#store-map-viewport");
    const pin = $(".is-highlight", viewport);
    if (pin) viewport.scrollLeft = pin.offsetLeft - viewport.clientWidth / 2;
  } catch (error) {
    const notFound = error.status === 404;
    content.innerHTML = `<h1 class="page-title" tabindex="-1">${notFound ? "ไม่พบข้อมูลร้าน" : "โหลดข้อมูลร้านไม่สำเร็จ"}</h1>`
      + stateBox(notFound ? "empty" : "error", error.message, `<div class="button-row">${notFound ? "" : retryButton}<a class="button button-primary" href="#/">กลับไปแผนผังตลาด</a></div>`, notFound ? "empty-shops" : "");
  }
}

// ---------- Shop: login and register ----------
function renderLoginPage() {
  setFormErrors($("#login-form"), {});
  setAlert($("#login-alert"), state.loginNotice, "info");
  state.loginNotice = "";
}
function renderRegisterPage() {
  setFormErrors($("#register-form"), {});
  setAlert($("#register-alert"), "");
}
async function submitLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("button[type='submit']", form);
  if (button.disabled) return;
  const body = { login: form.elements.login.value.trim(), password: form.elements.password.value };
  const fields = {};
  if (!EMAIL_PATTERN.test(body.login)) fields.login = "กรุณากรอกอีเมลให้ถูกต้อง เช่น name@example.com";
  if (!body.password) fields.password = "กรุณากรอกรหัสผ่าน";
  setAlert($("#login-alert"), "");
  setFormErrors(form, fields);
  if (Object.keys(fields).length) return;
  setBusy(button, true, "กำลังเข้าสู่ระบบ...");
  try {
    await api("/api/v1/auth/login", { method: "POST", body });
    await loadSession();
    state.expiredNotified = false;
    form.reset();
    notify(`เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ ${state.shop?.shopName || ""}`, "success");
    go(safeNext(currentRoute().params.get("next")));
  } catch (error) {
    setFormErrors(form, error.fields);
    setAlert($("#login-alert"), error.message);
  } finally { setBusy(button, false); }
}
async function submitRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("button[type='submit']", form);
  if (button.disabled) return;
  const value = name => form.elements[name].value.trim();
  const body = { email: value("email"), password: form.elements.password.value, shopName: value("shopName") };
  if (value("phone")) body.phone = normalizePhone(value("phone"));
  if (value("category")) body.category = value("category");
  if (value("contactPhone")) body.contactPhone = normalizePhone(value("contactPhone"));
  const fields = {};
  if (!EMAIL_PATTERN.test(body.email)) fields.email = "กรุณากรอกอีเมลให้ถูกต้อง เช่น name@example.com";
  if (body.phone && !PHONE_PATTERN.test(body.phone)) fields.phone = "เบอร์โทรศัพท์ต้องเป็นตัวเลข 9–15 หลัก";
  if (!body.shopName) fields.shopName = "กรุณากรอกชื่อร้าน";
  if (body.contactPhone && !PHONE_PATTERN.test(body.contactPhone)) fields.contactPhone = "เบอร์ติดต่อร้านต้องเป็นตัวเลข 9–15 หลัก";
  if (body.password.length < 8) fields.password = "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร";
  if (form.elements.passwordConfirm.value !== body.password) fields.passwordConfirm = "รหัสผ่านทั้งสองช่องไม่ตรงกัน";
  setAlert($("#register-alert"), "");
  setFormErrors(form, fields);
  if (Object.keys(fields).length) return;
  setBusy(button, true, "กำลังสร้างบัญชี...");
  try {
    await api("/api/v1/auth/register", { method: "POST", body });
    await loadSession();
    state.expiredNotified = false;
    form.reset();
    notify("สมัครสมาชิกสำเร็จ ยินดีต้อนรับสู่ตากหลาดนัด", "success");
    go("/dashboard");
  } catch (error) {
    setFormErrors(form, error.fields);
    setAlert($("#register-alert"), error.message);
  } finally { setBusy(button, false); }
}

// ---------- Shop: home ----------
function bookingCard(booking) {
  return `<a class="card booking-card" href="#/bookings/${Number(booking.id)}">
      <span class="booking-date" aria-hidden="true">${escapeHtml(formatShortDate(booking.event.eventDate))}</span>
      <span class="booking-info"><strong>แผง ${escapeHtml(booking.booth.boothCode)} · ${escapeHtml(booking.event.eventName)}</strong><span>${escapeHtml(formatDate(booking.event.eventDate))} · ${escapeHtml(formatTimeRange(booking.event.openTime, booking.event.closeTime))}</span><span class="muted">${escapeHtml(booking.market.marketName)} · ค่าเช่า ${escapeHtml(formatMoney(booking.price))}</span></span>
      <span class="booking-side">${bookingBadge(booking.status)}<span class="link-text">ดูรายละเอียด <span aria-hidden="true">→</span></span></span>
    </a>`;
}
async function renderDashboard() {
  $("#dash-greeting").textContent = `สวัสดี ${state.shop?.shopName || ""}`;
  $("#dash-photo").src = shopImage(state.shop?.imageUrl);
  $("#dash-status").innerHTML = stateBox("loading", "กำลังโหลดสรุปการจอง...");
  $("#dash-next").innerHTML = "";
  $("#dash-rebook").innerHTML = "";
  try {
    const market = await ensureMarket().catch(() => null);
    $("#dash-market").textContent = market ? `${market.marketName} · ${market.address || ""}` : "";
    const today = todayISO();
    const [upcoming, all, cancelled, pending, latest] = await Promise.all([
      api(`/api/v1/bookings?status=confirmed&fromDate=${today}&sort=eventDate&order=asc&limit=3`),
      api("/api/v1/bookings?limit=1"),
      api("/api/v1/bookings?status=cancelled&limit=1"),
      api(`/api/v1/bookings?status=pending&fromDate=${today}&limit=1`),
      api("/api/v1/bookings?sort=bookedAt&order=desc&limit=1")
    ]);
    const upcomingTotal = upcoming.pagination.total;
    let headline;
    if (!all.pagination.total) headline = '<span class="badge badge-muted"><span aria-hidden="true">○</span> ยังไม่มีการจอง</span>';
    else if (upcomingTotal) headline = `${bookingBadge("confirmed")} มีแผงพร้อมขาย ${upcomingTotal} รอบ`;
    else if (pending.pagination.total) headline = `${bookingBadge("pending")} มีรายการรอตรวจสอบ`;
    else headline = '<span class="badge badge-muted"><span aria-hidden="true">○</span> ยังไม่มีการจองรอบที่กำลังจะถึง</span>';
    $("#dash-status").innerHTML = `<h2>สถานะการจอง</h2><p class="status-line">${headline}</p>`
      + (all.pagination.total
        ? `<ul class="stat-list"><li><strong>${upcomingTotal}</strong><span>จองสำเร็จ (รอบที่จะถึง)</span></li><li><strong>${cancelled.pagination.total}</strong><span>ยกเลิกแล้ว</span></li><li><strong>${all.pagination.total}</strong><span>รายการทั้งหมด</span></li></ul>`
        : "<p>เริ่มจองแผงแรกของร้านได้เลย การจองจะยืนยันทันที และจองได้หลายรอบในครั้งเดียว</p>");
    const last = latest.data[0];
    if (last) $("#dash-rebook").innerHTML = `<a class="card action-card rebook-card" href="#/confirm?market=${Number(last.market.id)}&booth=${Number(last.booth.id)}"><span class="action-icon" aria-hidden="true">↻</span><strong>จองแผง ${escapeHtml(last.booth.boothCode)} อีกครั้ง</strong><span>แผงเดิมที่จองล่าสุด เลือกได้หลายรอบในครั้งเดียว</span></a>`;
    $("#dash-next").innerHTML = upcoming.data.length
      ? `<div class="booking-list">${upcoming.data.map(bookingCard).join("")}</div>`
      : `<div class="card">${stateBox("empty", "ยังไม่มีแผงที่จองไว้สำหรับรอบที่กำลังจะถึง", '<a class="button button-primary" href="#/booths">จองแผง</a>', "empty-bookings")}</div>`;
  } catch (error) {
    $("#dash-status").innerHTML = stateBox("error", error.message, retryButton);
  }
}

// ---------- Shop: choose a booth ----------
async function renderBoothsPage(params) {
  const list = $("#booth-list");
  list.innerHTML = stateBox("loading", "กำลังโหลดข้อมูลแผง...");
  $("#booth-summary").textContent = "";
  try {
    if (!state.markets.length) state.markets = (await api("/api/v1/markets?limit=100")).data;
    if (!state.markets.length) { list.innerHTML = stateBox("empty", "ยังไม่มีข้อมูลตลาดในระบบ"); return; }
    if (!state.markets.some(market => market.id === state.booths.marketId)) state.booths.marketId = state.market?.id || state.markets[0].id;
    $("#booth-market").innerHTML = state.markets.map(market => `<option value="${market.id}">${escapeHtml(market.marketName)}</option>`).join("");
    $("#booth-market").value = String(state.booths.marketId);
    await loadBoothEvents(toPositiveInt(params.get("event")));
  } catch (error) { list.innerHTML = stateBox("error", error.message, retryButton); }
}
async function loadBoothEvents(preferredId) {
  const select = $("#booth-event");
  const { data } = await api(`/api/v1/markets/${state.booths.marketId}/events?fromDate=${todayISO()}&limit=100`);
  const events = data.filter(event => event.bookable);
  state.booths.events = events;
  select.disabled = !events.length;
  if (!events.length) {
    select.innerHTML = '<option value="">ยังไม่มีรอบที่เปิดรับจอง</option>';
    state.booths.items = [];
    $("#booth-summary").textContent = "";
    $("#booth-list").innerHTML = stateBox("empty", "ตลาดนี้ยังไม่มีรอบที่เปิดรับจอง กรุณากลับมาตรวจสอบภายหลัง", "", "empty-bookings");
    $("#booth-map-panel").hidden = true;
    return;
  }
  select.innerHTML = events.map(event => `<option value="${event.id}">${escapeHtml(eventLabel(event))}</option>`).join("");
  const ids = events.map(event => event.id);
  state.booths.eventId = ids.includes(preferredId) ? preferredId : ids.includes(state.booths.eventId) ? state.booths.eventId : ids[0];
  select.value = String(state.booths.eventId);
  await loadBooths();
}
async function loadBooths() {
  $("#booth-list").innerHTML = stateBox("loading", "กำลังโหลดสถานะแผง...");
  try {
    const { data } = await api(`/api/v1/markets/${state.booths.marketId}/booths?eventId=${state.booths.eventId}&limit=100`);
    state.booths.items = data;
    renderBooths();
  } catch (error) { $("#booth-list").innerHTML = stateBox("error", error.message, retryButton); }
}
function renderBooths() {
  const filter = $("#booth-status").value;
  const all = state.booths.items;
  const items = all.filter(booth => !filter || (filter === "available" ? booth.availability === "available" : booth.availability !== "available"));
  const event = state.booths.events.find(item => item.id === state.booths.eventId);
  const available = all.filter(booth => booth.availability === "available").length;
  $("#booth-summary").textContent = `${event ? formatDate(event.eventDate) : ""} · ว่าง ${available} จาก ${all.length} แผง${filter ? ` · แสดง ${items.length} แผงตามตัวกรอง` : ""}`;
  $("#booth-list").innerHTML = items.length
    ? items.map(booth => {
      const open = booth.availability === "available";
      return `<article class="card booth-card is-${escapeHtml(booth.availability)}">
          <div class="booth-card-head"><h3>แผง ${escapeHtml(booth.boothCode)}</h3>${boothBadge(booth.availability)}</div>
          <dl class="booth-meta">${detailRow("ตำแหน่ง", escapeHtml(positionText(booth)))}${detailRow("ขนาด", escapeHtml(formatSize(booth.width, booth.depth)))}${detailRow("ค่าเช่า", `<strong>${escapeHtml(formatMoney(booth.price))}</strong> / รอบ`)}</dl>
          ${open ? `<a class="button button-primary button-full" href="#/confirm?market=${state.booths.marketId}&event=${state.booths.eventId}&booth=${Number(booth.id)}">เลือกแผงนี้</a>` : `<button type="button" class="button button-full" disabled>ไม่สามารถจองได้</button>`}
        </article>`;
    }).join("")
    : stateBox("empty", filter === "available" ? "รอบนี้ไม่มีแผงว่างแล้ว ลองเลือกรอบอื่น" : "ไม่พบแผงตามตัวกรองนี้", "", "empty-shops");
  renderMap($("#booth-map"), all, { mode: "booth", matchIds: filter ? new Set(items.map(booth => booth.id)) : null });
  setBoothView(state.booths.view);
}
function setBoothView(view) {
  state.booths.view = view;
  $$("[data-booth-view]").forEach(button => {
    const active = button.dataset.boothView === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#booth-list").hidden = view !== "list";
  $("#booth-map-panel").hidden = view !== "map" || !state.booths.items.length;
  if (view === "map") applyZoom("booth", state.zoom.booth);
}

// ---------- Shop: confirm booking (one or several rounds) ----------
async function renderConfirmPage(params) {
  const box = $("#confirm-content");
  const requestedEvent = toPositiveInt(params.get("event"));
  const boothId = toPositiveInt(params.get("booth"));
  if (!boothId) {
    box.innerHTML = '<h1 class="page-title" tabindex="-1">ยืนยันการจอง</h1>' + stateBox("empty", "ยังไม่ได้เลือกแผงที่ต้องการจอง", '<a class="button button-primary" href="#/booths">ไปเลือกแผง</a>');
    return;
  }
  box.innerHTML = stateBox("loading", "กำลังตรวจสอบแผงที่เลือก...");
  try {
    const marketId = toPositiveInt(params.get("market")) || state.booths.marketId || (await ensureMarket()).id;
    const market = state.market?.id === marketId ? state.market : (await api(`/api/v1/markets/${marketId}`)).data;
    const [rounds, own] = await Promise.all([
      api(`/api/v1/markets/${marketId}/booths/${boothId}/events`),
      api(`/api/v1/bookings?status=confirmed&fromDate=${todayISO()}&limit=100`)
    ]);
    const booth = rounds.data.booth;
    const mine = new Set(own.data.filter(item => item.booth.id === boothId).map(item => item.event.id));
    const events = rounds.data.events.filter(event => event.bookable).map(event => ({ ...event, mine: mine.has(event.id), open: event.availability === "available" }));
    const back = `<a class="button button-primary" href="#/booths">กลับไปเลือกแผง</a>`;
    if (booth.status !== "available") { box.innerHTML = '<h1 class="page-title" tabindex="-1">แผงนี้ไม่เปิดให้จอง</h1>' + stateBox("empty", `แผง ${booth.boothCode} มีสถานะ “${BOOTH_STATUS[booth.status]?.label || booth.status}” กรุณาเลือกแผงอื่น`, back); return; }
    if (!events.some(event => event.open)) { box.innerHTML = '<h1 class="page-title" tabindex="-1">แผงนี้ไม่ว่างแล้ว</h1>' + stateBox("empty", `แผง ${booth.boothCode} ไม่ว่างในทุกรอบที่เปิดรับจอง กรุณาเลือกแผงอื่น`, back, "empty-bookings"); return; }
    const preselected = events.find(event => event.id === requestedEvent && event.open) || events.find(event => event.open);
    box.innerHTML = `<article class="card">
        <p class="eyebrow">ขั้นตอนสุดท้าย</p>
        <h1 class="page-title" tabindex="-1">ตรวจสอบและยืนยันการจอง</h1>
        <dl class="detail-list">
          ${detailRow("ตลาด", `${escapeHtml(market.marketName)}<br><span class="muted">${escapeHtml(market.address || "")}</span>`)}
          ${detailRow("หมายเลขแผง", `<span class="booth-code booth-code-large">${escapeHtml(booth.boothCode)}</span>`)}
          ${detailRow("ตำแหน่ง", escapeHtml(positionText(booth)))}
          ${detailRow("ขนาด", escapeHtml(formatSize(booth.width, booth.depth)))}
          ${detailRow("ค่าเช่า", `<strong class="price">${escapeHtml(formatMoney(booth.price))}</strong> / รอบ`)}
        </dl>
        <fieldset class="round-fieldset">
          <legend>เลือกรอบ / วันจัดงาน ที่ต้องการจอง</legend>
          <p class="hint">เลือกได้หลายรอบ (สูงสุด 12 รอบ) — รอบที่แผงไม่ว่างจะเลือกไม่ได้</p>
          <div class="button-row"><button type="button" class="button button-small button-outline" id="rounds-all">เลือกทุกรอบที่ว่าง</button><button type="button" class="button button-small button-text" id="rounds-none">ล้างที่เลือก</button></div>
          <div class="round-list" id="round-list">${events.map(event => {
            const status = event.mine ? '<span class="badge badge-lavender">จองไว้แล้ว (ร้านคุณ)</span>' : boothBadge(event.availability);
            return `<label class="round-option ${event.open ? "" : "is-disabled"}"><input type="checkbox" name="round" value="${event.id}" ${event.open ? "" : "disabled"} ${event.id === preselected.id ? "checked" : ""}><span><strong>${escapeHtml(formatDate(event.eventDate))}</strong><small>${escapeHtml(event.eventName)} · ${escapeHtml(formatTimeRange(event.openTime, event.closeTime))}</small></span>${status}</label>`;
          }).join("")}</div>
          <div class="round-total" id="round-total" aria-live="polite"></div>
        </fieldset>
      </article>
      <section class="card conditions" aria-labelledby="conditions-title">
        <h2 id="conditions-title">เงื่อนไขการจองและการยกเลิก</h2>
        <ul>
          <li>เมื่อกด “ยืนยันการจอง” การจองจะมีสถานะ <strong>จองสำเร็จ</strong> ทันที ไม่ต้องรออนุมัติ</li>
          <li>ค่าเช่าคิดตามราคา ณ เวลาที่จอง (${escapeHtml(formatMoney(booth.price))} ต่อรอบ) แม้ราคาแผงจะเปลี่ยนภายหลัง</li>
          <li>ยกเลิกการจองได้ทุกเวลาที่หน้า “การจองของฉัน” (ยกเลิกทีละรอบได้) ระบบจะเก็บประวัติรายการไว้</li>
          <li>หากจองหลายรอบแล้วบางรอบมีร้านอื่นจองก่อน ระบบจะจองให้เฉพาะรอบที่ยังว่าง และแจ้งรอบที่จองไม่สำเร็จ</li>
          <li>ระบบยังไม่มีการชำระเงินออนไลน์ กรุณาชำระค่าเช่าตามที่ตลาดกำหนด</li>
        </ul>
        <label class="check"><input type="checkbox" id="confirm-accept"> ฉันอ่านและยอมรับเงื่อนไขการจองแล้ว</label>
        <div class="form-alert" id="confirm-alert" role="alert" hidden></div>
        <div class="button-row" id="confirm-actions"><button type="button" class="button button-primary" id="confirm-submit" disabled>ยืนยันการจอง</button><a class="button button-outline" href="#/booths?event=${preselected.id}">กลับไปเลือกแผง</a></div>
      </section>`;
    const selectedIds = () => $$("#round-list input:checked").map(input => Number(input.value));
    const update = () => {
      const count = selectedIds().length;
      $("#round-total").innerHTML = `<span>เลือก ${count} รอบ</span><span>ค่าเช่ารวม <strong class="price">${escapeHtml(formatMoney(count * booth.price))}</strong></span>`;
      $("#confirm-submit").disabled = !$("#confirm-accept").checked || !count || count > 12;
      $("#confirm-submit").textContent = count > 1 ? `ยืนยันการจอง ${count} รอบ` : "ยืนยันการจอง";
      if (count > 12) setAlert($("#confirm-alert"), "จองได้สูงสุด 12 รอบต่อครั้ง");
      else if ($("#confirm-alert").textContent === "จองได้สูงสุด 12 รอบต่อครั้ง") setAlert($("#confirm-alert"), "");
    };
    $("#round-list").addEventListener("change", update);
    $("#confirm-accept").addEventListener("change", update);
    $("#rounds-all").addEventListener("click", () => { $$("#round-list input:not(:disabled)").slice(0, 12).forEach(input => { input.checked = true; }); update(); });
    $("#rounds-none").addEventListener("click", () => { $$("#round-list input").forEach(input => { input.checked = false; }); update(); });
    $("#confirm-submit").addEventListener("click", () => submitBooking({ market, booth, events, eventIds: selectedIds() }));
    update();
  } catch (error) {
    box.innerHTML = '<h1 class="page-title" tabindex="-1">ตรวจสอบแผงไม่สำเร็จ</h1>' + stateBox("error", error.message, retryButton);
  }
}
async function submitBooking({ market, booth, events, eventIds }) {
  const button = $("#confirm-submit");
  if (button.disabled || !eventIds.length) return;
  setBusy(button, true, "กำลังจอง...");
  setAlert($("#confirm-alert"), "");
  const eventById = new Map(events.map(event => [event.id, event]));
  try {
    let created;
    let failed = [];
    if (eventIds.length === 1) created = [(await api("/api/v1/bookings", { method: "POST", body: { eventId: eventIds[0], boothId: booth.id } })).data];
    else ({ created, failed } = (await api("/api/v1/bookings/batch", { method: "POST", body: { eventIds, boothId: booth.id } })).data);
    notify(`จองแผง ${booth.boothCode} สำเร็จ ${created.length} รอบ`, "success");
    const total = created.reduce((sum, item) => sum + Number(item.price), 0);
    $("#confirm-content").innerHTML = `<div class="card success-card">
        <span class="success-icon" aria-hidden="true">✓</span>
        <h1 class="page-title" tabindex="-1">จองแผง ${escapeHtml(booth.boothCode)} สำเร็จ ${created.length} รอบ</h1>
        <p class="status-line">${bookingBadge("confirmed")} ${escapeHtml(market.marketName)} · ค่าเช่ารวม <strong>${escapeHtml(formatMoney(total))}</strong></p>
        <ul class="result-list">${created.map(item => `<li><span><strong>#${Number(item.id)}</strong> · ${escapeHtml(formatDate(item.event.eventDate))} · ${escapeHtml(formatTimeRange(eventById.get(item.event.id)?.openTime, eventById.get(item.event.id)?.closeTime))}</span><a href="#/bookings/${Number(item.id)}">ดูรายละเอียด</a></li>`).join("")}
          ${failed.map(item => `<li class="is-failed"><span>✕ ${escapeHtml(formatDate(eventById.get(item.eventId)?.eventDate))}</span><span>${escapeHtml(item.message)}</span></li>`).join("")}</ul>
        ${failed.length ? `<p class="form-alert form-alert-warning">มี ${failed.length} รอบที่จองไม่สำเร็จ ระบบไม่ได้เก็บค่าเช่าของรอบเหล่านั้น</p>` : ""}
        <div class="button-row"><a class="button button-primary" href="#/bookings/${Number(created[0].id)}">ดูรายละเอียดการจอง</a><a class="button button-outline" href="#/bookings">การจองของฉัน</a><a class="button button-text" href="#/booths?event=${created[0].event.id}">จองแผงเพิ่ม</a></div>
      </div>`;
    $("#confirm-content .page-title").focus();
  } catch (error) {
    setBusy(button, false);
    const alert = $("#confirm-alert");
    if (error.code === "NO_BOOKING_CREATED") {
      button.disabled = true;
      setAlert(alert, `${error.message}: ${Object.entries(error.fields).map(([id, message]) => `${formatShortDate(eventById.get(Number(id))?.eventDate)} ${message}`).join(" · ")}`);
      $("#confirm-actions").innerHTML = `${retryButton.replace("ลองอีกครั้ง", "โหลดสถานะแผงใหม่")}<a class="button button-primary" href="#/booths">เลือกแผงใหม่</a>`;
    } else if (["BOOTH_UNAVAILABLE", "EVENT_NOT_BOOKABLE", "EVENT_OR_BOOTH_NOT_FOUND"].includes(error.code)) {
      button.disabled = true;
      setAlert(alert, error.message);
      $("#confirm-actions").innerHTML = `<a class="button button-primary" href="#/booths?event=${eventIds[0]}">เลือกแผงใหม่</a>`;
    } else if (error.code === "DUPLICATE_BOOKING") {
      button.disabled = true;
      setAlert(alert, error.message);
      $("#confirm-actions").innerHTML = '<a class="button button-primary" href="#/bookings">ดูการจองของฉัน</a>';
    } else if (error.status !== 401) setAlert(alert, error.message);
  }
}

// ---------- Shop: my bookings ----------
function renderBookingsPage() {
  $("#bookings-time").value = state.bookings.time;
  $("#bookings-status").value = state.bookings.status;
  $("#bookings-order").value = state.bookings.order;
  return loadBookings();
}
async function loadBookings() {
  const options = state.bookings;
  const params = new URLSearchParams({ page: String(options.page), limit: "10", sort: "eventDate", order: options.order });
  if (options.time === "upcoming") params.set("fromDate", todayISO());
  if (options.time === "past") params.set("toDate", todayISO(-1));
  if (options.status) params.set("status", options.status);
  const list = $("#booking-list");
  list.innerHTML = stateBox("loading", "กำลังโหลดรายการจอง...");
  $("#bookings-pager").innerHTML = "";
  try {
    const { data, pagination } = await api(`/api/v1/bookings?${params}`);
    if (!data.length && options.page > 1 && pagination.total) { options.page = pagination.totalPages; return loadBookings(); }
    $("#bookings-summary").textContent = pagination.total ? `พบ ${pagination.total} รายการ` : "";
    list.innerHTML = data.length
      ? data.map(bookingCard).join("")
      : `<div class="card">${stateBox("empty", options.time === "upcoming" && !options.status ? "ยังไม่มีการจองสำหรับรอบที่กำลังจะถึง" : "ไม่พบรายการจองตามตัวกรองนี้", '<a class="button button-primary" href="#/booths">จองแผง</a>', "empty-bookings")}</div>`;
    $("#bookings-pager").innerHTML = pagerHtml(options.page, pagination.totalPages);
  } catch (error) { list.innerHTML = stateBox("error", error.message, retryButton); }
}

// ---------- Shop: booking detail ----------
async function renderBookingPage(params, bookingId) {
  const box = $("#booking-content");
  box.innerHTML = stateBox("loading", "กำลังโหลดรายละเอียดการจอง...");
  try {
    const { data } = await api(`/api/v1/bookings/${bookingId}`);
    box.innerHTML = `<article class="card">
        <p class="eyebrow">เลขที่การจอง #${Number(data.id)}</p>
        <h1 class="page-title" tabindex="-1">แผง ${escapeHtml(data.booth.boothCode)} · ${escapeHtml(formatShortDate(data.event.eventDate))}</h1>
        <p class="status-line">สถานะ: ${bookingBadge(data.status)} ${data.event.status === "cancelled" ? eventBadge("cancelled") : ""}</p>
        <dl class="detail-list">
          ${detailRow("ตลาด", `${escapeHtml(data.market.marketName)}<br><span class="muted">${escapeHtml(data.market.address || "")}</span>`)}
          ${detailRow("รอบตลาด", escapeHtml(data.event.eventName))}
          ${detailRow("วันจัดงาน", `<strong>${escapeHtml(formatDate(data.event.eventDate))}</strong>`)}
          ${detailRow("เวลาเปิด–ปิด", escapeHtml(formatTimeRange(data.event.openTime, data.event.closeTime)))}
          ${detailRow("หมายเลขแผง", `<span class="booth-code booth-code-large">${escapeHtml(data.booth.boothCode)}</span>`)}
          ${detailRow("ตำแหน่ง", escapeHtml(positionText(data.booth)))}
          ${detailRow("ขนาด", escapeHtml(formatSize(data.booth.width, data.booth.depth)))}
          ${detailRow("ค่าเช่า ณ วันจอง", escapeHtml(formatMoney(data.price)))}
          ${detailRow("จองเมื่อ", escapeHtml(formatDateTime(data.bookedAt)))}
          ${data.cancelledAt ? detailRow("ยกเลิกเมื่อ", escapeHtml(formatDateTime(data.cancelledAt))) : ""}
        </dl>
      </article>
      ${data.canCancel
        ? `<section class="card danger-zone"><h2>ยกเลิกการจอง</h2><p>ยกเลิกได้ทุกเวลา เมื่อยกเลิกแล้วแผงจะว่างให้ร้านอื่นจองได้ ประวัติรายการนี้ยังถูกเก็บไว้ แต่หากต้องการขายรอบนี้ต้องจองใหม่</p><button type="button" class="button button-danger" id="cancel-booking">ยกเลิกการจองนี้</button></section>`
        : `<p class="note">${data.status === "cancelled" ? "รายการนี้ถูกยกเลิกแล้ว ระบบเก็บไว้เป็นประวัติการจอง" : data.status === "rejected" ? "ผู้ดูแลตลาดไม่อนุมัติรายการนี้ กรุณาติดต่อผู้ดูแลตลาดหากมีข้อสงสัย" : "รายการนี้ไม่สามารถยกเลิกได้"}</p>`}`;
    $("#cancel-booking")?.addEventListener("click", () => cancelBooking(data));
  } catch (error) {
    const notFound = error.status === 404;
    box.innerHTML = `<h1 class="page-title" tabindex="-1">${notFound ? "ไม่พบรายการจอง" : "โหลดรายการจองไม่สำเร็จ"}</h1>` + stateBox(notFound ? "empty" : "error", notFound ? "ไม่พบรายการจองนี้ในบัญชีของคุณ" : error.message, notFound ? '<a class="button button-primary" href="#/bookings">กลับไปการจองของฉัน</a>' : retryButton, notFound ? "empty-bookings" : "");
  }
}
async function cancelBooking(booking) {
  const result = await confirmDialog({
    title: `ยืนยันยกเลิกแผง ${booking.booth.boothCode}?`,
    body: `<p>${escapeHtml(formatDate(booking.event.eventDate))} · ${escapeHtml(booking.market.marketName)}</p><div class="field"><label for="cancel-reason">เหตุผลในการยกเลิก (ไม่บังคับ)</label><textarea id="cancel-reason" name="reason" rows="3" maxlength="500"></textarea><p class="hint">ไม่เกิน 500 ตัวอักษร</p></div>`,
    okText: "ยืนยันยกเลิก",
    cancelText: "ไม่ยกเลิก",
    danger: true
  });
  if (!result.ok) return;
  setBusy($("#cancel-booking"), true, "กำลังยกเลิก...");
  const reason = $("#cancel-reason").value.trim();
  try {
    await api(`/api/v1/bookings/${booking.id}/cancel`, { method: "POST", body: reason ? { reason } : {} });
    notify(`ยกเลิกการจองแผง ${booking.booth.boothCode} เรียบร้อยแล้ว`, "success");
  } catch (error) {
    if (error.status !== 401) notify(error.message, "error");
  }
  if (state.user) await renderBookingPage(null, booking.id);
  $("#booking-content .page-title")?.focus();
}

// ---------- Shop: profile, photo and shop QR ----------
async function renderProfilePage() {
  const form = $("#profile-form");
  const account = $("#profile-account");
  setFormErrors(form, {});
  setAlert($("#profile-alert"), "");
  setAlert($("#photo-alert"), "");
  account.innerHTML = stateBox("loading", "กำลังโหลดข้อมูลร้าน...");
  form.hidden = true;
  $("#profile-photo").hidden = true;
  $("#shop-qr-card").hidden = true;
  try {
    const { data } = await api("/api/v1/shop/profile");
    account.innerHTML = `<h2>บัญชีผู้ใช้</h2><dl class="detail-list">${detailRow("อีเมลสำหรับเข้าสู่ระบบ", escapeHtml(data.account.email))}${detailRow("เบอร์โทรศัพท์บัญชี", escapeHtml(data.account.phone || "ไม่ได้ระบุ"))}${detailRow("แก้ไขล่าสุด", escapeHtml(formatDateTime(data.updatedAt)))}</dl><p class="hint">อีเมล เบอร์บัญชี และชื่อผู้ติดต่อ ไม่แสดงต่อลูกค้า</p>`;
    fillProfile(data);
    form.hidden = false;
    $("#profile-photo").hidden = false;
    const url = new URL(`/#/store/${data.id}`, location.origin).toString();
    $("#shop-qr-url").href = url;
    $("#shop-qr-url").textContent = url;
    drawQr($("#shop-qr-image"), url, `QR Code ร้าน ${data.shopName}`);
    $("#shop-qr-card").hidden = false;
  } catch (error) { account.innerHTML = stateBox("error", error.message, retryButton); }
}
function fillProfile(data) {
  const form = $("#profile-form");
  ["shopName", "category", "description", "contactName", "contactPhone", "socialUrl"].forEach(name => { form.elements[name].value = data[name] || ""; });
  $("#photo-preview").src = shopImage(data.imageUrl);
  $("#photo-remove").hidden = !data.imageUrl;
}
function syncShop(data) {
  state.shop = { ...state.shop, shopName: data.shopName, category: data.category, description: data.description, contactName: data.contactName, contactPhone: data.contactPhone, socialUrl: data.socialUrl, imageUrl: data.imageUrl };
  state.customer.loaded = false;
  renderNav(currentRoute().path);
}
async function submitProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("button[type='submit']", form);
  if (button.disabled) return;
  const value = name => form.elements[name].value.trim();
  const body = { shopName: value("shopName"), category: value("category") || null, description: value("description") || null, contactName: value("contactName") || null, contactPhone: normalizePhone(value("contactPhone")) || null, socialUrl: value("socialUrl") || null };
  const fields = {};
  if (!body.shopName) fields.shopName = "กรุณากรอกชื่อร้าน";
  if (body.contactPhone && !PHONE_PATTERN.test(body.contactPhone)) fields.contactPhone = "เบอร์ติดต่อร้านต้องเป็นตัวเลข 9–15 หลัก";
  if (body.socialUrl && !/^https?:\/\/\S+$/i.test(body.socialUrl)) fields.socialUrl = "ลิงก์ต้องขึ้นต้นด้วย https:// เช่น https://facebook.com/ร้านของคุณ";
  setAlert($("#profile-alert"), "");
  setFormErrors(form, fields);
  if (Object.keys(fields).length) return;
  setBusy(button, true, "กำลังบันทึก...");
  try {
    const { data } = await api("/api/v1/shop/profile", { method: "PATCH", body });
    syncShop(data);
    fillProfile(data);
    setAlert($("#profile-alert"), "บันทึกข้อมูลร้านเรียบร้อยแล้ว", "success");
    notify("บันทึกข้อมูลร้านเรียบร้อยแล้ว", "success");
  } catch (error) {
    setFormErrors(form, error.fields);
    if (error.status !== 401) setAlert($("#profile-alert"), `${error.message} ข้อมูลที่กรอกยังอยู่ในฟอร์ม แก้ไขแล้วกดบันทึกอีกครั้งได้`);
  } finally { setBusy(button, false); }
}
// Shrinks the photo in the browser (max 1200px, JPEG) so uploads stay small on mobile data.
async function resizeImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("ใช้ไฟล์รูป JPG, PNG หรือ WEBP");
  if (file.size > 20 * 1024 * 1024) throw new Error("ไฟล์ใหญ่เกิน 20 MB");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("เปิดไฟล์รูปนี้ไม่ได้")); image.src = objectUrl; });
    const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    if (dataUrl.length > 2_600_000) dataUrl = canvas.toDataURL("image/jpeg", 0.65);
    return dataUrl;
  } finally { URL.revokeObjectURL(objectUrl); }
}
async function uploadPhoto(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  const label = $(".file-button");
  label.setAttribute("aria-busy", "true");
  setAlert($("#photo-alert"), "กำลังอัปโหลดรูป...", "info");
  try {
    const image = await resizeImage(file);
    const { data } = await api("/api/v1/shop/profile/image", { method: "POST", body: { image } });
    syncShop(data);
    fillProfile(data);
    setAlert($("#photo-alert"), "อัปโหลดรูปร้านเรียบร้อยแล้ว", "success");
    notify("อัปโหลดรูปร้านเรียบร้อยแล้ว", "success");
  } catch (error) {
    if (error.status !== 401) setAlert($("#photo-alert"), error.fields?.image || error.message);
  } finally { label.removeAttribute("aria-busy"); }
}
async function removePhoto() {
  const result = await confirmDialog({ title: "ลบรูปหน้าร้าน?", body: "<p>ลูกค้าจะเห็นภาพประกอบมาตรฐานแทนรูปร้าน</p>", okText: "ลบรูป", danger: true });
  if (!result.ok) return;
  try {
    const { data } = await api("/api/v1/shop/profile/image", { method: "DELETE" });
    syncShop(data);
    fillProfile(data);
    setAlert($("#photo-alert"), "ลบรูปร้านแล้ว", "success");
  } catch (error) { if (error.status !== 401) setAlert($("#photo-alert"), error.message); }
}

// ---------- Market admin ----------
async function ensureAdminMarket() {
  if (state.admin.market) return state.admin.market;
  const { data } = await api("/api/v1/admin/markets");
  if (!data.length) throw new Error("ยังไม่มีตลาดในระบบ");
  state.admin.market = data[0];
  return data[0];
}
async function renderAdminPage(params, tab = "overview") {
  const name = tab || "overview";
  $("#admin-title").textContent = ADMIN_TABS[name];
  document.title = `${ADMIN_TABS[name]} | ผู้ดูแลตลาด | ตากหลาดนัด`;
  $$("[data-admin-tab]").forEach(link => { if (link.dataset.adminTab === name) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
  const content = $("#admin-content");
  content.innerHTML = stateBox("loading", "กำลังโหลดข้อมูล...");
  try {
    const market = await ensureAdminMarket();
    await { overview: adminOverview, events: adminEvents, booths: adminBooths, bookings: adminBookings, shops: adminShops, market: adminMarket }[name](content, market, params);
  } catch (error) {
    // The admin role was removed while this page was open: refresh the session and leave.
    if (error.status === 403) { await loadSession(); notify(error.message, "error"); go(homePath()); return; }
    content.innerHTML = stateBox("error", error.message, retryButton);
  }
}

async function adminOverview(content, market) {
  const { data } = await api("/api/v1/admin/overview");
  const next = data.nextEvent;
  const lowRounds = data.upcomingEvents < 4;
  content.innerHTML = `${lowRounds ? `<p class="form-alert form-alert-warning">รอบตลาดที่จะถึงเหลือ ${data.upcomingEvents} รอบ${data.lastEventDate ? ` (ถึง${formatDate(data.lastEventDate)})` : ""} — <a href="#/admin/events">เพิ่มรอบตลาดใหม่</a> เพื่อให้ร้านค้าจองต่อได้</p>` : ""}
    <div class="admin-grid">
      <div class="card stat-card tone-mint"><span>ร้านค้าที่ใช้งาน</span><strong>${data.shops.active}</strong><span>จากทั้งหมด ${data.shops.total} ร้าน</span></div>
      <div class="card stat-card tone-sky"><span>รอบตลาดที่จะถึง</span><strong>${data.upcomingEvents}</strong><span>${data.lastEventDate ? `ถึง ${escapeHtml(formatShortDate(data.lastEventDate))}` : "ยังไม่มีรอบ"}</span></div>
      <div class="card stat-card tone-peach"><span>จองแล้วรอบถัดไป</span><strong>${next ? `${next.bookedCount}/${next.boothUsable}` : "-"}</strong><span>${next ? escapeHtml(formatDate(next.eventDate)) : "ไม่มีรอบถัดไป"}</span></div>
      <div class="card stat-card tone-lavender"><span>ค่าเช่ารอบถัดไป</span><strong>${next ? escapeHtml(formatMoney(next.revenue)) : "-"}</strong><span>จากการจองที่ยืนยันแล้ว</span></div>
    </div>
    <h2 class="section-title">ทางลัด</h2>
    <div class="menu-grid">
      <a class="card action-card tone-sky" href="#/admin/events"><span class="action-icon" aria-hidden="true">🗓</span><strong>เพิ่มรอบตลาด</strong><span>เพิ่มทีละรอบหรือทุกสัปดาห์ งดตลาดได้</span></a>
      <a class="card action-card tone-butter" href="#/admin/booths"><span class="action-icon" aria-hidden="true">▦</span><strong>จัดผังแผง</strong><span>เพิ่มแผง ย้ายตำแหน่ง ตั้งราคา ปิดปรับปรุง</span></a>
      <a class="card action-card tone-peach" href="#/admin/bookings${next ? `?event=${next.id}` : ""}"><span class="action-icon" aria-hidden="true">☰</span><strong>ตรวจการจอง</strong><span>ดูร้านที่จองแต่ละรอบ ยกเลิกหรือปฏิเสธ</span></a>
      <a class="card action-card tone-lavender" href="#/admin/shops"><span class="action-icon" aria-hidden="true">✎</span><strong>จัดการร้านค้า</strong><span>ค้นหาร้าน ปิดหรือเปิดใช้งานบัญชี</span></a>
    </div>`;
}

async function adminEvents(content, market) {
  const filter = state.admin.eventsFilter;
  const query = new URLSearchParams({ limit: "100", order: filter === "past" ? "desc" : "asc" });
  if (filter === "upcoming") query.set("fromDate", todayISO());
  if (filter === "past") query.set("toDate", todayISO(-1));
  const { data } = await api(`/api/v1/admin/markets/${market.id}/events?${query}`);
  const lastDate = data.filter(event => event.status !== "cancelled").map(event => event.eventDate).sort().pop();
  let suggested = lastDate && lastDate >= todayISO() ? addDaysISO(lastDate, 7) : todayISO();
  content.innerHTML = `<form class="card form-card" id="event-form" novalidate>
      <h2>เพิ่มรอบตลาด</h2>
      <div class="form-alert" id="event-alert" role="alert" hidden></div>
      <div class="form-grid">
        ${field("eventName", "ชื่อรอบ *", '<input type="text" maxlength="150" value="ตลาดนัดวันเสาร์" required>')}
        ${field("eventDate", "วันที่รอบแรก *", `<input type="date" value="${suggested}" required>`)}
        ${field("repeatWeeks", "จำนวนสัปดาห์", '<input type="number" min="1" max="26" value="4" inputmode="numeric">', "สร้างวันเดียวกันของทุกสัปดาห์ (1–26)")}
        ${field("openTime", "เวลาเปิด", '<input type="time">', `เว้นว่าง = ใช้เวลาตลาด ${(market.openTime || "").slice(0, 5)}`)}
        ${field("closeTime", "เวลาปิด", '<input type="time">', `เว้นว่าง = ใช้เวลาตลาด ${(market.closeTime || "").slice(0, 5)}`)}
      </div>
      <button class="button button-primary" type="submit">+ เพิ่มรอบตลาด</button>
    </form>
    <section class="card admin-section">
      <div class="map-toolbar"><h2>รายการรอบตลาด</h2><div class="field"><label for="events-filter" class="sr-only">ช่วงเวลา</label><select id="events-filter"><option value="upcoming">รอบที่กำลังจะถึง</option><option value="past">รอบที่ผ่านมา</option><option value="all">ทั้งหมด</option></select></div></div>
      <div class="admin-list">${data.length ? data.map(event => `<div class="admin-row ${event.status === "cancelled" ? "is-muted" : ""}">
          <div><strong>${escapeHtml(formatDate(event.eventDate))}</strong><small>${escapeHtml(event.eventName)} · ${escapeHtml(formatTimeRange(event.openTime, event.closeTime))}</small></div>
          <div>${eventBadge(event.status)}<small>จองแล้ว ${event.bookedCount} แผง · ${escapeHtml(formatMoney(event.revenue))}</small></div>
          <div class="row-actions"><label class="sr-only" for="event-status-${event.id}">สถานะรอบ ${escapeHtml(formatDate(event.eventDate))}</label><select id="event-status-${event.id}" data-event-status="${event.id}" data-booked="${event.bookedCount}">${Object.entries(EVENT_STATUS).map(([value, info]) => `<option value="${value}" ${value === event.status ? "selected" : ""}>${info.label}</option>`).join("")}</select><button type="button" class="button button-small button-outline" data-event-edit="${event.id}">แก้ไข</button><a class="button button-small button-text" href="#/admin/bookings?event=${event.id}">ดูการจอง</a></div>
        </div>`).join("") : stateBox("empty", "ไม่มีรอบตลาดในช่วงนี้", "", "empty-bookings")}</div>
    </section>`;
  $("#events-filter").value = filter;
  $("#events-filter").addEventListener("change", event => { state.admin.eventsFilter = event.target.value; route(); });
  $("#event-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("button[type='submit']", form);
    const values = Object.fromEntries(new FormData(form));
    const body = { eventName: values.eventName.trim(), eventDate: values.eventDate, repeatWeeks: Number(values.repeatWeeks || 1) };
    if (values.openTime) body.openTime = values.openTime;
    if (values.closeTime) body.closeTime = values.closeTime;
    setFormErrors(form, {});
    setBusy(button, true, "กำลังเพิ่ม...");
    try {
      const { data: result } = await api(`/api/v1/admin/markets/${market.id}/events`, { method: "POST", body });
      notify(`เพิ่มรอบตลาด ${result.created.length} รอบ${result.skippedDates.length ? ` (ข้าม ${result.skippedDates.length} วันที่มีรอบอยู่แล้ว)` : ""}`, "success");
      state.market = null;
      route();
    } catch (error) {
      setFormErrors(form, error.fields);
      if (error.status !== 401) setAlert($("#event-alert"), error.message);
      setBusy(button, false);
    }
  });
  content.querySelectorAll("[data-event-status]").forEach(select => select.addEventListener("change", async () => {
    const status = select.value;
    if (status === "cancelled") {
      const result = await confirmDialog({ title: "ยืนยันงดตลาดรอบนี้?", body: `<p>การจองที่ยังใช้งานอยู่ ${select.dataset.booked} รายการจะถูกยกเลิกอัตโนมัติ และร้านค้าจะเห็นสถานะ “ยกเลิกแล้ว”</p>`, okText: "งดตลาดรอบนี้", danger: true });
      if (!result.ok) { route(); return; }
    }
    try {
      const { data: updated } = await api(`/api/v1/admin/events/${select.dataset.eventStatus}`, { method: "PATCH", body: { status } });
      notify(`เปลี่ยนสถานะเป็น “${EVENT_STATUS[status].label}”${updated.cancelledBookings ? ` และยกเลิกการจอง ${updated.cancelledBookings} รายการ` : ""}`, "success");
      state.market = null;
    } catch (error) { if (error.status !== 401) notify(error.message, "error"); }
    route();
  }));
  content.querySelectorAll("[data-event-edit]").forEach(button => button.addEventListener("click", async () => {
    const event = data.find(item => item.id === Number(button.dataset.eventEdit));
    const result = await confirmDialog({
      title: "แก้ไขรอบตลาด",
      body: `<div class="form-grid">${field("eventName", "ชื่อรอบ", `<input type="text" maxlength="150" value="${escapeHtml(event.eventName)}">`)}${field("eventDate", "วันที่", `<input type="date" value="${event.eventDate}">`)}${field("openTime", "เวลาเปิด", `<input type="time" value="${(event.ownOpenTime || "").slice(0, 5)}">`)}${field("closeTime", "เวลาปิด", `<input type="time" value="${(event.ownCloseTime || "").slice(0, 5)}">`)}</div><p class="hint">เวลาว่าง = ใช้เวลาเปิด–ปิดของตลาด</p>`,
      okText: "บันทึก"
    });
    if (!result.ok) return;
    const values = Object.fromEntries(new FormData(result.form));
    try {
      await api(`/api/v1/admin/events/${event.id}`, { method: "PATCH", body: { eventName: values.eventName, eventDate: values.eventDate, openTime: values.openTime || null, closeTime: values.closeTime || null } });
      notify("บันทึกรอบตลาดแล้ว", "success");
      state.market = null;
      route();
    } catch (error) { if (error.status !== 401) notify(`${error.message} ${Object.values(error.fields).join(" ")}`, "error"); }
  }));
}

async function adminBooths(content, market) {
  const { data } = await api(`/api/v1/admin/markets/${market.id}/booths`);
  state.admin.booths = data;
  content.innerHTML = `<div class="booth-editor">
      <section class="card map-panel">
        <div class="map-toolbar"><h2>ผังตลาด</h2>${zoomControls("admin")}</div>
        <p class="hint">แตะแผงเพื่อแก้ไข · ขณะแก้ไข แตะพื้นที่ว่างบนผังเพื่อย้ายแผงไปตำแหน่งนั้น</p>
        <div class="map-viewport"><div class="map-canvas is-placing" id="admin-map" role="group" aria-label="แผนผังสำหรับจัดแผง"></div></div>
      </section>
      <form class="card form-card" id="booth-form" novalidate>
        <h2 id="booth-form-title">เพิ่มแผงใหม่</h2>
        <div class="form-alert" id="booth-alert" role="alert" hidden></div>
        <div class="form-grid">
          ${field("boothCode", "หมายเลขแผง *", '<input type="text" maxlength="30" required>', "เช่น A07")}
          ${field("price", "ค่าเช่าต่อรอบ (บาท) *", '<input type="number" min="0" step="1" inputmode="decimal" required>')}
          ${field("width", "กว้าง (เมตร)", '<input type="number" min="0.1" step="0.1" inputmode="decimal">')}
          ${field("depth", "ลึก (เมตร)", '<input type="number" min="0.1" step="0.1" inputmode="decimal">')}
          ${field("mapX", "ตำแหน่งแนวนอน (0–100)", '<input type="number" min="0" max="100" step="0.1" inputmode="decimal">')}
          ${field("mapY", "ตำแหน่งแนวตั้ง (0–100)", '<input type="number" min="0" max="100" step="0.1" inputmode="decimal">')}
          ${field("status", "สถานะแผง", `<select>${["available", "maintenance", "unavailable"].map(value => `<option value="${value}">${BOOTH_STATUS[value].label}</option>`).join("")}</select>`)}
        </div>
        <div class="button-row"><button class="button button-primary" type="submit">บันทึกแผง</button><button type="button" class="button button-outline" id="booth-new">+ เพิ่มแผงใหม่</button></div>
      </form>
    </div>
    <section class="card admin-section"><h2>รายการแผงทั้งหมด (${data.length})</h2><div class="admin-list">${data.map(booth => `<div class="admin-row ${booth.status !== "available" ? "is-muted" : ""}"><div><strong>แผง ${escapeHtml(booth.boothCode)}</strong><small>${escapeHtml(positionText(booth))}</small></div><div>${boothBadge(booth.status)}<small>${escapeHtml(formatSize(booth.width, booth.depth))} · ${escapeHtml(formatMoney(booth.price))}/รอบ</small></div><div class="row-actions"><button type="button" class="button button-small button-outline" data-booth-edit="${booth.id}">แก้ไข</button></div></div>`).join("")}</div></section>`;
  const form = $("#booth-form");
  const selectBooth = booth => {
    state.admin.selectedBoothId = booth ? booth.id : null;
    $("#booth-form-title").textContent = booth ? `แก้ไขแผง ${booth.boothCode}` : "เพิ่มแผงใหม่";
    form.elements.boothCode.value = booth?.boothCode || "";
    form.elements.price.value = booth ? Number(booth.price) : "";
    form.elements.width.value = booth?.width ?? "";
    form.elements.depth.value = booth?.depth ?? "";
    form.elements.mapX.value = booth?.mapX ?? "";
    form.elements.mapY.value = booth?.mapY ?? "";
    form.elements.status.value = booth?.status || "available";
    setFormErrors(form, {});
    setAlert($("#booth-alert"), "");
    drawAdminMap();
  };
  const drawAdminMap = () => {
    const x = form.elements.mapX.value;
    const y = form.elements.mapY.value;
    const booths = state.admin.booths.map(booth => ({ ...booth, availability: booth.status, ...(booth.id === state.admin.selectedBoothId && x !== "" && y !== "" ? { mapX: Number(x), mapY: Number(y) } : {}) }));
    if (state.admin.selectedBoothId === null && x !== "" && y !== "") booths.push({ id: 0, boothCode: form.elements.boothCode.value || "ใหม่", mapX: Number(x), mapY: Number(y), price: Number(form.elements.price.value || 0), availability: form.elements.status.value });
    renderMap($("#admin-map"), booths, { mode: "admin", selectedId: state.admin.selectedBoothId ?? 0 });
    applyZoom("admin", state.zoom.admin);
  };
  $("#admin-map").addEventListener("click", event => {
    const pin = event.target.closest("[data-booth-id]");
    if (pin && Number(pin.dataset.boothId)) { selectBooth(state.admin.booths.find(booth => booth.id === Number(pin.dataset.boothId))); form.elements.boothCode.focus(); return; }
    if (pin) return;
    const rect = $("#admin-map").getBoundingClientRect();
    form.elements.mapX.value = (((event.clientX - rect.left) / rect.width) * 100).toFixed(1);
    form.elements.mapY.value = (((event.clientY - rect.top) / rect.height) * 100).toFixed(1);
    drawAdminMap();
  });
  ["mapX", "mapY", "boothCode", "status"].forEach(name => form.elements[name].addEventListener("change", drawAdminMap));
  $("#booth-new").addEventListener("click", () => { selectBooth(null); form.elements.boothCode.focus(); });
  content.querySelectorAll("[data-booth-edit]").forEach(button => button.addEventListener("click", () => {
    selectBooth(state.admin.booths.find(booth => booth.id === Number(button.dataset.boothEdit)));
    form.scrollIntoView({ block: "start" });
    form.elements.boothCode.focus();
  }));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("button[type='submit']", form);
    const number = name => (form.elements[name].value === "" ? null : Number(form.elements[name].value));
    const body = { boothCode: form.elements.boothCode.value.trim(), price: number("price"), width: number("width"), depth: number("depth"), mapX: number("mapX"), mapY: number("mapY"), status: form.elements.status.value };
    const fields = {};
    if (!body.boothCode) fields.boothCode = "กรุณากรอกหมายเลขแผง";
    if (body.price === null || body.price < 0) fields.price = "กรุณากรอกค่าเช่า";
    setFormErrors(form, fields);
    if (Object.keys(fields).length) return;
    setBusy(button, true, "กำลังบันทึก...");
    try {
      const id = state.admin.selectedBoothId;
      const { data: saved } = await api(id ? `/api/v1/admin/booths/${id}` : `/api/v1/admin/markets/${market.id}/booths`, { method: id ? "PATCH" : "POST", body });
      notify(`บันทึกแผง ${saved.boothCode} แล้ว`, "success");
      state.admin.selectedBoothId = saved.id;
      route();
    } catch (error) {
      setFormErrors(form, error.fields);
      if (error.status !== 401) setAlert($("#booth-alert"), error.message);
      setBusy(button, false);
    }
  });
  selectBooth(state.admin.booths.find(booth => booth.id === state.admin.selectedBoothId) || null);
}

async function adminBookings(content, market, params) {
  const options = state.admin.bookings;
  const requested = params?.get("event");
  if (requested) { options.eventId = requested; options.page = 1; }
  const { data: events } = await api(`/api/v1/admin/markets/${market.id}/events?limit=100&fromDate=${todayISO(-60)}`);
  if (!options.eventId && events.length) options.eventId = String((events.find(event => event.eventDate >= todayISO() && event.status !== "cancelled") || events[events.length - 1]).id);
  const query = new URLSearchParams({ page: String(options.page), limit: "20" });
  if (options.eventId) query.set("eventId", options.eventId);
  if (options.status) query.set("status", options.status);
  if (options.q) query.set("q", options.q);
  const { data, pagination } = await api(`/api/v1/admin/bookings?${query}`);
  content.innerHTML = `<div class="tools card">
      <div class="field"><label for="ab-event">รอบตลาด</label><select id="ab-event"><option value="">ทุกรอบ</option>${events.map(event => `<option value="${event.id}">${escapeHtml(formatDate(event.eventDate))}${event.status === "cancelled" ? " (งดตลาด)" : ""}</option>`).join("")}</select></div>
      <div class="field"><label for="ab-status">สถานะ</label><select id="ab-status"><option value="">ทุกสถานะ</option>${Object.entries(BOOKING_STATUS).map(([value, info]) => `<option value="${value}">${info.label}</option>`).join("")}</select></div>
      <div class="field field-grow"><label for="ab-q">ค้นหา</label><input id="ab-q" type="search" maxlength="100" placeholder="ชื่อร้าน หมายเลขแผง หรืออีเมล" value="${escapeHtml(options.q)}"></div>
    </div>
    <p class="result-summary">พบ ${pagination.total} รายการ</p>
    <div class="admin-list">${data.length ? data.map(booking => `<div class="admin-row ${["cancelled", "rejected"].includes(booking.status) ? "is-muted" : ""}">
        <div><strong>แผง ${escapeHtml(booking.booth.boothCode)} · ${escapeHtml(booking.shop.shopName)}</strong><small>${escapeHtml(formatDate(booking.event.eventDate))} · ${escapeHtml(formatMoney(booking.price))} · จองเมื่อ ${escapeHtml(formatDateTime(booking.bookedAt))}</small></div>
        <div>${bookingBadge(booking.status)}<small>${escapeHtml(booking.shop.contactName || "ไม่ระบุผู้ติดต่อ")} · ${booking.shop.contactPhone ? `<a href="tel:${escapeHtml(booking.shop.contactPhone)}">${escapeHtml(booking.shop.contactPhone)}</a>` : "ไม่มีเบอร์"}</small><small>${escapeHtml(booking.shop.email)}</small></div>
        <div class="row-actions">${booking.status === "pending" ? `<button type="button" class="button button-small button-primary" data-booking-action="confirmed" data-booking-id="${booking.id}">อนุมัติ</button>` : ""}${["pending", "confirmed"].includes(booking.status) ? `<button type="button" class="button button-small button-outline" data-booking-action="rejected" data-booking-id="${booking.id}">ปฏิเสธ</button><button type="button" class="button button-small button-danger" data-booking-action="cancelled" data-booking-id="${booking.id}">ยกเลิก</button>` : ""}</div>
      </div>`).join("") : stateBox("empty", "ไม่พบการจองตามตัวกรองนี้", "", "empty-bookings")}</div>
    <nav class="pager" id="admin-pager" aria-label="เปลี่ยนหน้ารายการจอง">${pagerHtml(options.page, pagination.totalPages)}</nav>`;
  $("#ab-event").value = options.eventId;
  $("#ab-status").value = options.status;
  $("#ab-event").addEventListener("change", event => { options.eventId = event.target.value; options.page = 1; go("/admin/bookings"); });
  $("#ab-status").addEventListener("change", event => { options.status = event.target.value; options.page = 1; route(); });
  $("#ab-q").addEventListener("input", event => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => { options.q = event.target.value.trim(); options.page = 1; route(); }, 400); });
  $("#admin-pager").addEventListener("click", event => { const button = event.target.closest("[data-page-to]"); if (button && !button.disabled) { options.page = Number(button.dataset.pageTo); route(); } });
  content.querySelectorAll("[data-booking-action]").forEach(button => button.addEventListener("click", async () => {
    const status = button.dataset.bookingAction;
    const booking = data.find(item => item.id === Number(button.dataset.bookingId));
    const verb = { confirmed: "อนุมัติ", rejected: "ปฏิเสธ", cancelled: "ยกเลิก" }[status];
    const result = await confirmDialog({ title: `${verb}การจองแผง ${booking.booth.boothCode}?`, body: `<p>${escapeHtml(booking.shop.shopName)} · ${escapeHtml(formatDate(booking.event.eventDate))}</p>${status !== "confirmed" ? "<p>แผงจะว่างให้ร้านอื่นจองได้ และร้านจะเห็นสถานะใหม่ในหน้าการจองของร้าน</p>" : ""}`, okText: verb, danger: status !== "confirmed" });
    if (!result.ok) return;
    try {
      await api(`/api/v1/admin/bookings/${booking.id}/status`, { method: "POST", body: { status } });
      notify(`${verb}การจองแผง ${booking.booth.boothCode} แล้ว`, "success");
    } catch (error) { if (error.status !== 401) notify(error.message, "error"); }
    route();
  }));
  if (options.q) { const input = $("#ab-q"); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
}

async function adminShops(content) {
  const options = state.admin.shops;
  const query = new URLSearchParams({ page: String(options.page), limit: "20" });
  if (options.q) query.set("q", options.q);
  if (options.status) query.set("status", options.status);
  const { data, pagination } = await api(`/api/v1/admin/shops?${query}`);
  content.innerHTML = `<div class="tools card">
      <div class="field field-grow"><label for="as-q">ค้นหาร้าน</label><input id="as-q" type="search" maxlength="100" placeholder="ชื่อร้าน อีเมล ประเภท หรือเบอร์" value="${escapeHtml(options.q)}"></div>
      <div class="field"><label for="as-status">สถานะบัญชี</label><select id="as-status"><option value="">ทั้งหมด</option><option value="active">ใช้งาน</option><option value="disabled">ปิดใช้งาน</option></select></div>
    </div>
    <p class="result-summary">พบ ${pagination.total} ร้าน</p>
    <div class="admin-list">${data.length ? data.map(shop => `<div class="admin-row ${shop.isActive ? "" : "is-muted"}">
        <div class="shop-row-link" style="padding:0"><img class="shop-avatar" src="${escapeHtml(shopImage(shop.imageUrl))}" alt="" width="52" height="52" loading="lazy"><span class="shop-info"><strong>${escapeHtml(shop.shopName)}</strong><small>${escapeHtml(shop.category || "ไม่ระบุประเภท")} · จองรอบที่จะถึง ${shop.upcomingBookings} · ทั้งหมด ${shop.totalBookings}</small></span></div>
        <div><small>${escapeHtml(shop.contactName || "ไม่ระบุผู้ติดต่อ")} · ${escapeHtml(shop.contactPhone || shop.phone || "ไม่มีเบอร์")}</small><small>${escapeHtml(shop.email)}</small></div>
        <div class="row-actions">${shop.role === "admin" ? '<span class="badge badge-lavender">ผู้ดูแล</span>' : ""}${shop.isActive ? '<span class="badge badge-success">ใช้งาน</span>' : '<span class="badge badge-muted">ปิดใช้งาน</span>'}${shop.userId === state.user.id ? "" : `<button type="button" class="button button-small ${shop.isActive ? "button-outline" : "button-primary"}" data-shop-toggle="${shop.id}" data-active="${shop.isActive}">${shop.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}</button>`}</div>
      </div>`).join("") : stateBox("empty", "ไม่พบร้านตามเงื่อนไขนี้", "", "empty-shops")}</div>
    <nav class="pager" id="admin-pager" aria-label="เปลี่ยนหน้ารายชื่อร้าน">${pagerHtml(options.page, pagination.totalPages)}</nav>`;
  $("#as-status").value = options.status;
  $("#as-status").addEventListener("change", event => { options.status = event.target.value; options.page = 1; route(); });
  $("#as-q").addEventListener("input", event => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => { options.q = event.target.value.trim(); options.page = 1; route(); }, 400); });
  $("#admin-pager").addEventListener("click", event => { const button = event.target.closest("[data-page-to]"); if (button && !button.disabled) { options.page = Number(button.dataset.pageTo); route(); } });
  content.querySelectorAll("[data-shop-toggle]").forEach(button => button.addEventListener("click", async () => {
    const shop = data.find(item => item.id === Number(button.dataset.shopToggle));
    const enable = !shop.isActive;
    const result = await confirmDialog({ title: `${enable ? "เปิด" : "ปิด"}ใช้งานร้าน ${shop.shopName}?`, body: enable ? "<p>ร้านจะเข้าสู่ระบบและจองแผงได้อีกครั้ง</p>" : "<p>ร้านจะถูกออกจากระบบทันทีและเข้าสู่ระบบไม่ได้ การจองเดิมยังคงอยู่ (ยกเลิกได้ที่แท็บการจอง)</p>", okText: enable ? "เปิดใช้งาน" : "ปิดใช้งาน", danger: !enable });
    if (!result.ok) return;
    try {
      await api(`/api/v1/admin/shops/${shop.id}`, { method: "PATCH", body: { isActive: enable } });
      notify(`${enable ? "เปิด" : "ปิด"}ใช้งานร้าน ${shop.shopName} แล้ว`, "success");
    } catch (error) { if (error.status !== 401) notify(error.message, "error"); }
    route();
  }));
  if (options.q) { const input = $("#as-q"); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
}

async function adminMarket(content, market) {
  content.innerHTML = `<form class="card form-card" id="market-form" novalidate>
      <h2>ข้อมูลตลาดที่ลูกค้าเห็น</h2>
      <div class="form-alert" id="market-alert" role="alert" hidden></div>
      ${field("marketName", "ชื่อตลาด *", `<input type="text" maxlength="150" value="${escapeHtml(market.marketName)}" required>`)}
      ${field("address", "สถานที่ / ที่อยู่", `<input type="text" maxlength="500" value="${escapeHtml(market.address || "")}">`, "ใช้แสดงบนหน้าแผนผังและปุ่มนำทางไปตลาด")}
      <div class="form-grid">
        ${field("openTime", "เวลาเปิดปกติ", `<input type="time" value="${(market.openTime || "").slice(0, 5)}">`)}
        ${field("closeTime", "เวลาปิดปกติ", `<input type="time" value="${(market.closeTime || "").slice(0, 5)}">`)}
      </div>
      ${field("description", "คำอธิบายตลาด", `<textarea rows="4" maxlength="2000">${escapeHtml(market.description || "")}</textarea>`)}
      <label class="check"><input type="checkbox" name="isActive" ${market.isActive ? "checked" : ""}> เปิดแสดงตลาดนี้ให้ลูกค้าและร้านค้าเห็น</label>
      <button class="button button-primary" type="submit">บันทึกข้อมูลตลาด</button>
    </form>`;
  $("#market-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("button[type='submit']", form);
    const values = Object.fromEntries(new FormData(form));
    const body = { marketName: values.marketName.trim(), address: values.address.trim() || null, openTime: values.openTime || null, closeTime: values.closeTime || null, description: values.description.trim() || null, isActive: form.elements.isActive.checked };
    if (!body.marketName) { setFormErrors(form, { marketName: "กรุณากรอกชื่อตลาด" }); return; }
    setFormErrors(form, {});
    setBusy(button, true, "กำลังบันทึก...");
    try {
      const { data } = await api(`/api/v1/admin/markets/${market.id}`, { method: "PATCH", body });
      state.admin.market = data;
      state.market = null;
      state.markets = [];
      setAlert($("#market-alert"), "บันทึกข้อมูลตลาดเรียบร้อยแล้ว", "success");
      notify("บันทึกข้อมูลตลาดเรียบร้อยแล้ว", "success");
    } catch (error) {
      setFormErrors(form, error.fields);
      if (error.status !== 401) setAlert($("#market-alert"), error.message);
    } finally { setBusy(button, false); }
  });
}

// ---------- Events ----------
function bindEvents() {
  $("#skip-link").addEventListener("click", event => { event.preventDefault(); $("#app").focus(); });
  $("#menu-toggle").addEventListener("click", () => {
    const open = !$("#main-nav").classList.contains("is-open");
    $("#main-nav").classList.toggle("is-open", open);
    $("#menu-toggle").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", async event => {
    if (event.target.closest("[data-retry]")) { state.customer.loaded = false; route(); }
    if (event.target.closest("[data-logout]")) logout();
    const toggle = event.target.closest("[data-toggle-password]");
    if (toggle) {
      const input = document.getElementById(toggle.dataset.togglePassword);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      toggle.textContent = show ? "ซ่อน" : "แสดง";
      toggle.setAttribute("aria-pressed", String(show));
    }
    const zoom = event.target.closest("[data-zoom]");
    if (zoom) {
      const name = zoom.closest("[data-zoom-for]").dataset.zoomFor;
      const delta = Number(zoom.dataset.zoom);
      applyZoom(name, delta === 0 ? 0 : Math.max(0, Math.min(ZOOM_STEPS.length - 1, state.zoom[name] + delta)));
    }
    const plan = event.target.closest("[data-plan-shop]");
    if (plan) {
      togglePlan(Number(plan.dataset.planShop), plan.dataset.planName);
      if (currentRoute().path === "/") renderCustomerResults();
      else $$("[data-plan-shop]").forEach(button => { button.outerHTML = planToggleButton(Number(button.dataset.planShop), button.dataset.planName); });
    }
    const copy = event.target.closest("[data-qr-copy]");
    if (copy) {
      try { await navigator.clipboard.writeText($(copy.dataset.qrCopy).href); notify("คัดลอกลิงก์แล้ว", "success"); }
      catch { notify("คัดลอกไม่สำเร็จ กรุณากดค้างที่ลิงก์เพื่อคัดลอกเอง", "error"); }
    }
    if (event.target.closest("[data-qr-print]")) { document.body.classList.add("print-qr"); window.print(); }
  });
  window.addEventListener("afterprint", () => document.body.classList.remove("print-qr"));
  $("#login-form").addEventListener("submit", submitLogin);
  $("#register-form").addEventListener("submit", submitRegister);
  $("#profile-form").addEventListener("submit", submitProfile);
  $("#photo-input").addEventListener("change", uploadPhoto);
  $("#photo-remove").addEventListener("click", removePhoto);

  $("#hero-map-link").addEventListener("click", event => { event.preventDefault(); $("#market-section").scrollIntoView({ behavior: "smooth" }); });
  $("#customer-event").addEventListener("change", async event => {
    const eventId = toPositiveInt(event.target.value);
    $("#customer-map").innerHTML = stateBox("loading", "กำลังโหลดแผนผังรอบที่เลือก...");
    try {
      await loadCustomerMap(eventId);
      history.replaceState(null, "", `/?market=${state.market.id}${eventId ? `&event=${eventId}` : ""}${location.hash}`);
    } catch (error) { $("#customer-map").innerHTML = stateBox("error", error.message, retryButton); }
  });
  $("#shop-search").addEventListener("input", () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(loadCustomerShops, 300); });
  $("#category-filter").addEventListener("change", loadCustomerShops);
  $("#category-chips").addEventListener("click", event => {
    const chip = event.target.closest("[data-category]");
    if (!chip) return;
    $("#category-filter").value = chip.dataset.category;
    loadCustomerShops();
  });
  $$("[data-customer-view]").forEach(button => button.addEventListener("click", () => setCustomerView(button.dataset.customerView)));
  $("#customer-map").addEventListener("click", event => {
    const pin = event.target.closest("[data-booth-id]");
    if (!pin) return;
    if (pin.dataset.shopId) go(`/store/${pin.dataset.shopId}${state.customer.eventId ? `?event=${state.customer.eventId}` : ""}`);
    else notify(`${pin.getAttribute("aria-label")} ในรอบนี้`);
  });
  $("#plan-route").addEventListener("change", renderCustomerResults);
  $("#plan-clear").addEventListener("click", async () => {
    const result = await confirmDialog({ title: "ล้างแผนเดินตลาด?", body: "<p>ร้านทั้งหมดในแผนจะถูกนำออก</p>", okText: "ล้างแผน", danger: true });
    if (!result.ok) return;
    writePlan([]);
    renderCustomerResults();
  });
  $("#qr-fixed-event").addEventListener("change", renderMarketQr);

  $("#booth-market").addEventListener("change", async event => {
    state.booths.marketId = Number(event.target.value);
    try { await loadBoothEvents(null); } catch (error) { $("#booth-list").innerHTML = stateBox("error", error.message, retryButton); }
  });
  $("#booth-event").addEventListener("change", event => { state.booths.eventId = Number(event.target.value); loadBooths(); });
  $("#booth-status").addEventListener("change", renderBooths);
  $$("[data-booth-view]").forEach(button => button.addEventListener("click", () => setBoothView(button.dataset.boothView)));
  $("#booth-map").addEventListener("click", event => {
    const pin = event.target.closest("[data-booth-id]");
    if (pin && !pin.disabled) go(`/confirm?market=${state.booths.marketId}&event=${state.booths.eventId}&booth=${pin.dataset.boothId}`);
  });

  [["#bookings-time", "time"], ["#bookings-status", "status"], ["#bookings-order", "order"]].forEach(([selector, key]) => {
    $(selector).addEventListener("change", event => { state.bookings[key] = event.target.value; state.bookings.page = 1; loadBookings(); });
  });
  $("#bookings-pager").addEventListener("click", event => {
    const button = event.target.closest("[data-page-to]");
    if (!button || button.disabled) return;
    state.bookings.page = Number(button.dataset.pageTo);
    loadBookings();
    $("#booking-list").scrollIntoView({ block: "start" });
  });
  window.addEventListener("hashchange", route);
}

async function init() {
  bindEvents();
  await loadSession();
  if (!location.hash) history.replaceState(null, "", `${location.pathname}${location.search}#/`);
  route();
}
init();
