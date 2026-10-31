const TIME_ZONE = "Asia/Bangkok";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^\+?\d{9,15}$/;
const ZOOM_STEPS = [1, 1.5, 2, 2.5];
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

const state = {
  user: null,
  shop: null,
  markets: [],
  market: null,
  customer: { eventId: null, map: null, shops: [], view: "map", loaded: false, requestId: 0 },
  booths: { marketId: null, eventId: null, events: [], items: [], view: "list" },
  bookings: { page: 1, time: "upcoming", status: "", order: "asc" },
  zoom: { customer: 0, booth: 0 },
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
function stateBox(kind, message, extra = "") {
  const icon = { loading: "◌", empty: "○", error: "!" }[kind] || "○";
  return `<div class="state-box state-${kind}" ${kind === "error" ? 'role="alert"' : ""}><span class="state-icon" aria-hidden="true">${icon}</span><p>${escapeHtml(message)}</p>${extra}</div>`;
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

// ---------- Map ----------
function renderMap(canvas, booths, { mode, matchIds = null, highlightIds = null, interactive = true }) {
  canvas.dataset.mode = mode;
  if (!booths.length) { canvas.innerHTML = stateBox("empty", "ยังไม่มีข้อมูลแผงในตลาดนี้"); return; }
  const decor = '<span class="map-walkway map-walkway-h" aria-hidden="true"><span>ทางเดิน</span></span><span class="map-walkway map-walkway-v" aria-hidden="true"></span><span class="map-entrance" aria-hidden="true">⬇ ทางเข้าตลาด</span>';
  canvas.innerHTML = decor + booths.map((booth, index) => {
    const x = Math.max(5, Math.min(95, Number(booth.mapX ?? 12 + (index % 6) * 15)));
    const y = Math.max(7, Math.min(93, Number(booth.mapY ?? 15 + Math.floor(index / 6) * 18)));
    const status = booth.availability || "unavailable";
    const shop = booth.shop;
    const classes = ["booth-pin", `is-${status}`];
    if (matchIds) classes.push(matchIds.has(booth.id) ? "is-match" : "is-dimmed");
    if (highlightIds) classes.push(highlightIds.has(booth.id) ? "is-highlight" : "is-dimmed");
    let caption;
    let label;
    if (mode === "customer") {
      caption = shop ? shop.shopName : status === "available" ? "แผงว่าง" : BOOTH_STATUS[status]?.label || "";
      label = shop ? `แผง ${booth.boothCode}: ${shop.shopName}${shop.category ? ` (${shop.category})` : ""}` : `แผง ${booth.boothCode}: ${caption}`;
    } else {
      caption = `${BOOTH_STATUS[status]?.icon || ""} ${BOOTH_STATUS[status]?.label || ""}${status === "available" ? ` · ${Number(booth.price)}฿` : ""}`;
      label = `แผง ${booth.boothCode}: ${BOOTH_STATUS[status]?.label || ""}${status === "available" ? ` ค่าเช่า ${formatMoney(booth.price)}` : ""}`;
    }
    const inner = `<strong>${escapeHtml(booth.boothCode)}</strong><small>${escapeHtml(caption)}</small>`;
    const style = `left:${x}%;top:${y}%`;
    if (!interactive) return `<span class="${classes.join(" ")}" style="${style}" role="img" aria-label="${escapeHtml(label)}">${inner}</span>`;
    const disabled = mode === "booth" && status !== "available" ? "disabled" : "";
    return `<button type="button" class="${classes.join(" ")}" style="${style}" data-booth-id="${Number(booth.id)}" ${shop ? `data-shop-id="${Number(shop.id)}"` : ""} aria-label="${escapeHtml(label)}" ${disabled}>${inner}</button>`;
  }).join("");
}
function applyZoom(name, step) {
  const canvas = name === "customer" ? $("#customer-map") : $("#booth-map");
  const viewport = canvas.parentElement;
  const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / (viewport.scrollWidth || 1);
  const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / (viewport.scrollHeight || 1);
  state.zoom[name] = step;
  const level = ZOOM_STEPS[step];
  canvas.style.setProperty("--zoom", level);
  const controls = $(`[data-zoom-for="${name}"]`);
  $(".zoom-level", controls).textContent = `${Math.round(level * 100)}%`;
  $('[data-zoom="-1"]', controls).disabled = step === 0;
  $('[data-zoom="1"]', controls).disabled = step === ZOOM_STEPS.length - 1;
  viewport.scrollLeft = centerX * viewport.scrollWidth - viewport.clientWidth / 2;
  viewport.scrollTop = centerY * viewport.scrollHeight - viewport.clientHeight / 2;
}

// ---------- Router ----------
const routes = [
  { pattern: /^\/$/, page: "market", title: "แผนผังตลาด", render: renderMarketPage },
  { pattern: /^\/store\/(\d+)$/, page: "store", title: "รายละเอียดร้านค้า", render: renderStorePage },
  { pattern: /^\/login$/, page: "login", title: "เข้าสู่ระบบร้านค้า", render: renderLoginPage, guest: true },
  { pattern: /^\/register$/, page: "register", title: "สมัครสมาชิกร้านค้า", render: renderRegisterPage, guest: true },
  { pattern: /^\/dashboard$/, page: "dashboard", title: "หน้าหลักร้านค้า", render: renderDashboard, auth: true },
  { pattern: /^\/booths$/, page: "booths", title: "เลือกแผง", render: renderBoothsPage, auth: true },
  { pattern: /^\/confirm$/, page: "confirm", title: "ยืนยันการจอง", render: renderConfirmPage, auth: true },
  { pattern: /^\/bookings$/, page: "bookings", title: "การจองของฉัน", render: renderBookingsPage, auth: true },
  { pattern: /^\/bookings\/(\d+)$/, page: "booking", title: "รายละเอียดการจอง", render: renderBookingPage, auth: true },
  { pattern: /^\/profile$/, page: "profile", title: "ข้อมูลร้าน", render: renderProfilePage, auth: true }
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
function safeNext(value) { return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard"; }

async function route() {
  const { path, params } = currentRoute();
  closeMenu();
  let match = null;
  const found = routes.find(item => (match = item.pattern.exec(path)));
  if (found?.auth && !state.user) {
    state.loginNotice = state.loginNotice || "กรุณาเข้าสู่ระบบก่อนใช้งานส่วนร้านค้า";
    return go(`/login?next=${encodeURIComponent(path + (params.toString() ? `?${params}` : ""))}`);
  }
  if (found?.guest && state.user) return go("/dashboard");
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
  const links = state.user
    ? [["/", "แผนผังตลาด"], ["/dashboard", "หน้าหลักร้าน"], ["/booths", "จองแผง"], ["/bookings", "การจองของฉัน"], ["/profile", "ข้อมูลร้าน"]]
    : [["/", "แผนผังตลาด"], ["/register", "สมัครร้านค้า"]];
  const current = href => (href === "/" ? path === "/" || path.startsWith("/store") : path === href || path.startsWith(`${href}/`) || (href === "/booths" && path === "/confirm"));
  $("#main-nav").innerHTML = links.map(([href, label]) => `<a href="#${href}" ${current(href) ? 'aria-current="page"' : ""}>${label}</a>`).join("")
    + (state.user
      ? `<span class="nav-shop" title="ร้านที่เข้าสู่ระบบ"><span aria-hidden="true">●</span> ${escapeHtml(state.shop?.shopName || "")}</span><button type="button" class="button button-small button-outline" data-logout>ออกจากระบบ</button>`
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
  renderQr();
  await loadCustomerShops();
}
async function loadCustomerShops() {
  const requestId = ++state.customer.requestId;
  const params = new URLSearchParams({ limit: "100", sort: "boothCode" });
  if (state.customer.eventId) params.set("eventId", state.customer.eventId);
  const query = $("#shop-search").value.trim().slice(0, 100);
  const category = $("#category-filter").value;
  if (query) params.set("q", query);
  if (category) params.set("category", category);
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
    ? shops.map((shop, index) => `<a class="shop-row" href="#/store/${Number(shop.id)}${eventQuery}"><span class="shop-avatar tone-${index % 3}" aria-hidden="true">${escapeHtml((shop.shopName || "ร").slice(0, 1))}</span><span class="shop-info"><strong>${escapeHtml(shop.shopName)}</strong><small>${escapeHtml(shop.category || "ร้านค้าทั่วไป")}</small></span><span class="booth-code">แผง ${escapeHtml(shop.boothCode)}</span></a>`).join("")
    : stateBox("empty", filtering ? "ไม่พบร้านที่ตรงกับการค้นหา ลองเปลี่ยนคำค้นหาหรือเลือก “ทุกประเภท”" : map.event ? "ยังไม่มีร้านค้ายืนยันเข้าร่วมรอบนี้" : "ยังไม่มีรอบตลาด จึงยังไม่มีรายชื่อร้าน");
  renderMap($("#customer-map"), map.booths, { mode: "customer", matchIds: filtering ? new Set(shops.map(shop => shop.boothId)) : null });
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
function qrUrl() {
  const url = new URL("/", location.origin);
  if (state.market) url.searchParams.set("market", state.market.id);
  if ($("#qr-fixed-event").checked && state.customer.eventId) url.searchParams.set("event", state.customer.eventId);
  return url.toString();
}
function renderQr() {
  const url = qrUrl();
  const link = $("#qr-url");
  link.href = url;
  link.textContent = url;
  const box = $("#qr-image");
  if (typeof window.qrcode !== "function") { box.innerHTML = '<p class="hint">สร้างภาพ QR ไม่ได้ในขณะนี้ ใช้ลิงก์ด้านข้างแทน</p>'; return; }
  const qr = window.qrcode(0, "M");
  qr.addData(url);
  qr.make();
  box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true, title: "QR Code แผนผังตลาด" });
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
        <p class="eyebrow">ร้านค้าใน${escapeHtml(data.market.marketName)}</p>
        <h1 class="page-title" tabindex="-1">${escapeHtml(data.shopName)}</h1>
        <p><span class="chip">${escapeHtml(data.category || "ร้านค้าทั่วไป")}</span></p>
        <p class="store-description">${escapeHtml(data.description || "ร้านนี้ยังไม่ได้เพิ่มคำอธิบาย แวะชมสินค้าได้ที่แผง")}</p>
        <dl class="detail-list">
          ${detailRow("หมายเลขแผง", data.booths.map(item => `<span class="booth-code booth-code-large">${escapeHtml(item.boothCode)}</span>`).join(" "))}
          ${detailRow("ตำแหน่ง", escapeHtml(positionText(booth)))}
          ${detailRow("วันที่ขาย", escapeHtml(formatDate(data.event.eventDate)))}
          ${detailRow("เวลาเปิด–ปิดตลาด", escapeHtml(formatTimeRange(data.event.openTime, data.event.closeTime)))}
          ${detailRow("ติดต่อร้าน", data.contactPhone ? `<a class="button button-primary" href="tel:${escapeHtml(data.contactPhone)}"><span aria-hidden="true">📞</span> โทร ${escapeHtml(data.contactPhone)}</a>` : "ร้านไม่ได้ระบุช่องทางติดต่อ")}
        </dl>
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
      + stateBox(notFound ? "empty" : "error", notFound ? error.message : error.message, `<div class="button-row">${notFound ? "" : retryButton}<a class="button button-primary" href="#/">กลับไปแผนผังตลาด</a></div>`);
  }
}

// ---------- Shop: login and register ----------
function renderLoginPage() {
  const form = $("#login-form");
  setFormErrors(form, {});
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
  $("#dash-status").innerHTML = stateBox("loading", "กำลังโหลดสรุปการจอง...");
  $("#dash-next").innerHTML = "";
  try {
    const market = await ensureMarket().catch(() => null);
    $("#dash-market").textContent = market ? `${market.marketName} · ${market.address || ""}` : "";
    const today = todayISO();
    const [upcoming, all, cancelled] = await Promise.all([
      api(`/api/v1/bookings?status=confirmed&fromDate=${today}&sort=eventDate&order=asc&limit=3`),
      api("/api/v1/bookings?limit=1"),
      api("/api/v1/bookings?status=cancelled&limit=1")
    ]);
    const upcomingTotal = upcoming.pagination.total;
    $("#dash-status").innerHTML = all.pagination.total === 0
      ? `<h2>สถานะการจอง</h2><p class="status-line"><span class="badge badge-muted"><span aria-hidden="true">○</span> ยังไม่มีการจอง</span></p><p>เริ่มจองแผงแรกของร้านได้เลย การจองจะยืนยันทันที</p>`
      : `<h2>สถานะการจอง</h2><p class="status-line">${upcomingTotal ? `${bookingBadge("confirmed")} มีแผงพร้อมขาย ${upcomingTotal} รอบ` : '<span class="badge badge-muted"><span aria-hidden="true">○</span> ยังไม่มีการจองรอบที่กำลังจะถึง</span>'}</p>
        <ul class="stat-list"><li><strong>${upcomingTotal}</strong><span>จองสำเร็จ (รอบที่จะถึง)</span></li><li><strong>${cancelled.pagination.total}</strong><span>ยกเลิกแล้ว</span></li><li><strong>${all.pagination.total}</strong><span>รายการทั้งหมด</span></li></ul>`;
    $("#dash-next").innerHTML = upcoming.data.length
      ? `<div class="booking-list">${upcoming.data.map(bookingCard).join("")}</div>`
      : stateBox("empty", "ยังไม่มีแผงที่จองไว้สำหรับรอบที่กำลังจะถึง", '<a class="button button-primary" href="#/booths">จองแผง</a>');
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
    $("#booth-list").innerHTML = stateBox("empty", "ตลาดนี้ยังไม่มีรอบที่เปิดรับจอง กรุณากลับมาตรวจสอบภายหลัง");
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
          ${open ? `<a class="button button-primary button-full" href="#/confirm?event=${state.booths.eventId}&booth=${Number(booth.id)}">เลือกแผงนี้</a>` : `<button type="button" class="button button-full" disabled>ไม่สามารถจองได้</button>`}
        </article>`;
    }).join("")
    : stateBox("empty", filter === "available" ? "รอบนี้ไม่มีแผงว่างแล้ว ลองเลือกรอบอื่น" : "ไม่พบแผงตามตัวกรองนี้");
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

// ---------- Shop: confirm booking ----------
async function renderConfirmPage(params) {
  const box = $("#confirm-content");
  const eventId = toPositiveInt(params.get("event"));
  const boothId = toPositiveInt(params.get("booth"));
  if (!eventId || !boothId) {
    box.innerHTML = '<h1 class="page-title" tabindex="-1">ยืนยันการจอง</h1>' + stateBox("empty", "ยังไม่ได้เลือกแผงที่ต้องการจอง", '<a class="button button-primary" href="#/booths">ไปเลือกแผง</a>');
    return;
  }
  box.innerHTML = stateBox("loading", "กำลังตรวจสอบแผงที่เลือก...");
  try {
    const marketId = state.booths.marketId || (await ensureMarket()).id;
    const market = state.market?.id === marketId ? state.market : (await api(`/api/v1/markets/${marketId}`)).data;
    const [eventsPayload, boothsPayload] = await Promise.all([
      api(`/api/v1/markets/${marketId}/events?fromDate=${todayISO()}&limit=100`),
      api(`/api/v1/markets/${marketId}/booths?eventId=${eventId}&limit=100`).catch(error => { if (error.status === 404) return { data: [] }; throw error; })
    ]);
    const event = eventsPayload.data.find(item => item.id === eventId && item.bookable);
    const booth = boothsPayload.data.find(item => item.id === boothId);
    const back = `<a class="button button-primary" href="#/booths${event ? `?event=${eventId}` : ""}">กลับไปเลือกแผง</a>`;
    if (!event) { box.innerHTML = '<h1 class="page-title" tabindex="-1">ไม่สามารถจองรอบนี้ได้</h1>' + stateBox("empty", "รอบตลาดนี้ไม่เปิดรับจองแล้ว กรุณาเลือกรอบอื่น", back); return; }
    if (!booth) { box.innerHTML = '<h1 class="page-title" tabindex="-1">ไม่พบแผง</h1>' + stateBox("empty", "ไม่พบแผงที่เลือกในตลาดนี้", back); return; }
    if (booth.availability !== "available") { box.innerHTML = '<h1 class="page-title" tabindex="-1">แผงนี้ไม่ว่างแล้ว</h1>' + stateBox("empty", `แผง ${booth.boothCode} มีสถานะ “${BOOTH_STATUS[booth.availability]?.label}” กรุณาเลือกแผงอื่น`, back); return; }
    box.innerHTML = `<article class="card">
        <p class="eyebrow">ขั้นตอนสุดท้าย</p>
        <h1 class="page-title" tabindex="-1">ตรวจสอบและยืนยันการจอง</h1>
        <dl class="detail-list">
          ${detailRow("ตลาด", `${escapeHtml(market.marketName)}<br><span class="muted">${escapeHtml(market.address || "")}</span>`)}
          ${detailRow("รอบตลาด", escapeHtml(event.eventName))}
          ${detailRow("วันจัดงาน", `<strong>${escapeHtml(formatDate(event.eventDate))}</strong>`)}
          ${detailRow("เวลาเปิด–ปิด", escapeHtml(formatTimeRange(event.openTime, event.closeTime)))}
          ${detailRow("หมายเลขแผง", `<span class="booth-code booth-code-large">${escapeHtml(booth.boothCode)}</span>`)}
          ${detailRow("ตำแหน่ง", escapeHtml(positionText(booth)))}
          ${detailRow("ขนาด", escapeHtml(formatSize(booth.width, booth.depth)))}
          ${detailRow("ค่าเช่า", `<strong class="price">${escapeHtml(formatMoney(booth.price))}</strong> / รอบ`)}
          ${detailRow("สถานะแผงตอนนี้", boothBadge(booth.availability))}
        </dl>
      </article>
      <section class="card conditions" aria-labelledby="conditions-title">
        <h2 id="conditions-title">เงื่อนไขการจองและการยกเลิก</h2>
        <ul>
          <li>เมื่อกด “ยืนยันการจอง” การจองจะมีสถานะ <strong>จองสำเร็จ</strong> ทันที ไม่ต้องรออนุมัติ</li>
          <li>ค่าเช่าคิดตามราคา ณ เวลาที่จอง (${escapeHtml(formatMoney(booth.price))}) แม้ราคาแผงจะเปลี่ยนภายหลัง</li>
          <li>ยกเลิกการจองได้ทุกเวลาที่หน้า “การจองของฉัน” ระบบจะเก็บประวัติรายการไว้ และแผงจะว่างให้ร้านอื่นจองได้</li>
          <li>หนึ่งแผงจองได้หนึ่งร้านต่อรอบ หากมีร้านอื่นจองก่อน ระบบจะแจ้งให้เลือกแผงใหม่</li>
          <li>ระบบยังไม่มีการชำระเงินออนไลน์ กรุณาชำระค่าเช่าตามที่ตลาดกำหนด</li>
        </ul>
        <label class="check"><input type="checkbox" id="confirm-accept"> ฉันอ่านและยอมรับเงื่อนไขการจองแล้ว</label>
        <div class="form-alert" id="confirm-alert" role="alert" hidden></div>
        <div class="button-row" id="confirm-actions"><button type="button" class="button button-primary" id="confirm-submit" disabled>ยืนยันการจอง</button><a class="button button-outline" href="#/booths?event=${eventId}">กลับไปเลือกแผง</a></div>
      </section>`;
    $("#confirm-accept").addEventListener("change", e => { $("#confirm-submit").disabled = !e.target.checked; });
    $("#confirm-submit").addEventListener("click", () => submitBooking({ market, event, booth }));
  } catch (error) {
    box.innerHTML = '<h1 class="page-title" tabindex="-1">ตรวจสอบแผงไม่สำเร็จ</h1>' + stateBox("error", error.message, retryButton);
  }
}
async function submitBooking({ market, event, booth }) {
  const button = $("#confirm-submit");
  if (button.disabled) return;
  setBusy(button, true, "กำลังจอง...");
  setAlert($("#confirm-alert"), "");
  try {
    const { data } = await api("/api/v1/bookings", { method: "POST", body: { eventId: event.id, boothId: booth.id } });
    notify(`จองแผง ${data.booth.boothCode} สำเร็จ`, "success");
    $("#confirm-content").innerHTML = `<div class="card success-card">
        <span class="success-icon" aria-hidden="true">✓</span>
        <h1 class="page-title" tabindex="-1">จองแผงสำเร็จ</h1>
        <p class="status-line">เลขที่การจอง <strong>#${Number(data.id)}</strong> ${bookingBadge(data.status)}</p>
        <dl class="detail-list">
          ${detailRow("ตลาด", escapeHtml(market.marketName))}
          ${detailRow("วันจัดงาน", escapeHtml(formatDate(data.event.eventDate)))}
          ${detailRow("เวลาเปิด–ปิด", escapeHtml(formatTimeRange(event.openTime, event.closeTime)))}
          ${detailRow("หมายเลขแผง", `<span class="booth-code booth-code-large">${escapeHtml(data.booth.boothCode)}</span>`)}
          ${detailRow("ค่าเช่า", escapeHtml(formatMoney(data.price)))}
          ${detailRow("จองเมื่อ", escapeHtml(formatDateTime(data.bookedAt)))}
        </dl>
        <div class="button-row"><a class="button button-primary" href="#/bookings/${Number(data.id)}">ดูรายละเอียดการจอง</a><a class="button button-outline" href="#/bookings">การจองของฉัน</a><a class="button button-text" href="#/booths?event=${event.id}">จองแผงเพิ่ม</a></div>
      </div>`;
    $("#confirm-content .page-title").focus();
  } catch (error) {
    setBusy(button, false);
    const alert = $("#confirm-alert");
    if (error.code === "BOOTH_UNAVAILABLE" || error.code === "EVENT_NOT_BOOKABLE" || error.code === "EVENT_OR_BOOTH_NOT_FOUND") {
      button.disabled = true;
      setAlert(alert, `${error.message}`);
      $("#confirm-actions").innerHTML = `<a class="button button-primary" href="#/booths?event=${event.id}">เลือกแผงใหม่</a>`;
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
      : stateBox("empty", options.time === "upcoming" && !options.status ? "ยังไม่มีการจองสำหรับรอบที่กำลังจะถึง" : "ไม่พบรายการจองตามตัวกรองนี้", '<a class="button button-primary" href="#/booths">จองแผง</a>');
    if (pagination.totalPages > 1) {
      $("#bookings-pager").innerHTML = `<button type="button" class="button button-outline" data-page-to="${options.page - 1}" ${options.page <= 1 ? "disabled" : ""}><span aria-hidden="true">←</span> ก่อนหน้า</button><span>หน้า ${options.page} จาก ${pagination.totalPages}</span><button type="button" class="button button-outline" data-page-to="${options.page + 1}" ${options.page >= pagination.totalPages ? "disabled" : ""}>ถัดไป <span aria-hidden="true">→</span></button>`;
    }
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
        <p class="status-line">สถานะ: ${bookingBadge(data.status)}</p>
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
        : `<p class="note">${data.status === "cancelled" ? "รายการนี้ถูกยกเลิกแล้ว ระบบเก็บไว้เป็นประวัติการจอง" : "รายการนี้ไม่สามารถยกเลิกได้"}</p>`}`;
    $("#cancel-booking")?.addEventListener("click", () => cancelBooking(data));
  } catch (error) {
    const notFound = error.status === 404;
    box.innerHTML = `<h1 class="page-title" tabindex="-1">${notFound ? "ไม่พบรายการจอง" : "โหลดรายการจองไม่สำเร็จ"}</h1>` + stateBox(notFound ? "empty" : "error", notFound ? "ไม่พบรายการจองนี้ในบัญชีของคุณ" : error.message, notFound ? '<a class="button button-primary" href="#/bookings">กลับไปการจองของฉัน</a>' : retryButton);
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
  const button = $("#cancel-booking");
  setBusy(button, true, "กำลังยกเลิก...");
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

// ---------- Shop: profile ----------
async function renderProfilePage() {
  const form = $("#profile-form");
  const account = $("#profile-account");
  setFormErrors(form, {});
  setAlert($("#profile-alert"), "");
  account.innerHTML = stateBox("loading", "กำลังโหลดข้อมูลร้าน...");
  form.hidden = true;
  try {
    const { data } = await api("/api/v1/shop/profile");
    account.innerHTML = `<h2>บัญชีผู้ใช้</h2><dl class="detail-list">${detailRow("อีเมลสำหรับเข้าสู่ระบบ", escapeHtml(data.account.email))}${detailRow("เบอร์โทรศัพท์บัญชี", escapeHtml(data.account.phone || "ไม่ได้ระบุ"))}${detailRow("แก้ไขล่าสุด", escapeHtml(formatDateTime(data.updatedAt)))}</dl><p class="hint">อีเมลและเบอร์โทรศัพท์บัญชีไม่แสดงต่อลูกค้า</p>`;
    fillProfileForm(data);
    form.hidden = false;
  } catch (error) { account.innerHTML = stateBox("error", error.message, retryButton); }
}
function fillProfileForm(data) {
  const form = $("#profile-form");
  form.elements.shopName.value = data.shopName || "";
  form.elements.category.value = data.category || "";
  form.elements.description.value = data.description || "";
  form.elements.contactPhone.value = data.contactPhone || "";
}
async function submitProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("button[type='submit']", form);
  if (button.disabled) return;
  const value = name => form.elements[name].value.trim();
  const body = { shopName: value("shopName"), category: value("category") || null, description: value("description") || null, contactPhone: normalizePhone(value("contactPhone")) || null };
  const fields = {};
  if (!body.shopName) fields.shopName = "กรุณากรอกชื่อร้าน";
  if (body.contactPhone && !PHONE_PATTERN.test(body.contactPhone)) fields.contactPhone = "เบอร์ติดต่อร้านต้องเป็นตัวเลข 9–15 หลัก";
  setAlert($("#profile-alert"), "");
  setFormErrors(form, fields);
  if (Object.keys(fields).length) return;
  setBusy(button, true, "กำลังบันทึก...");
  try {
    const { data } = await api("/api/v1/shop/profile", { method: "PATCH", body });
    state.shop = { ...state.shop, shopName: data.shopName, category: data.category, description: data.description, contactPhone: data.contactPhone };
    state.customer.loaded = false;
    fillProfileForm(data);
    renderNav(currentRoute().path);
    setAlert($("#profile-alert"), "บันทึกข้อมูลร้านเรียบร้อยแล้ว", "success");
    notify("บันทึกข้อมูลร้านเรียบร้อยแล้ว", "success");
  } catch (error) {
    setFormErrors(form, error.fields);
    if (error.status !== 401) setAlert($("#profile-alert"), `${error.message} ข้อมูลที่กรอกยังอยู่ในฟอร์ม แก้ไขแล้วกดบันทึกอีกครั้งได้`);
  } finally { setBusy(button, false); }
}

// ---------- Events ----------
function bindEvents() {
  $("#skip-link").addEventListener("click", event => { event.preventDefault(); $("#app").focus(); });
  $("#menu-toggle").addEventListener("click", () => {
    const open = !$("#main-nav").classList.contains("is-open");
    $("#main-nav").classList.toggle("is-open", open);
    $("#menu-toggle").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", event => {
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
  });
  $("#login-form").addEventListener("submit", submitLogin);
  $("#register-form").addEventListener("submit", submitRegister);
  $("#profile-form").addEventListener("submit", submitProfile);

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
  $$("[data-customer-view]").forEach(button => button.addEventListener("click", () => setCustomerView(button.dataset.customerView)));
  $("#customer-map").addEventListener("click", event => {
    const pin = event.target.closest("[data-booth-id]");
    if (!pin) return;
    if (pin.dataset.shopId) go(`/store/${pin.dataset.shopId}${state.customer.eventId ? `?event=${state.customer.eventId}` : ""}`);
    else notify(`${pin.getAttribute("aria-label")} ในรอบนี้`);
  });
  $("#qr-fixed-event").addEventListener("change", renderQr);
  $("#qr-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(qrUrl()); notify("คัดลอกลิงก์แผนผังแล้ว", "success"); }
    catch { notify("คัดลอกไม่สำเร็จ กรุณากดค้างที่ลิงก์เพื่อคัดลอกเอง", "error"); }
  });
  $("#qr-print").addEventListener("click", () => {
    document.body.classList.add("print-qr");
    window.print();
  });
  window.addEventListener("afterprint", () => document.body.classList.remove("print-qr"));

  $("#booth-market").addEventListener("change", async event => {
    state.booths.marketId = Number(event.target.value);
    try { await loadBoothEvents(null); } catch (error) { $("#booth-list").innerHTML = stateBox("error", error.message, retryButton); }
  });
  $("#booth-event").addEventListener("change", event => { state.booths.eventId = Number(event.target.value); loadBooths(); });
  $("#booth-status").addEventListener("change", renderBooths);
  $$("[data-booth-view]").forEach(button => button.addEventListener("click", () => setBoothView(button.dataset.boothView)));
  $("#booth-map").addEventListener("click", event => {
    const pin = event.target.closest("[data-booth-id]");
    if (pin && !pin.disabled) go(`/confirm?event=${state.booths.eventId}&booth=${pin.dataset.boothId}`);
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
