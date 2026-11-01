const TIME_ZONE = "Asia/Bangkok";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^(0\d{8,9}|\+66\d{8,9})$/;
const PHONE_MESSAGE = "เบอร์โทรต้องเป็นตัวเลข 9–10 หลักขึ้นต้นด้วย 0 เช่น 0812345678";
const ZOOM_STEPS = [1, 1.5, 2, 2.5];
const PLACEHOLDER_IMAGE = "/images/shop-placeholder.svg";
// Rough box around Tak province; used to frame the map and to sanity-check coordinates before the server does.
const TAK_BOUNDS = [[15.55, 97.85], [17.8, 99.45]];
const TAK_LIMITS = { lat: [15, 18], lng: [97.3, 99.8] };
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
const MARKET_TYPES = {
  weekly: { label: "ตลาดนัด", icon: "🛒", tone: "mint" },
  morning: { label: "ตลาดเช้า / ตลาดสด", icon: "🌅", tone: "butter" },
  evening: { label: "ตลาดเย็น", icon: "🌇", tone: "peach" },
  walking_street: { label: "ถนนคนเดิน", icon: "🚶", tone: "lavender" },
  border: { label: "ตลาดชายแดน", icon: "🌉", tone: "sky" },
  community: { label: "ตลาดชุมชน", icon: "🏡", tone: "sage" }
};
const DAY_NAMES = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const ADMIN_TABS = { overview: "ภาพรวมจังหวัด", markets: "ตลาดทั้งหมด", events: "รอบตลาด", booths: "แผงและผัง", bookings: "การจองทั้งหมด", shops: "ร้านค้า", market: "ข้อมูลตลาด", audit: "ประวัติการทำงาน" };
const AUDIT_LABELS = {
  "auth.registered": "สมัครสมาชิก", "auth.login": "เข้าสู่ระบบ", "auth.login_failed": "เข้าสู่ระบบไม่สำเร็จ", "auth.logout": "ออกจากระบบ",
  "booking.created": "จองแผง", "booking.cancelled": "ร้านยกเลิกการจอง",
  "shop.profile_updated": "แก้ไขข้อมูลร้าน", "shop.image_updated": "อัปโหลดรูปร้าน", "shop.image_removed": "ลบรูปร้าน",
  "admin.market_created": "เพิ่มตลาด", "admin.market_updated": "แก้ไขข้อมูลตลาด", "admin.events_created": "เพิ่มรอบตลาด", "admin.event_updated": "แก้ไขรอบตลาด",
  "admin.booth_created": "เพิ่มแผง", "admin.booth_updated": "แก้ไขแผง", "admin.booking_status": "เปลี่ยนสถานะการจอง", "admin.shop_status": "เปิด/ปิดใช้งานร้าน", "admin.bookings_exported": "ส่งออกรายการจอง"
};

const state = {
  user: null,
  shop: null,
  reference: { districts: null, categories: null },
  markets: [],
  market: null,
  province: { loaded: false, markets: [], products: null, total: 0, page: 1, filters: { q: "", districtId: "", type: "", openOn: "" }, near: null, map: null, layer: null, youMarker: null, requestId: 0, fit: true },
  customer: { eventId: null, map: null, shops: [], view: "map", loaded: false, requestId: 0 },
  locationMap: null,
  booths: { districtId: "", marketId: null, eventId: null, events: [], items: [], view: "list" },
  bookings: { page: 1, time: "upcoming", status: "", order: "asc" },
  admin: { markets: null, marketId: null, market: null, eventsFilter: "upcoming", booths: [], selectedBoothId: null, bookings: { scope: "market", eventId: "", status: "", q: "", page: 1 }, shops: { q: "", status: "", categoryId: "", page: 1 }, marketsFilter: { districtId: "", q: "" }, audit: { group: "", page: 1 }, pinMap: null },
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
const leafletReady = () => typeof window.L === "object" && typeof window.L.map === "function";

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

// Districts and product categories rarely change, so they are loaded once per visit.
async function loadReference() {
  if (state.reference.districts && state.reference.categories) return state.reference;
  const [districts, categories] = await Promise.all([api("/api/v1/districts"), api("/api/v1/categories")]);
  state.reference.districts = districts.data;
  state.reference.categories = categories.data;
  fillCategorySelects();
  return state.reference;
}
function fillCategorySelects() {
  $$("[data-category-select]").forEach(select => {
    const value = select.value;
    const first = select.options[0]?.outerHTML || '<option value="">ไม่ระบุ</option>';
    select.innerHTML = first + (state.reference.categories || []).map(category => `<option value="${category.id}">${escapeHtml(`${category.icon || ""} ${category.name}`.trim())}</option>`).join("");
    select.value = value;
  });
}

// ---------- Formatting ----------
const dateFormatter = new Intl.DateTimeFormat("th-TH", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDateFormatter = new Intl.DateTimeFormat("th-TH", { timeZone: TIME_ZONE, day: "numeric", month: "short", year: "2-digit" });
const weekdayDateFormatter = new Intl.DateTimeFormat("th-TH", { timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short" });
const dateTimeFormatter = new Intl.DateTimeFormat("th-TH", { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
function todayISO(offsetDays = 0) { return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(Date.now() + offsetDays * 86400000)); }
function dateFromISO(value) { return new Date(`${value}T12:00:00+07:00`); }
function addDaysISO(value, days) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function formatDate(value) { return value ? dateFormatter.format(dateFromISO(value)) : "-"; }
function formatShortDate(value) { return value ? shortDateFormatter.format(dateFromISO(value)) : "-"; }
function formatDayDate(value) {
  if (!value) return "-";
  if (value === todayISO()) return "วันนี้";
  if (value === todayISO(1)) return "พรุ่งนี้";
  return weekdayDateFormatter.format(dateFromISO(value));
}
function formatDateTime(value) { return value ? `${dateTimeFormatter.format(new Date(value))} น.` : "-"; }
function formatTimeRange(open, close) {
  const start = open ? open.slice(0, 5) : "";
  const end = close ? close.slice(0, 5) : "";
  if (start && end) return `${start}–${end} น.`;
  return start ? `เปิด ${start} น.` : "ไม่ระบุเวลา";
}
function formatDays(days) {
  if (!days?.length) return "ไม่ระบุวันเปิด";
  if (days.length === 7) return "ทุกวัน";
  if (days.join(",") === "0,6") return "เสาร์–อาทิตย์";
  if (days.join(",") === "1,2,3,4,5") return "จันทร์–ศุกร์";
  return days.map(day => `วัน${DAY_NAMES[day]}`).join(" · ");
}
function formatMoney(value) { return `${Number(value || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`; }
function formatSize(width, depth) { return width && depth ? `${Number(width)} × ${Number(depth)} เมตร` : "ไม่ระบุขนาด"; }
function marketType(type) { return MARKET_TYPES[type] || MARKET_TYPES.weekly; }
function districtLabel(market) { return market?.district?.name ? `อ.${market.district.name}` : market?.districtName ? `อ.${market.districtName}` : ""; }
function positionText(booth) {
  const zone = booth.zone ? `${booth.zone} · ` : /^[A-Za-z]/.test(booth.boothCode || "") ? `โซน ${booth.boothCode[0].toUpperCase()} · ` : "";
  if (booth.mapX == null || booth.mapY == null) return `${zone}ไม่ระบุตำแหน่ง`;
  const side = booth.mapX < 45 ? "ฝั่งซ้าย" : booth.mapX > 55 ? "ฝั่งขวา" : "กลางตลาด";
  const row = booth.mapY < 50 ? "แถวด้านใน" : "แถวใกล้ทางเข้า";
  return `${zone}${side} ${row}`;
}
function amenities(booth) {
  const items = [booth.hasElectricity && "⚡ มีไฟฟ้า", booth.hasRoof && "⛱ มีหลังคา"].filter(Boolean);
  return items.length ? items.join(" · ") : "ลานโล่ง ไม่มีไฟฟ้า";
}
function eventLabel(event) {
  const past = event.eventDate < todayISO() ? " (ผ่านไปแล้ว)" : "";
  return `${formatDate(event.eventDate)} · ${event.eventName}${past}`;
}
function navigationUrl(market) {
  if (market.latitude != null && market.longitude != null) return `https://www.google.com/maps/dir/?api=1&destination=${market.latitude},${market.longitude}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${market.marketName} ${market.address || ""} จังหวัดตาก`.trim())}`;
}

// ---------- UI helpers ----------
function notify(message, tone = "info") {
  const toast = $("#toast");
  const icon = { success: "✓", error: "!", info: "ℹ", warning: "⚠" }[tone] || "ℹ";
  toast.className = `toast toast-${tone} is-visible`;
  toast.innerHTML = `<span class="toast-icon" aria-hidden="true">${icon}</span><span>${escapeHtml(message)}</span>`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 5000);
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
function typeBadge(type) {
  const info = marketType(type);
  return `<span class="badge badge-type tone-${info.tone}"><span aria-hidden="true">${info.icon}</span> ${escapeHtml(info.label)}</span>`;
}
function shopImage(url) { return url || PLACEHOLDER_IMAGE; }
function setFormErrors(form, fields = {}) {
  $$("[data-error-for]", form).forEach(element => {
    const message = fields[element.dataset.errorFor] || "";
    element.textContent = message;
    const input = form.elements.namedItem(element.dataset.errorFor);
    if (input instanceof Element && message) input.setAttribute("aria-invalid", "true");
    else if (input instanceof Element) input.removeAttribute("aria-invalid");
  });
  const first = Object.keys(fields).map(name => form.elements.namedItem(name)).find(item => item instanceof Element);
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
function districtOptions(selected = "", { allLabel = "ทุกอำเภอ", withCount = false } = {}) {
  return `<option value="">${escapeHtml(allLabel)}</option>` + (state.reference.districts || []).map(district => `<option value="${district.id}" ${String(district.id) === String(selected) ? "selected" : ""}>อ.${escapeHtml(district.name)}${withCount ? ` (${district.marketCount})` : ""}</option>`).join("");
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

// ---------- Geographic map (Leaflet + OpenStreetMap) ----------
function createGeoMap(element, options = {}) {
  const map = window.L.map(element, { scrollWheelZoom: false, zoomSnap: 0.5, ...options });
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
  // Leaflet measures its box once; pages that were hidden or re-flowed after fonts load need a re-measure.
  if (typeof ResizeObserver === "function") new ResizeObserver(() => map.invalidateSize()).observe(element);
  return map;
}
function marketIcon(type, highlight = false) {
  const info = marketType(type);
  return window.L.divIcon({ className: "market-marker", html: `<span class="marker-pin tone-${info.tone}${highlight ? " is-today" : ""}"><span aria-hidden="true">${info.icon}</span></span>`, iconSize: [44, 52], iconAnchor: [22, 50], popupAnchor: [0, -46], tooltipAnchor: [16, -30] });
}
function geoFallback(element, message) {
  element.classList.add("is-fallback");
  element.innerHTML = stateBox("empty", message);
}

// ---------- Floor plan ----------
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
  // The canvas grows with the number of booth columns and rows, so pins never overlap at 100%.
  const positions = booths.map(pinPosition);
  const cols = Math.min(14, new Set(positions.map(point => Math.round(point.x))).size);
  const rows = Math.min(12, new Set(positions.map(point => Math.round(point.y))).size);
  const width = Math.max(620, cols * 112);
  const height = Math.max(388, rows * 84 + 96);
  canvas.style.setProperty("--map-min", `${width}px`);
  canvas.style.setProperty("--map-ratio", `${width} / ${height}`);
  const decor = '<span class="map-walkway map-walkway-h" aria-hidden="true"><span>ทางเดิน</span></span><span class="map-walkway map-walkway-v" aria-hidden="true"></span><span class="map-entrance" aria-hidden="true">⬇ ทางเข้าตลาด</span>';
  const routeSvg = route && route.length ? `<svg class="map-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${[{ x: 50, y: 97 }, ...route].map(point => `${point.x},${point.y}`).join(" ")}"/></svg>` : "";
  canvas.innerHTML = decor + routeSvg + booths.map((booth, index) => {
    const { x, y } = positions[index];
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
  { pattern: /^\/$/, page: "province", title: "ตลาดนัดทั่วจังหวัดตาก", render: renderProvincePage },
  { pattern: /^\/market\/(\d+)$/, page: "market", title: "แผนผังตลาด", render: renderMarketPage },
  { pattern: /^\/store\/(\d+)$/, page: "store", title: "รายละเอียดร้านค้า", render: renderStorePage },
  { pattern: /^\/login$/, page: "login", title: "เข้าสู่ระบบร้านค้า", render: renderLoginPage, guest: true },
  { pattern: /^\/register$/, page: "register", title: "สมัครสมาชิกร้านค้า", render: renderRegisterPage, guest: true },
  { pattern: /^\/dashboard$/, page: "dashboard", title: "หน้าหลักร้านค้า", render: renderDashboard, shop: true },
  { pattern: /^\/booths$/, page: "booths", title: "เลือกแผง", render: renderBoothsPage, shop: true },
  { pattern: /^\/confirm$/, page: "confirm", title: "ยืนยันการจอง", render: renderConfirmPage, shop: true },
  { pattern: /^\/bookings$/, page: "bookings", title: "การจองของฉัน", render: renderBookingsPage, shop: true },
  { pattern: /^\/bookings\/(\d+)$/, page: "booking", title: "รายละเอียดการจอง", render: renderBookingPage, shop: true },
  { pattern: /^\/profile$/, page: "profile", title: "ข้อมูลร้าน", render: renderProfilePage, shop: true },
  { pattern: /^\/admin(?:\/(markets|events|booths|bookings|shops|market|audit))?$/, page: "admin", title: "ผู้ดูแลตลาด", render: renderAdminPage, admin: true }
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
  if (["market", "province"].includes(previous)) state.marketScroll = window.scrollY;
  const page = found ? found.page : "notfound";
  // Keep the customer's search and scroll only for the map ↔ shop detail round trip; elsewhere bookings may have changed.
  if (!["market", "store", "province"].includes(page)) { state.customer.loaded = false; state.province.loaded = false; }
  $$("[data-page]").forEach(section => { section.hidden = section.dataset.page !== page; });
  document.title = `${found ? found.title : "ไม่พบหน้า"} | ตากหลาดนัด`;
  renderNav(path);
  window.scrollTo(0, 0);
  if (found) {
    try { await found.render(params, match[1]); }
    catch (error) { console.error(error); notify("เกิดข้อผิดพลาดในการแสดงหน้า กรุณาลองใหม่", "error"); }
  }
  if (["market", "province"].includes(page) && previous === "store") window.scrollTo(0, state.marketScroll);
  if (!state.firstRoute) $(`[data-page="${page}"] .page-title`)?.focus({ preventScroll: ["market", "province"].includes(page) });
  state.firstRoute = false;
}

function renderNav(path) {
  const links = [["/", "ตลาดทั่วจังหวัด"]];
  if (state.shop) links.push(["/dashboard", "หน้าหลักร้าน"], ["/booths", "จองแผง"], ["/bookings", "การจองของฉัน"], ["/profile", "ข้อมูลร้าน"]);
  if (isAdmin()) links.push(["/admin", "ผู้ดูแลตลาด"]);
  if (!state.user) links.push(["/register", "สมัครร้านค้า"]);
  const current = href => (href === "/" ? path === "/" || path.startsWith("/market/") || path.startsWith("/store") : path === href || path.startsWith(`${href}/`) || (href === "/booths" && path === "/confirm"));
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
  state.admin.markets = null;
  notify("ออกจากระบบเรียบร้อยแล้ว", "success");
  go("/");
}

// ---------- Customer: every market in the province ----------
async function renderProvincePage(params) {
  const province = state.province;
  const filters = province.filters;
  const requestedDistrict = toPositiveInt(params.get("district"));
  if (requestedDistrict && String(requestedDistrict) !== filters.districtId) { filters.districtId = String(requestedDistrict); province.loaded = false; province.fit = true; }
  try {
    await loadReference();
    fillProvinceFilters();
    ensureProvinceMap();
    if (province.loaded) { renderProvinceResults(); province.map?.invalidateSize(); return; }
    loadProvinceStats();
    await loadProvinceMarkets();
    province.loaded = true;
  } catch (error) {
    $("#market-list").innerHTML = stateBox("error", error.message, retryButton);
    $("#province-summary").textContent = "";
  }
}
function fillProvinceFilters() {
  const filters = state.province.filters;
  if (!$("#province-type").dataset.ready) {
    $("#province-type").innerHTML = '<option value="">ทุกประเภท</option>' + Object.entries(MARKET_TYPES).map(([value, info]) => `<option value="${value}">${info.icon} ${info.label}</option>`).join("");
    $("#province-type").dataset.ready = "1";
    $("#market-type-legend").innerHTML = Object.values(MARKET_TYPES).map(info => `<li><i class="legend-swatch legend-type tone-${info.tone}" aria-hidden="true">${info.icon}</i> ${info.label}</li>`).join("") + '<li><i class="legend-swatch legend-type is-today" aria-hidden="true">●</i> เปิดวันนี้</li>';
  }
  $("#province-district").innerHTML = districtOptions(filters.districtId, { withCount: true });
  $("#province-search").value = filters.q;
  $("#province-type").value = filters.type;
  $("#province-day").value = filters.openOn;
  $("#district-chips").innerHTML = [{ id: "", name: "ทั้งจังหวัด" }, ...state.reference.districts.filter(district => district.marketCount)].map(district => `<button type="button" class="category-chip" data-district="${district.id}" aria-pressed="${String(district.id) === filters.districtId}">${district.id ? `อ.${escapeHtml(district.name)}` : escapeHtml(district.name)}</button>`).join("");
}
function ensureProvinceMap() {
  const element = $("#province-map");
  if (state.province.map || element.classList.contains("is-fallback")) return;
  if (!leafletReady()) { geoFallback(element, "แผนที่ยังโหลดไม่ได้ (ต้องเชื่อมต่ออินเทอร์เน็ต) ดูรายชื่อตลาดด้านข้างแทนได้"); return; }
  const map = createGeoMap(element, { minZoom: 7 });
  map.fitBounds(TAK_BOUNDS);
  state.province.map = map;
  state.province.layer = window.L.featureGroup().addTo(map);
}
async function loadProvinceStats() {
  try {
    const [all, today] = await Promise.all([api("/api/v1/markets?limit=1"), api("/api/v1/markets?limit=1&openOn=today")]);
    const items = $$("#province-stats strong");
    items[0].textContent = String(all.pagination.total);
    items[1].textContent = String(state.reference.districts.filter(district => district.marketCount).length);
    items[2].textContent = String(today.pagination.total);
  } catch { /* the stats are decoration; the list below shows its own error */ }
}
async function loadProvinceMarkets() {
  const province = state.province;
  const filters = province.filters;
  const requestId = ++province.requestId;
  const query = new URLSearchParams({ limit: "24", page: String(province.page) });
  if (filters.q) query.set("q", filters.q);
  if (filters.districtId) query.set("districtId", filters.districtId);
  if (filters.type) query.set("type", filters.type);
  if (filters.openOn) query.set("openOn", filters.openOn);
  if (province.near) { query.set("lat", province.near.lat.toFixed(5)); query.set("lng", province.near.lng.toFixed(5)); }
  $("#market-list").setAttribute("aria-busy", "true");
  if (!province.markets.length) $("#market-list").innerHTML = stateBox("loading", "กำลังโหลดรายชื่อตลาด...");
  try {
    const productQuery = filters.q ? new URLSearchParams({ q: filters.q, limit: "30", ...(filters.districtId ? { districtId: filters.districtId } : {}) }) : null;
    const [markets, products] = await Promise.all([api(`/api/v1/markets?${query}`), productQuery ? api(`/api/v1/public/search?${productQuery}`) : null]);
    if (requestId !== province.requestId) return;
    province.markets = markets.data;
    province.total = markets.pagination.total;
    province.totalPages = markets.pagination.totalPages;
    province.products = products;
    renderProvinceResults();
  } catch (error) {
    if (requestId !== province.requestId) return;
    province.loaded = false;
    $("#market-list").innerHTML = stateBox("error", error.message, retryButton);
  } finally { $("#market-list").removeAttribute("aria-busy"); }
}
function marketCard(market) {
  const info = marketType(market.marketType);
  const next = market.nextEvent;
  const openToday = next?.eventDate === todayISO();
  return `<article class="market-card" data-market-card="${market.id}">
      <div class="market-card-head"><span class="market-icon tone-${info.tone}" aria-hidden="true">${info.icon}</span><div class="market-card-title"><h4><a href="#/market/${market.id}">${escapeHtml(market.marketName)}</a></h4><p>${escapeHtml(districtLabel(market))}${market.subdistrict ? ` · ต.${escapeHtml(market.subdistrict)}` : ""} · ${escapeHtml(info.label)}</p></div>${market.distanceKm != null ? `<span class="badge badge-info">${escapeHtml(market.distanceKm.toLocaleString("th-TH"))} กม.</span>` : ""}</div>
      <p class="market-when"><span>🔁 ${escapeHtml(formatDays(market.openDays))}</span><span>🕘 ${escapeHtml(formatTimeRange(market.openTime, market.closeTime))}</span></p>
      <p class="market-next">${next ? `${openToday ? '<span class="badge badge-success">● เปิดวันนี้</span>' : `<span class="badge badge-muted">รอบถัดไป ${escapeHtml(formatDayDate(next.eventDate))}</span>`} <span>ร้านยืนยันแล้ว ${next.shopCount} จาก ${market.boothCount} แผง</span>` : '<span class="badge badge-muted">ยังไม่มีรอบที่กำหนด</span>'}</p>
      <div class="market-card-actions"><a class="button button-small button-primary" href="#/market/${market.id}">ดูผังร้าน</a>${market.latitude != null && state.province.map ? `<button type="button" class="button button-small button-outline" data-locate-market="${market.id}">ดูบนแผนที่</button>` : ""}</div>
    </article>`;
}
function renderProvinceResults() {
  const province = state.province;
  const filters = province.filters;
  const markets = province.markets;
  const filtering = Boolean(filters.q || filters.districtId || filters.type || filters.openOn);
  const district = state.reference.districts?.find(item => String(item.id) === filters.districtId);
  const parts = [district ? `อ.${district.name}` : "ทั้งจังหวัด", filters.type ? marketType(filters.type).label : "", { today: "เปิดวันนี้", tomorrow: "เปิดพรุ่งนี้", weekend: "เปิดเสาร์–อาทิตย์นี้" }[filters.openOn] || "", filters.q ? `“${filters.q}”` : ""].filter(Boolean);
  $("#province-summary").textContent = province.total ? `พบ ${province.total} ตลาด · ${parts.join(" · ")}${province.near ? " · เรียงจากใกล้ที่สุด" : ""}` : `ไม่พบตลาดตามเงื่อนไข ${parts.join(" · ")}`;
  $("#market-count").textContent = String(province.total);
  $("#market-list").innerHTML = markets.length ? markets.map(marketCard).join("") : stateBox("empty", filtering ? "ไม่พบตลาดตามเงื่อนไขนี้ ลองเลือก “ทุกอำเภอ” หรือ “ทุกวัน”" : "ยังไม่มีข้อมูลตลาดในระบบ", filtering ? '<button type="button" class="button button-outline" id="province-reset">ล้างตัวกรอง</button>' : "", "empty-shops");
  $("#market-pager").innerHTML = pagerHtml(province.page, province.totalPages || 0);
  $$("#district-chips [data-district]").forEach(chip => chip.setAttribute("aria-pressed", String(chip.dataset.district === filters.districtId)));
  $("#province-near").setAttribute("aria-pressed", String(Boolean(province.near)));
  $("#province-near").textContent = province.near ? "✓ เรียงตามระยะทาง" : "📍 ใกล้ฉัน";
  renderProvinceMarkers();
  renderProductResults();
}
function renderProvinceMarkers() {
  const province = state.province;
  if (!province.map) return;
  province.layer.clearLayers();
  const today = todayISO();
  for (const market of province.markets) {
    if (market.latitude == null || market.longitude == null) continue;
    const next = market.nextEvent;
    const marker = window.L.marker([market.latitude, market.longitude], { icon: marketIcon(market.marketType, next?.eventDate === today), title: market.marketName, alt: market.marketName, riseOnHover: true, marketId: market.id });
    marker.bindTooltip(market.marketName, { direction: "top" });
    marker.bindPopup(`<div class="map-popup"><strong>${escapeHtml(market.marketName)}</strong><span>${escapeHtml(districtLabel(market))} · ${escapeHtml(marketType(market.marketType).label)}</span><span>🔁 ${escapeHtml(formatDays(market.openDays))} · ${escapeHtml(formatTimeRange(market.openTime, market.closeTime))}</span>${next ? `<span>รอบถัดไป ${escapeHtml(formatDayDate(next.eventDate))} · ${next.shopCount} ร้าน</span>` : ""}<a class="button button-small button-primary" href="#/market/${market.id}">ดูผังร้าน →</a></div>`);
    marker.addTo(province.layer);
  }
  if (province.near) {
    province.youMarker?.remove();
    province.youMarker = window.L.circleMarker([province.near.lat, province.near.lng], { radius: 9, color: "#fff", weight: 3, fillColor: "#3f7f95", fillOpacity: 1 }).bindTooltip("ตำแหน่งของคุณ").addTo(province.map);
  }
  if (province.fit) {
    const bounds = province.layer.getBounds();
    if (bounds.isValid()) province.map.fitBounds(bounds.pad(0.15), { maxZoom: 13 });
    else province.map.fitBounds(TAK_BOUNDS);
    province.fit = false;
  }
}
function renderProductResults() {
  const products = state.province.products;
  const section = $("#product-results");
  section.hidden = !products;
  if (!products) return;
  $("#product-query").textContent = state.province.filters.q;
  $("#product-count").textContent = String(products.pagination.total);
  $("#product-list").innerHTML = products.data.length
    ? products.data.map(item => `<a class="product-row" href="#/store/${item.shop.id}?event=${item.event.id}">${item.shop.imageUrl ? `<img class="shop-avatar" src="${escapeHtml(item.shop.imageUrl)}" alt="" width="52" height="52" loading="lazy">` : `<span class="shop-avatar tone-1" aria-hidden="true">${escapeHtml(item.shop.categoryIcon || "🏷️")}</span>`}<span class="shop-info"><strong>${escapeHtml(item.shop.shopName)}</strong><small>${escapeHtml(item.market.marketName)} · อ.${escapeHtml(item.market.districtName || "")}</small></span><span class="product-when"><strong>${escapeHtml(formatDayDate(item.event.eventDate))}</strong><small>แผง ${escapeHtml(item.boothCode)} · ${escapeHtml(formatTimeRange(item.event.openTime, item.event.closeTime))}</small></span></a>`).join("")
      + (products.pagination.total > products.data.length ? `<p class="hint">แสดง ${products.data.length} รายการแรก — ระบุอำเภอเพื่อให้ผลแคบลง</p>` : "")
    : stateBox("empty", "ยังไม่พบร้านที่ขายสินค้านี้ในอีก 14 วันข้างหน้า ลองใช้คำอื่น เช่น ชื่อประเภทสินค้า", "", "empty-shops");
}
function setProvinceFilter(changes) {
  Object.assign(state.province.filters, changes);
  state.province.page = 1;
  state.province.fit = true;
  return loadProvinceMarkets();
}
function locateMe() {
  if (state.province.near) { state.province.near = null; state.province.youMarker?.remove(); state.province.youMarker = null; return setProvinceFilter({}); }
  if (!navigator.geolocation) { notify("อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง", "error"); return null; }
  notify("กำลังหาตำแหน่งของคุณ...");
  navigator.geolocation.getCurrentPosition(position => {
    const { latitude: lat, longitude: lng } = position.coords;
    if (lat < TAK_LIMITS.lat[0] - 1 || lat > TAK_LIMITS.lat[1] + 1 || lng < TAK_LIMITS.lng[0] - 1 || lng > TAK_LIMITS.lng[1] + 1) { notify("ตำแหน่งของคุณอยู่ไกลจากจังหวัดตาก จึงเรียงตามระยะทางไม่ได้", "error"); return; }
    state.province.near = { lat, lng };
    notify("เรียงตลาดจากใกล้ที่สุดแล้ว", "success");
    setProvinceFilter({});
  }, () => notify("ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง เปิดสิทธิ์ตำแหน่งในเบราว์เซอร์แล้วลองใหม่", "error"), { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  return null;
}

// ---------- Market data ----------
async function ensureMarket(marketId) {
  if (state.market?.id === marketId) return state.market;
  const { data } = await api(`/api/v1/markets/${marketId}`);
  state.market = data;
  return data;
}

// ---------- Customer: market map ----------
async function renderMarketPage(params, id) {
  const marketId = Number(id);
  if (state.customer.loaded && state.market?.id === marketId) { renderCustomerResults(); state.locationMap?.invalidateSize(); return; }
  if (state.market?.id !== marketId) {
    state.customer = { eventId: null, map: null, shops: [], view: state.customer.view, loaded: false, requestId: state.customer.requestId };
    $("#shop-search").value = "";
    $("#category-filter").value = "";
  }
  $("#customer-map").innerHTML = stateBox("loading", "กำลังโหลดแผนผังตลาด...");
  $("#shop-list").innerHTML = stateBox("loading", "กำลังโหลดรายชื่อร้าน...");
  try {
    const market = await ensureMarket(marketId);
    document.title = `${market.marketName} | ตากหลาดนัด`;
    fillMarketInfo(market);
    await loadCustomerMap(toPositiveInt(params.get("event")));
    state.customer.loaded = true;
  } catch (error) {
    const message = error.status === 404 || error.status === 400 ? "ไม่พบตลาดจากลิงก์นี้ กรุณาสแกน QR Code อีกครั้ง หรือกลับไปหน้าแรก" : error.message;
    $("#market-name").textContent = "ไม่สามารถโหลดข้อมูลตลาดได้";
    $("#customer-map").innerHTML = stateBox("error", message, error.status === 404 ? '<a class="button button-primary" href="#/">ดูตลาดทั้งหมด</a>' : retryButton);
    $("#shop-list").innerHTML = "";
    $("#customer-summary").textContent = "";
  }
}
function fillMarketInfo(market) {
  const info = marketType(market.marketType);
  $("#market-breadcrumb").innerHTML = `<li><a href="#/">จังหวัดตาก</a></li>${market.district ? `<li><a href="#/?district=${market.district.id}">อ.${escapeHtml(market.district.name)}</a></li>` : ""}<li aria-current="page">${escapeHtml(market.marketName)}</li>`;
  $("#market-type").textContent = `${info.icon} ${info.label}${market.organizer ? ` · ${market.organizer}` : ""}`;
  $("#market-name").textContent = market.marketName;
  $("#market-description").textContent = market.description || "ดูตำแหน่งร้านค้า ค้นหาสินค้าที่สนใจ และวางแผนเดินตลาดได้ตั้งแต่ก่อนออกจากบ้าน";
  $("#market-address").textContent = [market.address, market.subdistrict ? `ต.${market.subdistrict}` : "", districtLabel(market), "จ.ตาก"].filter(Boolean).join(" ");
  $("#market-days").textContent = formatDays(market.openDays);
  $("#hero-nav-link").href = navigationUrl(market);
  const today = todayISO();
  const past = market.events.filter(event => event.eventDate < today).slice(-3);
  const events = [...market.events.filter(event => event.eventDate >= today).slice(0, 60), ...past.reverse()];
  const select = $("#customer-event");
  select.disabled = !events.length;
  select.innerHTML = events.length ? events.map(event => `<option value="${event.id}">${escapeHtml(eventLabel(event))}</option>`).join("") : '<option value="">ยังไม่มีรอบตลาด</option>';
  renderLocationMap(market);
}
function renderLocationMap(market) {
  const element = $("#market-location-map");
  const hasPoint = market.latitude != null && market.longitude != null;
  element.hidden = !hasPoint || !leafletReady();
  $("#market-location-fallback").hidden = !element.hidden;
  if (element.hidden) return;
  if (!state.locationMap) {
    state.locationMap = createGeoMap(element, { zoomControl: true, dragging: true, attributionControl: true });
    state.locationMarker = window.L.marker([market.latitude, market.longitude], { icon: marketIcon(market.marketType), keyboard: false }).addTo(state.locationMap);
  }
  element.setAttribute("aria-label", `ตำแหน่ง${market.marketName} บนแผนที่`);
  state.locationMarker.setIcon(marketIcon(market.marketType));
  state.locationMarker.setLatLng([market.latitude, market.longitude]);
  state.locationMap.setView([market.latitude, market.longitude], 15);
  setTimeout(() => state.locationMap.invalidateSize(), 0);
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
  const categories = [...new Map(data.booths.filter(booth => booth.shop?.category).map(booth => [booth.shop.category, booth.shop.categoryIcon])).entries()].sort((a, b) => a[0].localeCompare(b[0], "th"));
  categorySelect.innerHTML = '<option value="">ทุกประเภท</option>' + categories.map(([category]) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
  categorySelect.value = categories.some(([category]) => category === selected) ? selected : "";
  renderCategoryChips(categories);
  renderMarketQr();
  await loadCustomerShops();
}
function renderCategoryChips(categories) {
  const current = $("#category-filter").value;
  $("#category-chips").innerHTML = categories.length
    ? [["", "ทั้งหมด", ""], ...categories.map(([category, icon]) => [category, category, icon])].map(([value, label, icon]) => `<button type="button" class="category-chip" data-category="${escapeHtml(value)}" aria-pressed="${value === current}">${icon ? `<span aria-hidden="true">${escapeHtml(icon)}</span> ` : ""}${escapeHtml(label)}</button>`).join("")
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
    ? shops.map((shop, index) => `<div class="shop-row"><a class="shop-row-link" href="#/store/${Number(shop.id)}${eventQuery}">${shop.imageUrl ? `<img class="shop-avatar" src="${escapeHtml(shop.imageUrl)}" alt="" width="52" height="52" loading="lazy">` : `<span class="shop-avatar tone-${index % 3}" aria-hidden="true">${escapeHtml(shop.categoryIcon || (shop.shopName || "ร").slice(0, 1))}</span>`}<span class="shop-info"><strong>${escapeHtml(shop.shopName)}</strong><small>${escapeHtml(shop.category || "ร้านค้าทั่วไป")}</small></span><span class="booth-code">แผง ${escapeHtml(shop.boothCode)}</span></a>${planToggleButton(shop.id, shop.shopName)}</div>`).join("")
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
  const fixed = $("#qr-fixed-event").checked && state.customer.eventId;
  return new URL(`/#/market/${state.market?.id || ""}${fixed ? `?event=${state.customer.eventId}` : ""}`, location.origin).toString();
}
function renderMarketQr() {
  const url = marketQrUrl();
  $("#qr-url").href = url;
  $("#qr-url").textContent = url;
  drawQr($("#qr-image"), url, `QR Code แผนผัง${state.market?.marketName || "ตลาด"}`);
}

// ---------- Customer: shop detail ----------
async function renderStorePage(params, shopId) {
  const content = $("#store-content");
  content.innerHTML = stateBox("loading", "กำลังโหลดข้อมูลร้าน...");
  const eventId = toPositiveInt(params.get("event"));
  try {
    const { data } = await api(`/api/v1/public/shops/${shopId}${eventId ? `?eventId=${eventId}` : ""}`);
    document.title = `${data.shopName} | ตากหลาดนัด`;
    $("#store-back").href = `#/market/${data.market.id}?event=${data.event.id}`;
    $("#store-back").lastChild.textContent = ` กลับไปผัง${data.market.marketName}`;
    const booth = data.booths[0];
    content.innerHTML = `<article class="card store-card">
        <img class="store-cover" src="${escapeHtml(shopImage(data.imageUrl))}" alt="${data.imageUrl ? `รูปร้าน ${escapeHtml(data.shopName)}` : ""}" width="800" height="350">
        <div class="store-body">
          <p class="eyebrow">ร้านค้าใน${escapeHtml(data.market.marketName)}${data.market.districtName ? ` · อ.${escapeHtml(data.market.districtName)}` : ""}</p>
          <h1 class="page-title" tabindex="-1">${escapeHtml(data.shopName)}</h1>
          <p><span class="chip">${data.categoryIcon ? `<span aria-hidden="true">${escapeHtml(data.categoryIcon)}</span> ` : ""}${escapeHtml(data.category || "ร้านค้าทั่วไป")}</span></p>
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
      </section>
      <section class="card schedule-card" aria-labelledby="schedule-title">
        <h2 id="schedule-title">ตารางขายรอบถัดไป</h2>
        ${data.schedule.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">วันที่</th><th scope="col">ตลาด</th><th scope="col">แผง</th><th scope="col">เวลา</th></tr></thead><tbody>${data.schedule.map(item => `<tr><td data-label="วันที่"><strong>${escapeHtml(formatDayDate(item.event.eventDate))}</strong></td><td data-label="ตลาด"><a href="#/market/${item.market.id}?event=${item.event.id}">${escapeHtml(item.market.marketName)}</a><small>อ.${escapeHtml(item.market.districtName || "")}</small></td><td data-label="แผง"><span class="booth-code">${escapeHtml(item.boothCode)}</span></td><td data-label="เวลา">${escapeHtml(formatTimeRange(item.event.openTime, item.event.closeTime))}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">ยังไม่มีรอบที่จองไว้ล่วงหน้า</p>'}
      </section>`;
    let map = state.customer.map;
    if (!map || map.market?.id !== data.market.id || map.event?.id !== data.event.id) map = (await api(`/api/v1/public/markets/${data.market.id}/map?eventId=${data.event.id}`)).data;
    renderMap($("#store-map"), map.booths, { mode: "customer", highlightIds: new Set(data.booths.map(item => item.id)), interactive: false });
    const viewport = $("#store-map-viewport");
    const pin = $(".is-highlight", viewport);
    if (pin) viewport.scrollLeft = pin.offsetLeft - viewport.clientWidth / 2;
  } catch (error) {
    const notFound = error.status === 404;
    content.innerHTML = `<h1 class="page-title" tabindex="-1">${notFound ? "ไม่พบข้อมูลร้าน" : "โหลดข้อมูลร้านไม่สำเร็จ"}</h1>`
      + stateBox(notFound ? "empty" : "error", error.message, `<div class="button-row">${notFound ? "" : retryButton}<a class="button button-primary" href="#/">กลับไปหน้าตลาด</a></div>`, notFound ? "empty-shops" : "");
  }
}

// ---------- Shop: login and register ----------
function renderLoginPage() {
  setFormErrors($("#login-form"), {});
  setAlert($("#login-alert"), state.loginNotice, "info");
  state.loginNotice = "";
}
async function renderRegisterPage() {
  setFormErrors($("#register-form"), {});
  setAlert($("#register-alert"), "");
  try { await loadReference(); } catch { /* the category list stays empty; the form still works without it */ }
}
function passwordProblem(password) {
  if (password.length < 8) return "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร";
  if (new TextEncoder().encode(password).length > 72) return "รหัสผ่านยาวเกินไป";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "รหัสผ่านต้องมีทั้งตัวอักษรภาษาอังกฤษและตัวเลข";
  return "";
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
    state.admin.markets = null;
    form.reset();
    notify(`เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ ${state.shop?.shopName || (isAdmin() ? "ผู้ดูแลตลาด" : "")}`, "success");
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
  if (value("categoryId")) body.categoryId = Number(value("categoryId"));
  if (value("contactPhone")) body.contactPhone = normalizePhone(value("contactPhone"));
  const fields = {};
  if (!EMAIL_PATTERN.test(body.email)) fields.email = "กรุณากรอกอีเมลให้ถูกต้อง เช่น name@example.com";
  if (body.phone && !PHONE_PATTERN.test(body.phone)) fields.phone = PHONE_MESSAGE;
  if (!body.shopName) fields.shopName = "กรุณากรอกชื่อร้าน";
  if (body.contactPhone && !PHONE_PATTERN.test(body.contactPhone)) fields.contactPhone = PHONE_MESSAGE;
  const problem = passwordProblem(body.password);
  if (problem) fields.password = problem;
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
      <span class="booking-info"><strong>แผง ${escapeHtml(booking.booth.boothCode)} · ${escapeHtml(booking.market.marketName)}</strong><span>${escapeHtml(formatDate(booking.event.eventDate))} · ${escapeHtml(formatTimeRange(booking.event.openTime, booking.event.closeTime))}</span><span class="muted">${escapeHtml(booking.event.eventName)}${booking.market.districtName ? ` · อ.${escapeHtml(booking.market.districtName)}` : ""} · ค่าเช่า ${escapeHtml(formatMoney(booking.price))}</span></span>
      <span class="booking-side">${bookingBadge(booking.status)}<span class="link-text">ดูรายละเอียด <span aria-hidden="true">→</span></span></span>
    </a>`;
}
async function renderDashboard() {
  $("#dash-greeting").textContent = `สวัสดี ${state.shop?.shopName || ""}`;
  $("#dash-photo").src = shopImage(state.shop?.imageUrl);
  $("#dash-market").textContent = `${state.shop?.category ? `${state.shop.category} · ` : ""}จองแผงได้ทุกตลาดทั่วจังหวัดตาก`;
  $("#dash-status").innerHTML = stateBox("loading", "กำลังโหลดสรุปการจอง...");
  $("#dash-next").innerHTML = "";
  $("#dash-rebook").innerHTML = "";
  try {
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
        : "<p>เริ่มจองแผงแรกของร้านได้เลย เลือกตลาดใกล้บ้านจากทุกอำเภอ การจองจะยืนยันทันที และจองได้หลายรอบในครั้งเดียว</p>");
    const last = latest.data[0];
    if (last) $("#dash-rebook").innerHTML = `<a class="card action-card rebook-card" href="#/confirm?market=${Number(last.market.id)}&booth=${Number(last.booth.id)}"><span class="action-icon" aria-hidden="true">↻</span><strong>จองแผง ${escapeHtml(last.booth.boothCode)} อีกครั้ง</strong><span>${escapeHtml(last.market.marketName)} — แผงเดิมที่จองล่าสุด เลือกได้หลายรอบในครั้งเดียว</span></a>`;
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
    await loadReference();
    if (!state.markets.length) state.markets = (await api("/api/v1/markets?limit=100")).data;
    if (!state.markets.length) { list.innerHTML = stateBox("empty", "ยังไม่มีข้อมูลตลาดในระบบ"); return; }
    const requested = toPositiveInt(params.get("market"));
    if (requested && state.markets.some(market => market.id === requested)) { state.booths.marketId = requested; state.booths.districtId = ""; }
    if (!state.markets.some(market => market.id === state.booths.marketId)) state.booths.marketId = state.markets[0].id;
    $("#booth-district").innerHTML = districtOptions(state.booths.districtId, { allLabel: "ทุกอำเภอ" });
    fillBoothMarkets();
    await loadBoothEvents(toPositiveInt(params.get("event")));
  } catch (error) { list.innerHTML = stateBox("error", error.message, retryButton); }
}
function fillBoothMarkets() {
  const districtId = state.booths.districtId;
  const markets = state.markets.filter(market => !districtId || String(market.district?.id) === districtId);
  if (!markets.some(market => market.id === state.booths.marketId) && markets.length) state.booths.marketId = markets[0].id;
  $("#booth-market").innerHTML = markets.map(market => `<option value="${market.id}">${escapeHtml(market.marketName)}${districtId ? "" : ` (${escapeHtml(districtLabel(market))})`}</option>`).join("");
  $("#booth-market").value = String(state.booths.marketId);
  const market = state.markets.find(item => item.id === state.booths.marketId);
  $("#booth-market-info").innerHTML = market ? `${typeBadge(market.marketType)} <span>${escapeHtml(districtLabel(market))} · 🔁 ${escapeHtml(formatDays(market.openDays))} · 🕘 ${escapeHtml(formatTimeRange(market.openTime, market.closeTime))}</span> <a href="#/market/${market.id}">ดูผังแบบลูกค้า</a>` : "";
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
    $("#booth-list").innerHTML = stateBox("empty", "ตลาดนี้ยังไม่มีรอบที่เปิดรับจอง กรุณาเลือกตลาดอื่นหรือกลับมาตรวจสอบภายหลัง", "", "empty-bookings");
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
          <dl class="booth-meta">${detailRow("ตำแหน่ง", escapeHtml(positionText(booth)))}${detailRow("ขนาด", escapeHtml(formatSize(booth.width, booth.depth)))}${detailRow("สิ่งอำนวย", escapeHtml(amenities(booth)))}${detailRow("ค่าเช่า", `<strong>${escapeHtml(formatMoney(booth.price))}</strong> / รอบ`)}${booth.note ? detailRow("หมายเหตุ", escapeHtml(booth.note)) : ""}</dl>
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
  const marketId = toPositiveInt(params.get("market")) || state.booths.marketId;
  if (!boothId || !marketId) {
    box.innerHTML = '<h1 class="page-title" tabindex="-1">ยืนยันการจอง</h1>' + stateBox("empty", "ยังไม่ได้เลือกแผงที่ต้องการจอง", '<a class="button button-primary" href="#/booths">ไปเลือกแผง</a>');
    return;
  }
  box.innerHTML = stateBox("loading", "กำลังตรวจสอบแผงที่เลือก...");
  try {
    const [market, rounds, own] = await Promise.all([
      state.market?.id === marketId ? state.market : api(`/api/v1/markets/${marketId}`).then(result => result.data),
      api(`/api/v1/markets/${marketId}/booths/${boothId}/events`),
      api(`/api/v1/bookings?status=confirmed&fromDate=${todayISO()}&limit=100`)
    ]);
    const booth = rounds.data.booth;
    const mine = new Set(own.data.filter(item => item.booth.id === boothId).map(item => item.event.id));
    // A shop cannot be in two markets on the same day, so rounds clashing with its other bookings are flagged.
    const busyDates = new Map(own.data.filter(item => item.booth.id !== boothId).map(item => [item.event.eventDate, item.market.marketName]));
    const events = rounds.data.events.filter(event => event.bookable).map(event => ({ ...event, mine: mine.has(event.id), clash: busyDates.get(event.eventDate), open: event.availability === "available" && !mine.has(event.id) }));
    const back = `<a class="button button-primary" href="#/booths">กลับไปเลือกแผง</a>`;
    if (booth.status !== "available") { box.innerHTML = '<h1 class="page-title" tabindex="-1">แผงนี้ไม่เปิดให้จอง</h1>' + stateBox("empty", `แผง ${booth.boothCode} มีสถานะ “${BOOTH_STATUS[booth.status]?.label || booth.status}” กรุณาเลือกแผงอื่น`, back); return; }
    if (!events.some(event => event.open)) { box.innerHTML = '<h1 class="page-title" tabindex="-1">แผงนี้ไม่ว่างแล้ว</h1>' + stateBox("empty", `แผง ${booth.boothCode} ไม่ว่างในทุกรอบที่เปิดรับจอง กรุณาเลือกแผงอื่น`, back, "empty-bookings"); return; }
    const preselected = events.find(event => event.id === requestedEvent && event.open) || events.find(event => event.open);
    box.innerHTML = `<article class="card">
        <p class="eyebrow">ขั้นตอนสุดท้าย</p>
        <h1 class="page-title" tabindex="-1">ตรวจสอบและยืนยันการจอง</h1>
        <dl class="detail-list">
          ${detailRow("ตลาด", `${escapeHtml(market.marketName)}<br><span class="muted">${escapeHtml([market.address, districtLabel(market)].filter(Boolean).join(" · "))}</span>`)}
          ${detailRow("หมายเลขแผง", `<span class="booth-code booth-code-large">${escapeHtml(booth.boothCode)}</span>`)}
          ${detailRow("ตำแหน่ง", escapeHtml(positionText(booth)))}
          ${detailRow("ขนาด", escapeHtml(formatSize(booth.width, booth.depth)))}
          ${detailRow("สิ่งอำนวยความสะดวก", escapeHtml(amenities(booth)))}
          ${detailRow("ค่าเช่า", `<strong class="price">${escapeHtml(formatMoney(booth.price))}</strong> / รอบ`)}
        </dl>
        <fieldset class="round-fieldset">
          <legend>เลือกรอบ / วันจัดงาน ที่ต้องการจอง</legend>
          <p class="hint">เลือกได้หลายรอบ (สูงสุด 12 รอบ) — รอบที่แผงไม่ว่างจะเลือกไม่ได้</p>
          <div class="button-row"><button type="button" class="button button-small button-outline" id="rounds-all">เลือก 12 รอบแรกที่ว่าง</button><button type="button" class="button button-small button-text" id="rounds-none">ล้างที่เลือก</button></div>
          <div class="round-list" id="round-list">${events.map(event => {
            const status = event.mine ? '<span class="badge badge-lavender">จองไว้แล้ว (ร้านคุณ)</span>' : boothBadge(event.availability);
            return `<label class="round-option ${event.open ? "" : "is-disabled"}"><input type="checkbox" name="round" value="${event.id}" ${event.open ? "" : "disabled"} ${event.id === preselected.id ? "checked" : ""}><span><strong>${escapeHtml(formatDate(event.eventDate))}</strong><small>${escapeHtml(event.eventName)} · ${escapeHtml(formatTimeRange(event.openTime, event.closeTime))}</small>${event.clash && event.open ? `<small class="clash">⚠ วันนี้ร้านคุณจองที่${escapeHtml(event.clash)}ไว้แล้ว</small>` : ""}</span>${status}</label>`;
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
          <li>หากผู้ดูแลตลาดประกาศงดตลาดรอบใด การจองรอบนั้นจะถูกยกเลิกอัตโนมัติ</li>
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
    $("#rounds-all").addEventListener("click", () => { $$("#round-list input").forEach(input => { input.checked = false; }); $$("#round-list input:not(:disabled)").slice(0, 12).forEach(input => { input.checked = true; }); update(); });
    $("#rounds-none").addEventListener("click", () => { $$("#round-list input").forEach(input => { input.checked = false; }); update(); });
    $("#confirm-submit").addEventListener("click", () => submitBooking({ market, booth, events, eventIds: selectedIds() }));
    update();
  } catch (error) {
    box.innerHTML = '<h1 class="page-title" tabindex="-1">ตรวจสอบแผงไม่สำเร็จ</h1>' + stateBox(error.status === 404 ? "empty" : "error", error.message, error.status === 404 ? '<a class="button button-primary" href="#/booths">กลับไปเลือกแผง</a>' : retryButton);
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
    state.province.loaded = false;
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
          ${detailRow("ตลาด", `<a href="#/market/${data.market.id}?event=${data.event.id}">${escapeHtml(data.market.marketName)}</a><br><span class="muted">${escapeHtml([data.market.address, data.market.districtName ? `อ.${data.market.districtName}` : ""].filter(Boolean).join(" · "))}</span>`)}
          ${detailRow("รอบตลาด", escapeHtml(data.event.eventName))}
          ${detailRow("วันจัดงาน", `<strong>${escapeHtml(formatDate(data.event.eventDate))}</strong>`)}
          ${detailRow("เวลาเปิด–ปิด", escapeHtml(formatTimeRange(data.event.openTime, data.event.closeTime)))}
          ${detailRow("หมายเลขแผง", `<span class="booth-code booth-code-large">${escapeHtml(data.booth.boothCode)}</span>`)}
          ${detailRow("ตำแหน่ง", escapeHtml(positionText(data.booth)))}
          ${detailRow("ขนาด", escapeHtml(formatSize(data.booth.width, data.booth.depth)))}
          ${detailRow("สิ่งอำนวยความสะดวก", escapeHtml(amenities(data.booth)))}
          ${detailRow("ค่าเช่า ณ วันจอง", escapeHtml(formatMoney(data.price)))}
          ${detailRow("จองเมื่อ", escapeHtml(formatDateTime(data.bookedAt)))}
          ${data.cancelledAt ? detailRow("ยกเลิกเมื่อ", escapeHtml(formatDateTime(data.cancelledAt))) : ""}
        </dl>
      </article>
      ${data.canCancel
        ? `<section class="card danger-zone"><h2>ยกเลิกการจอง</h2><p>ยกเลิกได้ทุกเวลา เมื่อยกเลิกแล้วแผงจะว่างให้ร้านอื่นจองได้ ประวัติรายการนี้ยังถูกเก็บไว้ แต่หากต้องการขายรอบนี้ต้องจองใหม่</p><button type="button" class="button button-danger" id="cancel-booking">ยกเลิกการจองนี้</button></section>`
        : `<p class="note">${data.status === "cancelled" ? (data.event.status === "cancelled" ? "ผู้ดูแลตลาดประกาศงดตลาดรอบนี้ การจองจึงถูกยกเลิกอัตโนมัติ" : "รายการนี้ถูกยกเลิกแล้ว ระบบเก็บไว้เป็นประวัติการจอง") : data.status === "rejected" ? "ผู้ดูแลตลาดไม่อนุมัติรายการนี้ กรุณาติดต่อผู้ดูแลตลาดหากมีข้อสงสัย" : "รายการนี้ไม่สามารถยกเลิกได้"}</p>`}`;
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
    const [{ data }] = await Promise.all([api("/api/v1/shop/profile"), loadReference()]);
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
  ["shopName", "description", "contactName", "contactPhone", "socialUrl"].forEach(name => { form.elements[name].value = data[name] || ""; });
  form.elements.categoryId.value = data.categoryId ? String(data.categoryId) : "";
  $("#photo-preview").src = shopImage(data.imageUrl);
  $("#photo-remove").hidden = !data.imageUrl;
}
function syncShop(data) {
  state.shop = { ...state.shop, shopName: data.shopName, categoryId: data.categoryId, category: data.category, description: data.description, contactName: data.contactName, contactPhone: data.contactPhone, socialUrl: data.socialUrl, imageUrl: data.imageUrl };
  state.customer.loaded = false;
  renderNav(currentRoute().path);
}
async function submitProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("button[type='submit']", form);
  if (button.disabled) return;
  const value = name => form.elements[name].value.trim();
  const body = { shopName: value("shopName"), categoryId: value("categoryId") ? Number(value("categoryId")) : null, description: value("description") || null, contactName: value("contactName") || null, contactPhone: normalizePhone(value("contactPhone")) || null, socialUrl: value("socialUrl") || null };
  const fields = {};
  if (!body.shopName) fields.shopName = "กรุณากรอกชื่อร้าน";
  if (body.contactPhone && !PHONE_PATTERN.test(body.contactPhone)) fields.contactPhone = PHONE_MESSAGE;
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
function readStoredAdminMarket() { try { return toPositiveInt(localStorage.getItem("tln-admin-market")); } catch { return null; } }
function storeAdminMarket(id) { try { localStorage.setItem("tln-admin-market", String(id)); } catch { /* the choice is simply not remembered */ } }
async function loadAdminMarkets(force = false) {
  if (!state.admin.markets || force) state.admin.markets = (await api("/api/v1/admin/markets")).data;
  return state.admin.markets;
}
function selectAdminMarket(marketId) {
  const market = state.admin.markets?.find(item => item.id === marketId);
  if (!market) return null;
  if (state.admin.marketId !== market.id) { state.admin.bookings.eventId = ""; state.admin.bookings.page = 1; state.admin.selectedBoothId = null; }
  state.admin.marketId = market.id;
  state.admin.market = market;
  storeAdminMarket(market.id);
  return market;
}
async function ensureAdminMarket() {
  const markets = await loadAdminMarkets();
  const select = $("#admin-market-select");
  select.innerHTML = markets.length
    ? (state.reference.districts || []).map(district => {
      const items = markets.filter(market => market.district?.id === district.id);
      return items.length ? `<optgroup label="อ.${escapeHtml(district.name)}">${items.map(market => `<option value="${market.id}">${escapeHtml(market.marketName)}${market.isActive ? "" : " (ซ่อนอยู่)"}</option>`).join("")}</optgroup>` : "";
    }).join("") + (markets.some(market => !market.district) ? `<optgroup label="ยังไม่ระบุอำเภอ">${markets.filter(market => !market.district).map(market => `<option value="${market.id}">${escapeHtml(market.marketName)}${market.isActive ? "" : " (ซ่อนอยู่)"}</option>`).join("")}</optgroup>` : "")
    : '<option value="">ยังไม่มีตลาด</option>';
  select.disabled = !markets.length;
  if (!markets.length) { state.admin.market = null; return null; }
  const wanted = state.admin.marketId || readStoredAdminMarket();
  const market = selectAdminMarket(markets.find(item => item.id === wanted)?.id || (markets.find(item => item.isActive) || markets[0]).id);
  select.value = String(market.id);
  return market;
}
async function renderAdminPage(params, tab = "overview") {
  const name = tab || "overview";
  $("#admin-title").textContent = ADMIN_TABS[name];
  document.title = `${ADMIN_TABS[name]} | ผู้ดูแลตลาด | ตากหลาดนัด`;
  $$("[data-admin-tab]").forEach(link => { if (link.dataset.adminTab === name) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
  $(".admin-market-field").hidden = ["markets", "shops", "audit"].includes(name);
  const content = $("#admin-content");
  content.innerHTML = stateBox("loading", "กำลังโหลดข้อมูล...");
  state.admin.pinMap?.remove();
  state.admin.pinMap = null;
  try {
    await loadReference();
    const market = await ensureAdminMarket();
    if (!market && !["markets", "shops", "audit", "overview"].includes(name)) {
      content.innerHTML = stateBox("empty", "ยังไม่มีตลาดในระบบ เริ่มจากเพิ่มตลาดแรก", '<a class="button button-primary" href="#/admin/markets">+ เพิ่มตลาด</a>', "empty-shops");
      return;
    }
    await { overview: adminOverview, markets: adminMarkets, events: adminEvents, booths: adminBooths, bookings: adminBookings, shops: adminShops, market: adminMarket, audit: adminAudit }[name](content, market, params);
  } catch (error) {
    // The admin role was removed while this page was open: refresh the session and leave.
    if (error.status === 403) { await loadSession(); notify(error.message, "error"); go(homePath()); return; }
    content.innerHTML = stateBox("error", error.message, retryButton);
  }
}

async function adminOverview(content, market) {
  const { data } = await api(`/api/v1/admin/overview${market ? `?marketId=${market.id}` : ""}`);
  const next = data.nextEvent;
  const maxBookings = Math.max(1, ...data.districts.map(row => row.bookingsNext7));
  content.innerHTML = `${data.lowRounds.length ? `<div class="form-alert form-alert-warning"><strong>รอบตลาดใกล้หมด ${data.lowRounds.length} ตลาด</strong> — ร้านค้าจะจองต่อไม่ได้ถ้าไม่เพิ่มรอบใหม่<ul class="warning-list">${data.lowRounds.slice(0, 8).map(item => `<li><button type="button" class="button-link" data-admin-switch="${item.id}" data-admin-go="/admin/events">${escapeHtml(item.marketName)}</button> · ${item.lastEventDate ? `รอบสุดท้าย ${escapeHtml(formatShortDate(item.lastEventDate))}` : "ยังไม่มีรอบ"}</li>`).join("")}</ul></div>` : ""}
    <div class="admin-grid">
      <div class="card stat-card tone-mint"><span>ตลาดที่เปิดแสดง</span><strong>${data.markets.active}</strong><span>จากทั้งหมด ${data.markets.total} ตลาด</span></div>
      <div class="card stat-card tone-sky"><span>ร้านค้าที่ใช้งาน</span><strong>${data.shops.active}</strong><span>จากทั้งหมด ${data.shops.total} ร้าน</span></div>
      <div class="card stat-card tone-peach"><span>แผงที่จองใน 7 วัน</span><strong>${data.bookingsNext7.toLocaleString("th-TH")}</strong><span>การจองที่ยืนยันแล้ว ทุกตลาด</span></div>
      <div class="card stat-card tone-lavender"><span>ค่าเช่า 30 วันข้างหน้า</span><strong>${escapeHtml(formatMoney(data.revenueNext30))}</strong><span>จากการจองที่ยืนยันแล้ว</span></div>
    </div>
    <section class="card admin-section" aria-labelledby="district-title">
      <h2 id="district-title">สรุปรายอำเภอ (7 วันข้างหน้า)</h2>
      <div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">อำเภอ</th><th scope="col">ตลาด</th><th scope="col">รอบตลาด</th><th scope="col">แผงที่จอง</th><th scope="col">ค่าเช่า 30 วัน</th></tr></thead><tbody>${data.districts.map(row => `<tr><th scope="row" data-label="อำเภอ">อ.${escapeHtml(row.name)}</th><td data-label="ตลาด">${row.markets}</td><td data-label="รอบตลาด">${row.eventsNext7}</td><td data-label="แผงที่จอง"><span class="bar" style="--value:${Math.round((row.bookingsNext7 / maxBookings) * 100)}%"><span>${row.bookingsNext7.toLocaleString("th-TH")}</span></span></td><td data-label="ค่าเช่า 30 วัน">${escapeHtml(formatMoney(row.revenue30))}</td></tr>`).join("")}</tbody></table></div>
    </section>
    ${market ? `<section class="card admin-section next-card" aria-labelledby="next-title">
      <h2 id="next-title">รอบถัดไปของ${escapeHtml(market.marketName)}</h2>
      ${next ? `<p class="status-line">${eventBadge(next.status)} <strong>${escapeHtml(formatDate(next.eventDate))}</strong> · ${escapeHtml(formatTimeRange(next.openTime, next.closeTime))}</p><ul class="stat-list"><li><strong>${next.bookedCount}/${next.boothUsable}</strong><span>แผงที่จองแล้ว / แผงที่เปิดจอง</span></li><li><strong>${escapeHtml(formatMoney(next.revenue))}</strong><span>ค่าเช่ารอบนี้</span></li><li><strong>${Math.round((next.bookedCount / Math.max(1, next.boothUsable)) * 100)}%</strong><span>อัตราการจอง</span></li></ul><div class="button-row"><a class="button button-outline" href="#/admin/bookings?event=${next.id}">ดูการจองรอบนี้</a><a class="button button-text" href="#/market/${market.id}?event=${next.id}">ดูผังแบบลูกค้า</a></div>` : `<p class="muted">ยังไม่มีรอบที่จะถึง <a href="#/admin/events">เพิ่มรอบตลาด</a></p>`}
    </section>` : ""}
    <h2 class="section-title">ทางลัด</h2>
    <div class="menu-grid">
      <a class="card action-card tone-sky" href="#/admin/markets"><span class="action-icon" aria-hidden="true">🗺</span><strong>ตลาดทั้งหมด</strong><span>เพิ่มตลาดใหม่ ปักหมุดบนแผนที่ ดูสถานะทุกอำเภอ</span></a>
      <a class="card action-card tone-butter" href="#/admin/events"><span class="action-icon" aria-hidden="true">🗓</span><strong>เพิ่มรอบตลาด</strong><span>สร้างตามวันเปิดของตลาด หรือทุกสัปดาห์ งดตลาดได้</span></a>
      <a class="card action-card tone-peach" href="#/admin/booths"><span class="action-icon" aria-hidden="true">▦</span><strong>จัดผังแผง</strong><span>เพิ่มแผง ย้ายตำแหน่ง ตั้งราคา ปิดปรับปรุง</span></a>
      <a class="card action-card tone-lavender" href="#/admin/bookings"><span class="action-icon" aria-hidden="true">☰</span><strong>ตรวจการจอง</strong><span>ดูร้านที่จองแต่ละรอบ ส่งออก CSV ยกเลิกหรือปฏิเสธ</span></a>
    </div>`;
}

function marketFormHtml(market) {
  const value = key => escapeHtml(market?.[key] ?? "");
  const days = new Set(market?.openDays || []);
  return `<div class="form-alert" id="market-alert" role="alert" hidden></div>
      <div class="form-grid">
        ${field("marketName", "ชื่อตลาด *", `<input type="text" maxlength="150" value="${value("marketName")}" required>`)}
        ${field("code", "รหัสตลาด", `<input type="text" maxlength="20" value="${value("code")}" autocapitalize="characters" placeholder="เว้นว่างให้ระบบตั้งให้">`, "เช่น TAK-MS-06 ใช้อ้างอิงภายใน")}
        ${field("districtId", "อำเภอ *", `<select required>${districtOptions(market?.district?.id || "", { allLabel: "เลือกอำเภอ" })}</select>`)}
        ${field("subdistrict", "ตำบล", `<input type="text" maxlength="100" value="${value("subdistrict")}">`)}
        ${field("marketType", "ประเภทตลาด *", `<select required>${Object.entries(MARKET_TYPES).map(([key, info]) => `<option value="${key}" ${market?.marketType === key ? "selected" : ""}>${info.icon} ${info.label}</option>`).join("")}</select>`)}
        ${field("openTime", "เวลาเปิดปกติ *", `<input type="time" value="${(market?.openTime || "").slice(0, 5)}" required>`)}
        ${field("closeTime", "เวลาปิดปกติ *", `<input type="time" value="${(market?.closeTime || "").slice(0, 5)}" required>`)}
        ${field("organizer", "ผู้จัด / หน่วยงาน", `<input type="text" maxlength="150" value="${value("organizer")}" placeholder="เช่น เทศบาลตำบล...">`)}
        ${field("contactPhone", "เบอร์ติดต่อผู้จัด", `<input type="tel" inputmode="tel" maxlength="20" value="${value("contactPhone")}">`)}
      </div>
      <fieldset class="day-fieldset"><legend>วันเปิดประจำ *</legend><div class="day-options">${DAY_NAMES.map((name, day) => `<label class="day-option"><input type="checkbox" name="openDays" value="${day}" ${days.has(day) ? "checked" : ""}><span>${name}</span></label>`).join("")}</div><button type="button" class="button button-small button-text" data-days-all>เลือกทุกวัน</button><p class="field-error" data-error-for="openDays"></p></fieldset>
      ${field("address", "สถานที่ / ที่อยู่", `<input type="text" maxlength="500" value="${value("address")}">`, "แสดงบนหน้าผังตลาดให้ลูกค้าเห็น")}
      <fieldset class="pin-fieldset"><legend>ตำแหน่งบนแผนที่ *</legend><p class="hint">แตะบนแผนที่เพื่อปักหมุด หรือพิมพ์พิกัดเอง (ต้องอยู่ในจังหวัดตาก)</p><div class="geo-map geo-map-picker" id="market-pin-map" role="application" aria-label="แผนที่สำหรับปักหมุดตำแหน่งตลาด"></div>
        <div class="form-grid">${field("latitude", "ละติจูด *", `<input type="number" step="0.000001" min="15" max="18" inputmode="decimal" value="${market?.latitude ?? ""}" required>`)}${field("longitude", "ลองจิจูด *", `<input type="number" step="0.000001" min="97.3" max="99.8" inputmode="decimal" value="${market?.longitude ?? ""}" required>`)}</div></fieldset>
      ${field("description", "คำอธิบายตลาด", `<textarea rows="4" maxlength="2000">${value("description")}</textarea>`)}
      <label class="check"><input type="checkbox" name="isActive" ${!market || market.isActive ? "checked" : ""}> เปิดแสดงตลาดนี้ให้ลูกค้าและร้านค้าเห็น</label>`;
}
function bindMarketForm(form, market, onSaved) {
  const latInput = form.elements.latitude;
  const lngInput = form.elements.longitude;
  let marker = null;
  const placeMarker = (lat, lng) => {
    if (!state.admin.pinMap) return;
    if (!marker) marker = window.L.marker([lat, lng], { draggable: true, keyboard: false }).addTo(state.admin.pinMap).on("dragend", () => { const point = marker.getLatLng(); latInput.value = point.lat.toFixed(6); lngInput.value = point.lng.toFixed(6); });
    else marker.setLatLng([lat, lng]);
  };
  const mapElement = $("#market-pin-map", form);
  if (leafletReady()) {
    state.admin.pinMap = createGeoMap(mapElement, { scrollWheelZoom: true });
    if (market?.latitude != null) { state.admin.pinMap.setView([market.latitude, market.longitude], 14); placeMarker(market.latitude, market.longitude); }
    // A centre + zoom does not depend on the box size, unlike fitBounds on a form that was just shown.
    else state.admin.pinMap.setView([16.75, 98.75], 8);
    state.admin.pinMap.on("click", event => { latInput.value = event.latlng.lat.toFixed(6); lngInput.value = event.latlng.lng.toFixed(6); placeMarker(event.latlng.lat, event.latlng.lng); });
  } else geoFallback(mapElement, "แผนที่โหลดไม่ได้ กรอกพิกัดด้วยตัวเลขแทนได้");
  const syncFromInputs = () => { const lat = Number(latInput.value); const lng = Number(lngInput.value); if (latInput.value && lngInput.value && Number.isFinite(lat) && Number.isFinite(lng)) { placeMarker(lat, lng); state.admin.pinMap?.panTo([lat, lng]); } };
  latInput.addEventListener("change", syncFromInputs);
  lngInput.addEventListener("change", syncFromInputs);
  form.elements.districtId.addEventListener("change", () => {
    const district = state.reference.districts.find(item => String(item.id) === form.elements.districtId.value);
    if (district && !latInput.value && state.admin.pinMap) state.admin.pinMap.setView([district.latitude, district.longitude], 12);
  });
  $("[data-days-all]", form).addEventListener("click", () => $$('input[name="openDays"]', form).forEach(input => { input.checked = true; }));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("button[type='submit']", form);
    const text = name => form.elements[name].value.trim();
    const body = {
      marketName: text("marketName"), districtId: toPositiveInt(text("districtId")), subdistrict: text("subdistrict") || null, marketType: text("marketType"),
      openTime: text("openTime") || null, closeTime: text("closeTime") || null, organizer: text("organizer") || null, contactPhone: normalizePhone(text("contactPhone")) || null,
      openDays: $$('input[name="openDays"]:checked', form).map(input => Number(input.value)), address: text("address") || null,
      latitude: latInput.value === "" ? null : Number(latInput.value), longitude: lngInput.value === "" ? null : Number(lngInput.value),
      description: text("description") || null, isActive: form.elements.isActive.checked
    };
    if (text("code") || market) body.code = text("code").toUpperCase() || null;
    const fields = {};
    if (!body.marketName) fields.marketName = "กรุณากรอกชื่อตลาด";
    if (!body.districtId) fields.districtId = "กรุณาเลือกอำเภอ";
    if (body.code && !/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(body.code)) fields.code = "ใช้ตัวอักษรภาษาอังกฤษ ตัวเลข และ - 2–20 ตัว";
    if (!body.openTime) fields.openTime = "กรุณาระบุเวลาเปิด";
    if (!body.closeTime) fields.closeTime = "กรุณาระบุเวลาปิด";
    else if (body.openTime && body.closeTime <= body.openTime) fields.closeTime = "เวลาปิดต้องหลังเวลาเปิด";
    if (!body.openDays.length) fields.openDays = "เลือกวันเปิดอย่างน้อย 1 วัน";
    if (body.latitude === null || !Number.isFinite(body.latitude) || body.latitude < TAK_LIMITS.lat[0] || body.latitude > TAK_LIMITS.lat[1]) fields.latitude = "ปักหมุดบนแผนที่ หรือกรอกละติจูด 15.0–18.0";
    if (body.longitude === null || !Number.isFinite(body.longitude) || body.longitude < TAK_LIMITS.lng[0] || body.longitude > TAK_LIMITS.lng[1]) fields.longitude = "ปักหมุดบนแผนที่ หรือกรอกลองจิจูด 97.3–99.8";
    if (body.contactPhone && !PHONE_PATTERN.test(body.contactPhone)) fields.contactPhone = PHONE_MESSAGE;
    setAlert($("#market-alert", form), "");
    setFormErrors(form, fields);
    if (Object.keys(fields).length) return;
    setBusy(button, true, "กำลังบันทึก...");
    try {
      const { data } = await api(market ? `/api/v1/admin/markets/${market.id}` : "/api/v1/admin/markets", { method: market ? "PATCH" : "POST", body });
      await loadAdminMarkets(true);
      state.market = null;
      state.markets = [];
      state.province.loaded = false;
      // Market counts per district changed, so the district list is fetched again.
      state.reference.districts = null;
      await loadReference();
      selectAdminMarket(data.id);
      await onSaved(data);
    } catch (error) {
      setFormErrors(form, error.fields);
      if (error.status !== 401) setAlert($("#market-alert", form), error.message);
      setBusy(button, false);
    }
  });
}

async function adminMarkets(content) {
  const markets = await loadAdminMarkets(true);
  const filter = state.admin.marketsFilter;
  const today = todayISO();
  const rows = markets.filter(market => (!filter.districtId || String(market.district?.id) === filter.districtId) && (!filter.q || `${market.marketName} ${market.code || ""} ${market.address || ""}`.toLowerCase().includes(filter.q.toLowerCase())));
  content.innerHTML = `<div class="tools card">
      <div class="field field-grow"><label for="am-q">ค้นหาตลาด</label><input id="am-q" type="search" maxlength="100" placeholder="ชื่อตลาด รหัส หรือที่อยู่" value="${escapeHtml(filter.q)}"></div>
      <div class="field"><label for="am-district">อำเภอ</label><select id="am-district">${districtOptions(filter.districtId)}</select></div>
      <div class="field field-end"><button type="button" class="button button-primary" id="am-new">+ เพิ่มตลาดใหม่</button></div>
    </div>
    <form class="card form-card" id="market-form" novalidate hidden><h2>เพิ่มตลาดใหม่</h2><div id="market-form-body"></div><div class="button-row"><button class="button button-primary" type="submit">บันทึกตลาด</button><button type="button" class="button button-outline" id="am-cancel">ยกเลิก</button></div></form>
    <p class="result-summary">แสดง ${rows.length} จาก ${markets.length} ตลาด</p>
    <div class="table-wrap card"><table class="data-table"><thead><tr><th scope="col">ตลาด</th><th scope="col">อำเภอ</th><th scope="col">ประเภท</th><th scope="col">วันและเวลาเปิด</th><th scope="col">รอบที่จะถึง</th><th scope="col">แผง</th><th scope="col">สถานะ</th><th scope="col"><span class="sr-only">จัดการ</span></th></tr></thead><tbody>
      ${rows.length ? rows.map(market => {
        const low = !market.lastEventDate || market.lastEventDate < addDaysISO(today, 21);
        return `<tr class="${market.isActive ? "" : "is-muted"}"><th scope="row" data-label="ตลาด"><strong>${escapeHtml(market.marketName)}</strong><small>${escapeHtml(market.code || "-")}${market.subdistrict ? ` · ต.${escapeHtml(market.subdistrict)}` : ""}</small></th><td data-label="อำเภอ">${escapeHtml(market.district?.name || "ยังไม่ระบุ")}</td><td data-label="ประเภท">${typeBadge(market.marketType)}</td><td data-label="วันและเวลาเปิด">${escapeHtml(formatDays(market.openDays))}<small>${escapeHtml(formatTimeRange(market.openTime, market.closeTime))}</small></td><td data-label="รอบที่จะถึง">${market.upcomingEvents}${low ? ' <span class="badge badge-pending">⚠ ใกล้หมด</span>' : ""}<small>${market.lastEventDate ? `ถึง ${escapeHtml(formatShortDate(market.lastEventDate))}` : "ยังไม่มีรอบ"}</small></td><td data-label="แผง">${market.boothCount}</td><td data-label="สถานะ">${market.isActive ? '<span class="badge badge-success">เปิดแสดง</span>' : '<span class="badge badge-muted">ซ่อนอยู่</span>'}${market.latitude == null ? '<small class="clash">ยังไม่ปักหมุด</small>' : ""}</td><td><div class="row-actions"><button type="button" class="button button-small button-outline" data-admin-switch="${market.id}" data-admin-go="/admin">จัดการ</button><button type="button" class="button button-small button-text" data-admin-switch="${market.id}" data-admin-go="/admin/market">แก้ไข</button></div></td></tr>`;
      }).join("") : `<tr><td colspan="8">${stateBox("empty", "ไม่พบตลาดตามเงื่อนไขนี้", "", "empty-shops")}</td></tr>`}
    </tbody></table></div>`;
  const form = $("#market-form");
  $("#am-q").addEventListener("input", event => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => { filter.q = event.target.value.trim(); route(); }, 350); });
  $("#am-district").addEventListener("change", event => { filter.districtId = event.target.value; route(); });
  $("#am-new").addEventListener("click", () => {
    form.hidden = false;
    $("#am-new").hidden = true;
    $("#market-form-body").innerHTML = marketFormHtml(null);
    bindMarketForm(form, null, async data => { notify(`เพิ่ม${data.marketName}แล้ว ขั้นต่อไป: เพิ่มแผงและรอบตลาด`, "success"); go("/admin/booths"); });
    form.elements.marketName.focus();
  });
  $("#am-cancel").addEventListener("click", () => { state.admin.pinMap?.remove(); state.admin.pinMap = null; form.hidden = true; $("#am-new").hidden = false; });
  if (filter.q) { const input = $("#am-q"); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
}

async function adminMarket(content, market) {
  content.innerHTML = `<form class="card form-card" id="market-form" novalidate><h2>ข้อมูลตลาดที่ลูกค้าเห็น · ${escapeHtml(market.marketName)}</h2>${marketFormHtml(market)}<div class="button-row"><button class="button button-primary" type="submit">บันทึกข้อมูลตลาด</button><a class="button button-text" href="#/market/${market.id}">ดูหน้าตลาดแบบลูกค้า</a></div></form>`;
  const form = $("#market-form");
  bindMarketForm(form, market, async data => {
    notify("บันทึกข้อมูลตลาดเรียบร้อยแล้ว", "success");
    await ensureAdminMarket();
    await adminMarket(content, data);
    setAlert($("#market-alert"), "บันทึกข้อมูลตลาดเรียบร้อยแล้ว", "success");
  });
}

async function adminEvents(content, market) {
  const filter = state.admin.eventsFilter;
  const query = new URLSearchParams({ limit: "100", order: filter === "past" ? "desc" : "asc" });
  if (filter === "upcoming") query.set("fromDate", todayISO());
  if (filter === "past") query.set("toDate", todayISO(-1));
  const { data, pagination } = await api(`/api/v1/admin/markets/${market.id}/events?${query}`);
  const lastDate = filter === "upcoming" ? data.filter(event => event.status !== "cancelled").map(event => event.eventDate).sort().pop() : market.lastEventDate;
  const suggested = lastDate && lastDate >= todayISO() ? addDaysISO(lastDate, 1) : todayISO();
  const info = marketType(market.marketType);
  content.innerHTML = `<form class="card form-card" id="event-form" novalidate>
      <h2>เพิ่มรอบตลาด · ${escapeHtml(market.marketName)}</h2>
      <p class="hint">วันเปิดประจำ: ${escapeHtml(formatDays(market.openDays))} · ${escapeHtml(formatTimeRange(market.openTime, market.closeTime))} — วันที่มีรอบอยู่แล้วจะถูกข้าม</p>
      <div class="form-alert" id="event-alert" role="alert" hidden></div>
      <div class="form-grid">
        ${field("eventName", "ชื่อรอบ *", `<input type="text" maxlength="150" value="${escapeHtml(info.label.split(" / ")[0])}" required>`, "ระบบเติมชื่อวันให้เมื่อสร้างตามวันเปิด")}
        ${field("eventDate", "เริ่มตั้งแต่วันที่ *", `<input type="date" value="${suggested}" min="${todayISO()}" required>`)}
        ${field("pattern", "รูปแบบ", `<select><option value="openDays">ทุกวันที่ตลาดเปิด (${escapeHtml(formatDays(market.openDays))})</option><option value="weekly">สัปดาห์ละครั้ง วันเดียวกับวันเริ่ม</option></select>`)}
        ${field("repeatWeeks", "จำนวนสัปดาห์", '<input type="number" min="1" max="26" value="4" inputmode="numeric">', "1–26 สัปดาห์")}
        ${field("openTime", "เวลาเปิด", '<input type="time">', `เว้นว่าง = ${(market.openTime || "").slice(0, 5)}`)}
        ${field("closeTime", "เวลาปิด", '<input type="time">', `เว้นว่าง = ${(market.closeTime || "").slice(0, 5)}`)}
      </div>
      <button class="button button-primary" type="submit">+ เพิ่มรอบตลาด</button>
    </form>
    <section class="card admin-section">
      <div class="map-toolbar"><h2>รายการรอบตลาด <span class="count-pill">${pagination.total}</span></h2><div class="field"><label for="events-filter" class="sr-only">ช่วงเวลา</label><select id="events-filter"><option value="upcoming">รอบที่กำลังจะถึง</option><option value="past">รอบที่ผ่านมา</option><option value="all">ทั้งหมด</option></select></div></div>
      ${pagination.total > data.length ? `<p class="hint">แสดง ${data.length} รอบแรกจาก ${pagination.total} รอบ</p>` : ""}
      <div class="admin-list">${data.length ? data.map(event => `<div class="admin-row ${event.status === "cancelled" ? "is-muted" : ""}">
          <div><strong>${escapeHtml(formatDate(event.eventDate))}</strong><small>${escapeHtml(event.eventName)} · ${escapeHtml(formatTimeRange(event.openTime, event.closeTime))}</small></div>
          <div>${eventBadge(event.status)}<small>จองแล้ว ${event.bookedCount} แผง · ${escapeHtml(formatMoney(event.revenue))}</small></div>
          <div class="row-actions"><label class="sr-only" for="event-status-${event.id}">สถานะรอบ ${escapeHtml(formatDate(event.eventDate))}</label><select id="event-status-${event.id}" data-event-status="${event.id}" data-booked="${event.bookedCount}">${Object.entries(EVENT_STATUS).map(([value, item]) => `<option value="${value}" ${value === event.status ? "selected" : ""}>${item.label}</option>`).join("")}</select><button type="button" class="button button-small button-outline" data-event-edit="${event.id}">แก้ไข</button><a class="button button-small button-text" href="#/admin/bookings?event=${event.id}">ดูการจอง</a></div>
        </div>`).join("") : stateBox("empty", "ไม่มีรอบตลาดในช่วงนี้", "", "empty-bookings")}</div>
    </section>`;
  $("#events-filter").value = filter;
  $("#events-filter").addEventListener("change", event => { state.admin.eventsFilter = event.target.value; route(); });
  $("#event-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("button[type='submit']", form);
    const values = Object.fromEntries(new FormData(form));
    const body = { eventName: values.eventName.trim(), eventDate: values.eventDate, pattern: values.pattern, repeatWeeks: Number(values.repeatWeeks || 1) };
    if (values.openTime) body.openTime = values.openTime;
    if (values.closeTime) body.closeTime = values.closeTime;
    const fields = {};
    if (!body.eventName) fields.eventName = "กรุณากรอกชื่อรอบ";
    if (!body.eventDate) fields.eventDate = "กรุณาเลือกวันที่";
    else if (body.eventDate < todayISO()) fields.eventDate = "สร้างรอบย้อนหลังไม่ได้";
    if (!Number.isInteger(body.repeatWeeks) || body.repeatWeeks < 1 || body.repeatWeeks > 26) fields.repeatWeeks = "ใส่ได้ 1–26 สัปดาห์";
    if (body.openTime && body.closeTime && body.closeTime <= body.openTime) fields.closeTime = "เวลาปิดต้องหลังเวลาเปิด";
    setAlert($("#event-alert"), "");
    setFormErrors(form, fields);
    if (Object.keys(fields).length) return;
    setBusy(button, true, "กำลังเพิ่ม...");
    try {
      const { data: result } = await api(`/api/v1/admin/markets/${market.id}/events`, { method: "POST", body });
      notify(`เพิ่มรอบตลาด ${result.created.length} รอบ${result.skippedDates.length ? ` (ข้าม ${result.skippedDates.length} วันที่มีรอบอยู่แล้ว)` : ""}`, result.created.length ? "success" : "info");
      state.market = null;
      await loadAdminMarkets(true);
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
      body: `<div class="form-grid">${field("eventName", "ชื่อรอบ", `<input type="text" maxlength="150" value="${escapeHtml(event.eventName)}">`)}${field("eventDate", "วันที่", `<input type="date" value="${event.eventDate}" min="${todayISO()}">`)}${field("openTime", "เวลาเปิด", `<input type="time" value="${(event.ownOpenTime || "").slice(0, 5)}">`)}${field("closeTime", "เวลาปิด", `<input type="time" value="${(event.ownCloseTime || "").slice(0, 5)}">`)}</div><p class="hint">เวลาว่าง = ใช้เวลาเปิด–ปิดของตลาด · ย้ายไปวันที่ผ่านมาแล้วไม่ได้</p>`,
      okText: "บันทึก"
    });
    if (!result.ok) return;
    const values = Object.fromEntries(new FormData(result.form));
    const body = { eventName: values.eventName, openTime: values.openTime || null, closeTime: values.closeTime || null };
    if (values.eventDate !== event.eventDate) body.eventDate = values.eventDate;
    try {
      await api(`/api/v1/admin/events/${event.id}`, { method: "PATCH", body });
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
        <div class="map-toolbar"><h2>ผัง${escapeHtml(market.marketName)}</h2>${zoomControls("admin")}</div>
        <p class="hint">แตะแผงเพื่อแก้ไข · ขณะแก้ไข แตะพื้นที่ว่างบนผังเพื่อย้ายแผงไปตำแหน่งนั้น</p>
        <div class="map-viewport"><div class="map-canvas is-placing" id="admin-map" role="group" aria-label="แผนผังสำหรับจัดแผง"></div></div>
      </section>
      <form class="card form-card" id="booth-form" novalidate>
        <h2 id="booth-form-title">เพิ่มแผงใหม่</h2>
        <div class="form-alert" id="booth-alert" role="alert" hidden></div>
        <div class="form-grid">
          ${field("boothCode", "หมายเลขแผง *", '<input type="text" maxlength="30" autocapitalize="characters" required>', "เช่น A07 (ตัวอักษร ตัวเลข และ -)")}
          ${field("zone", "โซน", '<input type="text" maxlength="50" placeholder="เช่น โซน A · อาหาร">')}
          ${field("price", "ค่าเช่าต่อรอบ (บาท) *", '<input type="number" min="0" max="100000" step="1" inputmode="decimal" required>')}
          ${field("width", "กว้าง (เมตร)", '<input type="number" min="0.5" max="50" step="0.1" inputmode="decimal">')}
          ${field("depth", "ลึก (เมตร)", '<input type="number" min="0.5" max="50" step="0.1" inputmode="decimal">')}
          ${field("mapX", "ตำแหน่งแนวนอน (0–100)", '<input type="number" min="0" max="100" step="0.1" inputmode="decimal">')}
          ${field("mapY", "ตำแหน่งแนวตั้ง (0–100)", '<input type="number" min="0" max="100" step="0.1" inputmode="decimal">')}
          ${field("status", "สถานะแผง", `<select>${["available", "maintenance", "unavailable"].map(value => `<option value="${value}">${BOOTH_STATUS[value].label}</option>`).join("")}</select>`)}
        </div>
        <div class="check-row"><label class="check"><input type="checkbox" name="hasElectricity"> ⚡ มีไฟฟ้า</label><label class="check"><input type="checkbox" name="hasRoof"> ⛱ มีหลังคา</label></div>
        ${field("note", "หมายเหตุ", '<input type="text" maxlength="255" placeholder="เช่น รอซ่อมหลังคา">', "แสดงให้ร้านค้าเห็นตอนเลือกแผง")}
        <div class="button-row"><button class="button button-primary" type="submit">บันทึกแผง</button><button type="button" class="button button-outline" id="booth-new">+ เพิ่มแผงใหม่</button></div>
      </form>
    </div>
    <section class="card admin-section"><h2>รายการแผงทั้งหมด <span class="count-pill">${data.length}</span></h2><div class="admin-list">${data.length ? data.map(booth => `<div class="admin-row ${booth.status !== "available" ? "is-muted" : ""}"><div><strong>แผง ${escapeHtml(booth.boothCode)}</strong><small>${escapeHtml(positionText(booth))}</small></div><div>${boothBadge(booth.status)}<small>${escapeHtml(formatSize(booth.width, booth.depth))} · ${escapeHtml(formatMoney(booth.price))}/รอบ · ${escapeHtml(amenities(booth))}</small>${booth.note ? `<small>หมายเหตุ: ${escapeHtml(booth.note)}</small>` : ""}</div><div class="row-actions"><button type="button" class="button button-small button-outline" data-booth-edit="${booth.id}">แก้ไข</button></div></div>`).join("") : stateBox("empty", "ตลาดนี้ยังไม่มีแผง เพิ่มแผงแรกได้จากฟอร์มด้านบน", "", "empty-shops")}</div></section>`;
  const form = $("#booth-form");
  const selectBooth = booth => {
    state.admin.selectedBoothId = booth ? booth.id : null;
    $("#booth-form-title").textContent = booth ? `แก้ไขแผง ${booth.boothCode}` : "เพิ่มแผงใหม่";
    form.elements.boothCode.value = booth?.boothCode || "";
    form.elements.zone.value = booth?.zone || "";
    form.elements.price.value = booth ? Number(booth.price) : "";
    form.elements.width.value = booth?.width ?? "";
    form.elements.depth.value = booth?.depth ?? "";
    form.elements.mapX.value = booth?.mapX ?? "";
    form.elements.mapY.value = booth?.mapY ?? "";
    form.elements.status.value = booth?.status || "available";
    form.elements.hasElectricity.checked = Boolean(booth?.hasElectricity);
    form.elements.hasRoof.checked = Boolean(booth?.hasRoof);
    form.elements.note.value = booth?.note || "";
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
    form.elements.mapX.value = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)).toFixed(1);
    form.elements.mapY.value = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)).toFixed(1);
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
    const body = { boothCode: form.elements.boothCode.value.trim().toUpperCase(), zone: form.elements.zone.value.trim() || null, price: number("price"), width: number("width"), depth: number("depth"), mapX: number("mapX"), mapY: number("mapY"), status: form.elements.status.value, hasElectricity: form.elements.hasElectricity.checked, hasRoof: form.elements.hasRoof.checked, note: form.elements.note.value.trim() || null };
    const fields = {};
    if (!body.boothCode) fields.boothCode = "กรุณากรอกหมายเลขแผง";
    else if (!/^[0-9A-Zก-ฮ][0-9A-Zก-ฮ-]{0,29}$/u.test(body.boothCode)) fields.boothCode = "ใช้ตัวอักษร ตัวเลข และ - เท่านั้น";
    if (body.price === null || !Number.isFinite(body.price) || body.price < 0 || body.price > 100000) fields.price = "ค่าเช่าต้องเป็น 0–100,000 บาท";
    for (const key of ["width", "depth"]) if (body[key] !== null && (body[key] < 0.5 || body[key] > 50)) fields[key] = "ใส่ได้ 0.5–50 เมตร";
    for (const key of ["mapX", "mapY"]) if (body[key] !== null && (body[key] < 0 || body[key] > 100)) fields[key] = "ใส่ได้ 0–100";
    setFormErrors(form, fields);
    if (Object.keys(fields).length) return;
    setBusy(button, true, "กำลังบันทึก...");
    try {
      const id = state.admin.selectedBoothId;
      const { data: saved } = await api(id ? `/api/v1/admin/booths/${id}` : `/api/v1/admin/markets/${market.id}/booths`, { method: id ? "PATCH" : "POST", body });
      notify(saved.activeBookings && saved.status !== "available" ? `บันทึกแผง ${saved.boothCode} แล้ว — ยังมีการจอง ${saved.activeBookings} รายการในรอบที่จะถึง ตรวจที่แท็บการจอง` : `บันทึกแผง ${saved.boothCode} แล้ว`, saved.activeBookings && saved.status !== "available" ? "warning" : "success");
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
  if (requested) { options.eventId = requested; options.page = 1; options.scope = "market"; }
  const scoped = options.scope === "market";
  const { data: events } = scoped ? await api(`/api/v1/admin/markets/${market.id}/events?limit=100&fromDate=${todayISO(-30)}`) : { data: [] };
  if (scoped && !options.eventId && events.length) options.eventId = String((events.find(event => event.eventDate >= todayISO() && event.status !== "cancelled") || events[events.length - 1]).id);
  const filter = new URLSearchParams();
  if (scoped) filter.set("marketId", market.id);
  if (scoped && options.eventId) filter.set("eventId", options.eventId);
  if (options.status) filter.set("status", options.status);
  if (options.q) filter.set("q", options.q);
  const query = new URLSearchParams({ ...Object.fromEntries(filter), page: String(options.page), limit: "20" });
  const { data, pagination } = await api(`/api/v1/admin/bookings?${query}`);
  content.innerHTML = `<div class="tools card">
      <div class="field"><label for="ab-scope">ขอบเขต</label><select id="ab-scope"><option value="market">${escapeHtml(market.marketName)}</option><option value="all">ทุกตลาดในจังหวัด</option></select></div>
      ${scoped ? `<div class="field"><label for="ab-event">รอบตลาด</label><select id="ab-event"><option value="">ทุกรอบ</option>${events.map(event => `<option value="${event.id}">${escapeHtml(formatDate(event.eventDate))}${event.status === "cancelled" ? " (งดตลาด)" : ""}</option>`).join("")}</select></div>` : ""}
      <div class="field"><label for="ab-status">สถานะ</label><select id="ab-status"><option value="">ทุกสถานะ</option>${Object.entries(BOOKING_STATUS).map(([value, info]) => `<option value="${value}">${info.label}</option>`).join("")}</select></div>
      <div class="field field-grow"><label for="ab-q">ค้นหา</label><input id="ab-q" type="search" maxlength="100" placeholder="ชื่อร้าน หมายเลขแผง หรืออีเมล" value="${escapeHtml(options.q)}"></div>
      <div class="field field-end"><a class="button button-outline" href="/api/v1/admin/bookings/export?${filter}" download>⬇ ส่งออก CSV</a></div>
    </div>
    <p class="result-summary">พบ ${pagination.total.toLocaleString("th-TH")} รายการ</p>
    <div class="admin-list">${data.length ? data.map(booking => `<div class="admin-row ${["cancelled", "rejected"].includes(booking.status) ? "is-muted" : ""}">
        <div><strong>แผง ${escapeHtml(booking.booth.boothCode)} · ${escapeHtml(booking.shop.shopName)}</strong><small>${scoped ? "" : `${escapeHtml(booking.market.marketName)} · `}${escapeHtml(formatDate(booking.event.eventDate))} · ${escapeHtml(formatMoney(booking.price))}</small><small>จองเมื่อ ${escapeHtml(formatDateTime(booking.bookedAt))}${booking.shop.category ? ` · ${escapeHtml(booking.shop.category)}` : ""}</small></div>
        <div>${bookingBadge(booking.status)}<small>${escapeHtml(booking.shop.contactName || "ไม่ระบุผู้ติดต่อ")} · ${booking.shop.contactPhone ? `<a href="tel:${escapeHtml(booking.shop.contactPhone)}">${escapeHtml(booking.shop.contactPhone)}</a>` : "ไม่มีเบอร์"}</small><small>${escapeHtml(booking.shop.email)}</small></div>
        <div class="row-actions">${booking.status === "pending" ? `<button type="button" class="button button-small button-primary" data-booking-action="confirmed" data-booking-id="${booking.id}">อนุมัติ</button>` : ""}${["pending", "confirmed"].includes(booking.status) ? `<button type="button" class="button button-small button-outline" data-booking-action="rejected" data-booking-id="${booking.id}">ปฏิเสธ</button><button type="button" class="button button-small button-danger" data-booking-action="cancelled" data-booking-id="${booking.id}">ยกเลิก</button>` : ""}</div>
      </div>`).join("") : stateBox("empty", "ไม่พบการจองตามตัวกรองนี้", "", "empty-bookings")}</div>
    <nav class="pager" id="admin-pager" aria-label="เปลี่ยนหน้ารายการจอง">${pagerHtml(options.page, pagination.totalPages)}</nav>`;
  $("#ab-scope").value = options.scope;
  if (scoped) $("#ab-event").value = options.eventId;
  $("#ab-status").value = options.status;
  $("#ab-scope").addEventListener("change", event => { options.scope = event.target.value; options.eventId = ""; options.page = 1; go("/admin/bookings"); });
  $("#ab-event")?.addEventListener("change", event => { options.eventId = event.target.value; options.page = 1; go("/admin/bookings"); });
  $("#ab-status").addEventListener("change", event => { options.status = event.target.value; options.page = 1; route(); });
  $("#ab-q").addEventListener("input", event => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => { options.q = event.target.value.trim(); options.page = 1; route(); }, 400); });
  $("#admin-pager").addEventListener("click", event => { const button = event.target.closest("[data-page-to]"); if (button && !button.disabled) { options.page = Number(button.dataset.pageTo); route(); } });
  content.querySelectorAll("[data-booking-action]").forEach(button => button.addEventListener("click", async () => {
    const status = button.dataset.bookingAction;
    const booking = data.find(item => item.id === Number(button.dataset.bookingId));
    const verb = { confirmed: "อนุมัติ", rejected: "ปฏิเสธ", cancelled: "ยกเลิก" }[status];
    const result = await confirmDialog({ title: `${verb}การจองแผง ${booking.booth.boothCode}?`, body: `<p>${escapeHtml(booking.shop.shopName)} · ${escapeHtml(booking.market.marketName)} · ${escapeHtml(formatDate(booking.event.eventDate))}</p>${status !== "confirmed" ? "<p>แผงจะว่างให้ร้านอื่นจองได้ และร้านจะเห็นสถานะใหม่ในหน้าการจองของร้าน</p>" : ""}`, okText: verb, danger: status !== "confirmed" });
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
  if (options.categoryId) query.set("categoryId", options.categoryId);
  const { data, pagination } = await api(`/api/v1/admin/shops?${query}`);
  content.innerHTML = `<div class="tools card">
      <div class="field field-grow"><label for="as-q">ค้นหาร้าน</label><input id="as-q" type="search" maxlength="100" placeholder="ชื่อร้าน อีเมล ประเภท หรือเบอร์" value="${escapeHtml(options.q)}"></div>
      <div class="field"><label for="as-category">ประเภทสินค้า</label><select id="as-category"><option value="">ทุกประเภท</option>${state.reference.categories.map(category => `<option value="${category.id}">${escapeHtml(`${category.icon || ""} ${category.name}`)}</option>`).join("")}</select></div>
      <div class="field"><label for="as-status">สถานะบัญชี</label><select id="as-status"><option value="">ทั้งหมด</option><option value="active">ใช้งาน</option><option value="disabled">ปิดใช้งาน</option></select></div>
    </div>
    <p class="result-summary">พบ ${pagination.total.toLocaleString("th-TH")} ร้าน</p>
    <div class="admin-list">${data.length ? data.map(shop => `<div class="admin-row ${shop.isActive ? "" : "is-muted"}">
        <div class="shop-row-link" style="padding:0"><img class="shop-avatar" src="${escapeHtml(shopImage(shop.imageUrl))}" alt="" width="52" height="52" loading="lazy"><span class="shop-info"><strong>${escapeHtml(shop.shopName)}</strong><small>${escapeHtml(shop.category || "ไม่ระบุประเภท")} · ขาย ${shop.marketCount} ตลาด</small><small>จองรอบที่จะถึง ${shop.upcomingBookings} · ทั้งหมด ${shop.totalBookings}</small></span></div>
        <div><small>${escapeHtml(shop.contactName || "ไม่ระบุผู้ติดต่อ")} · ${escapeHtml(shop.contactPhone || shop.phone || "ไม่มีเบอร์")}</small><small>${escapeHtml(shop.email)}</small></div>
        <div class="row-actions">${shop.role === "admin" ? '<span class="badge badge-lavender">ผู้ดูแล</span>' : ""}${shop.isActive ? '<span class="badge badge-success">ใช้งาน</span>' : '<span class="badge badge-muted">ปิดใช้งาน</span>'}${shop.userId === state.user.id ? "" : `<button type="button" class="button button-small ${shop.isActive ? "button-outline" : "button-primary"}" data-shop-toggle="${shop.id}" data-active="${shop.isActive}">${shop.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}</button>`}</div>
      </div>`).join("") : stateBox("empty", "ไม่พบร้านตามเงื่อนไขนี้", "", "empty-shops")}</div>
    <nav class="pager" id="admin-pager" aria-label="เปลี่ยนหน้ารายชื่อร้าน">${pagerHtml(options.page, pagination.totalPages)}</nav>`;
  $("#as-status").value = options.status;
  $("#as-category").value = options.categoryId;
  $("#as-status").addEventListener("change", event => { options.status = event.target.value; options.page = 1; route(); });
  $("#as-category").addEventListener("change", event => { options.categoryId = event.target.value; options.page = 1; route(); });
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

function auditDetails(details) {
  const labels = { bookingId: "การจอง #", shopId: "ร้าน #", marketId: "ตลาด #", eventId: "รอบ #", boothId: "แผง #", count: "จำนวน ", cancelledBookings: "ยกเลิกการจอง ", rows: "แถว ", from: "จาก ", to: "เป็น ", isActive: "ใช้งาน: ", pattern: "รูปแบบ ", fields: "ช่อง: " };
  return Object.entries(details || {}).filter(([key]) => key in labels).map(([key, value]) => `${labels[key]}${Array.isArray(value) ? value.join(", ") : value}`).join(" · ");
}
async function adminAudit(content) {
  const options = state.admin.audit;
  const query = new URLSearchParams({ page: String(options.page), limit: "30" });
  if (options.group) query.set("group", options.group);
  const { data, pagination } = await api(`/api/v1/admin/audit?${query}`);
  content.innerHTML = `<div class="tools card">
      <div class="field"><label for="au-group">ประเภทการทำงาน</label><select id="au-group"><option value="">ทั้งหมด</option><option value="admin">ผู้ดูแลตลาด</option><option value="booking">การจอง</option><option value="shop">ข้อมูลร้าน</option><option value="auth">การเข้าสู่ระบบ</option></select></div>
      <p class="hint field-grow">บันทึกทุกการทำงานที่เปลี่ยนข้อมูล ใช้ตรวจย้อนหลังว่าใครทำอะไรเมื่อไร</p>
    </div>
    <p class="result-summary">พบ ${pagination.total.toLocaleString("th-TH")} รายการ</p>
    <div class="table-wrap card"><table class="data-table"><thead><tr><th scope="col">เวลา</th><th scope="col">ผู้ทำรายการ</th><th scope="col">การทำงาน</th><th scope="col">รายละเอียด</th></tr></thead><tbody>
      ${data.length ? data.map(item => `<tr><td data-label="เวลา">${escapeHtml(formatDateTime(item.createdAt))}</td><td data-label="ผู้ทำรายการ">${item.actor ? `${escapeHtml(item.actor.email)}${item.actor.role === "admin" ? ' <span class="badge badge-lavender">ผู้ดูแล</span>' : ""}` : '<span class="muted">ระบบ / ไม่ระบุ</span>'}</td><td data-label="การทำงาน"><strong>${escapeHtml(AUDIT_LABELS[item.action] || item.action)}</strong><small>${escapeHtml(item.action)}</small></td><td data-label="รายละเอียด">${escapeHtml(auditDetails(item.details)) || "-"}</td></tr>`).join("") : `<tr><td colspan="4">${stateBox("empty", "ยังไม่มีประวัติการทำงาน")}</td></tr>`}
    </tbody></table></div>
    <nav class="pager" id="admin-pager" aria-label="เปลี่ยนหน้าประวัติ">${pagerHtml(options.page, pagination.totalPages)}</nav>`;
  $("#au-group").value = options.group;
  $("#au-group").addEventListener("change", event => { options.group = event.target.value; options.page = 1; route(); });
  $("#admin-pager").addEventListener("click", event => { const button = event.target.closest("[data-page-to]"); if (button && !button.disabled) { options.page = Number(button.dataset.pageTo); route(); } });
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
    if (event.target.closest("[data-retry]")) { state.customer.loaded = false; state.province.loaded = false; route(); }
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
      if (currentRoute().path.startsWith("/market/")) renderCustomerResults();
      else $$("[data-plan-shop]").forEach(button => { button.outerHTML = planToggleButton(Number(button.dataset.planShop), button.dataset.planName); });
    }
    const copy = event.target.closest("[data-qr-copy]");
    if (copy) {
      try { await navigator.clipboard.writeText($(copy.dataset.qrCopy).href); notify("คัดลอกลิงก์แล้ว", "success"); }
      catch { notify("คัดลอกไม่สำเร็จ กรุณากดค้างที่ลิงก์เพื่อคัดลอกเอง", "error"); }
    }
    if (event.target.closest("[data-qr-print]")) { document.body.classList.add("print-qr"); window.print(); }
    const switcher = event.target.closest("[data-admin-switch]");
    if (switcher) {
      selectAdminMarket(Number(switcher.dataset.adminSwitch));
      go(switcher.dataset.adminGo || "/admin");
    }
    const locate = event.target.closest("[data-locate-market]");
    if (locate && state.province.map) {
      const id = Number(locate.dataset.locateMarket);
      const marker = state.province.layer.getLayers().find(layer => layer.options.marketId === id);
      if (marker) {
        $("#province-map").scrollIntoView({ behavior: "smooth", block: "center" });
        state.province.map.flyTo(marker.getLatLng(), 14, { duration: 0.6 });
        setTimeout(() => marker.openPopup(), 650);
      }
    }
    if (event.target.closest("#province-reset")) {
      state.province.near = null;
      Object.assign(state.province.filters, { q: "", districtId: "", type: "", openOn: "" });
      fillProvinceFilters();
      setProvinceFilter({});
    }
  });
  window.addEventListener("afterprint", () => document.body.classList.remove("print-qr"));
  $("#login-form").addEventListener("submit", submitLogin);
  $("#register-form").addEventListener("submit", submitRegister);
  $("#profile-form").addEventListener("submit", submitProfile);
  $("#photo-input").addEventListener("change", uploadPhoto);
  $("#photo-remove").addEventListener("click", removePhoto);

  // Province finder
  $("#province-map-link").addEventListener("click", event => { event.preventDefault(); $("#province-section").scrollIntoView({ behavior: "smooth" }); });
  $("#province-filters").addEventListener("submit", event => { event.preventDefault(); clearTimeout(state.searchTimer); setProvinceFilter({ q: $("#province-search").value.trim().slice(0, 100) }); });
  $("#province-search").addEventListener("input", event => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => setProvinceFilter({ q: event.target.value.trim().slice(0, 100) }), 400); });
  $("#province-district").addEventListener("change", event => { setProvinceFilter({ districtId: event.target.value }); $$("#district-chips [data-district]").forEach(chip => chip.setAttribute("aria-pressed", String(chip.dataset.district === event.target.value))); });
  $("#province-type").addEventListener("change", event => setProvinceFilter({ type: event.target.value }));
  $("#province-day").addEventListener("change", event => setProvinceFilter({ openOn: event.target.value }));
  $("#district-chips").addEventListener("click", event => {
    const chip = event.target.closest("[data-district]");
    if (!chip) return;
    $("#province-district").value = chip.dataset.district;
    setProvinceFilter({ districtId: chip.dataset.district });
  });
  $("#province-near").addEventListener("click", locateMe);
  $("#province-near-hero").addEventListener("click", () => { $("#province-section").scrollIntoView({ behavior: "smooth" }); if (!state.province.near) locateMe(); });
  $("#province-fit").addEventListener("click", () => state.province.map?.fitBounds(TAK_BOUNDS));
  $("#market-pager").addEventListener("click", event => {
    const button = event.target.closest("[data-page-to]");
    if (!button || button.disabled) return;
    state.province.page = Number(button.dataset.pageTo);
    state.province.fit = true;
    loadProvinceMarkets();
    $("#market-list").scrollIntoView({ block: "start" });
  });

  // Market floor plan
  $("#hero-map-link").addEventListener("click", event => { event.preventDefault(); $("#market-section").scrollIntoView({ behavior: "smooth" }); });
  $("#customer-event").addEventListener("change", async event => {
    const eventId = toPositiveInt(event.target.value);
    $("#customer-map").innerHTML = stateBox("loading", "กำลังโหลดแผนผังรอบที่เลือก...");
    try {
      await loadCustomerMap(eventId);
      history.replaceState(null, "", `${location.pathname}#/market/${state.market.id}${eventId ? `?event=${eventId}` : ""}`);
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

  // Shop booth picker
  $("#booth-district").addEventListener("change", async event => {
    state.booths.districtId = event.target.value;
    fillBoothMarkets();
    try { await loadBoothEvents(null); } catch (error) { $("#booth-list").innerHTML = stateBox("error", error.message, retryButton); }
  });
  $("#booth-market").addEventListener("change", async event => {
    state.booths.marketId = Number(event.target.value);
    fillBoothMarkets();
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
  $("#admin-market-select").addEventListener("change", event => { selectAdminMarket(Number(event.target.value)); route(); });
  window.addEventListener("hashchange", route);
}

async function init() {
  bindEvents();
  // QR codes printed before the province redesign point to /?market=ID&event=ID.
  const legacyMarket = toPositiveInt(initialParams.get("market"));
  if (legacyMarket && (!location.hash || location.hash === "#/")) {
    const legacyEvent = toPositiveInt(initialParams.get("event"));
    history.replaceState(null, "", `${location.pathname}#/market/${legacyMarket}${legacyEvent ? `?event=${legacyEvent}` : ""}`);
  } else if (!location.hash) history.replaceState(null, "", `${location.pathname}${location.search}#/`);
  await loadSession();
  route();
}
init();
