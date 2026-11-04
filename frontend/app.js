const $ = (selector) => document.querySelector(selector);

const feed = $("#feed");
const answers = $("#answers");
const input = $("#input");
const sendButton = $("#send");
const grid = $("#grid");
const compareView = $("#compareView");
const detail = $("#detail");
const detailContent = $("#detailContent");
const about = $("#about");

const STORAGE_KEY = "cwf.brief.v2";
const THEME_KEY = "cwf.theme";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const mobile = window.matchMedia("(max-width: 900px)");

const state = {
  session: newSession(),
  messages: [],
  options: [],
  picked: new Set(),
  multi: false,
  view: "list",
  detailId: null,
  detailDate: null,
  busy: false,
  stick: true,
};

function escapeHtml(value) {
  const replacements = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value).replace(/[&<>"']/g, (char) => replacements[char]);
}

const ICONS = {
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
};

function icon(name) {
  return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, reduceMotion.matches ? 0 : ms));
}

function findCoworking(id) {
  return coworkings.find((item) => item.id === id);
}

function toIsoDate(date) {
  return date.toLocaleDateString("en-CA");
}

function parseIso(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDay(iso, withWeekday = false) {
  const options = { day: "numeric", month: "long" };
  if (withWeekday) options.weekday = "long";
  return parseIso(iso).toLocaleDateString("ru-RU", options);
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ session: state.session, messages: state.messages }));
  } catch (error) {
  }
}

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (data && data.session && Array.isArray(data.messages) && data.messages.length) return data;
  } catch (error) {
  }
  return null;
}

function renderProgress() {
  $("#progress").innerHTML = briefProgress(state.session)
    .map((step, index) => `
      <li class="step ${step.state}">
        <span><span class="mono">0${index + 1}</span>${escapeHtml(step.label)}</span>
      </li>`)
    .join("");
}

function isNearBottom() {
  return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
}

function scrollToBottom(force = false) {
  if (force) state.stick = true;
  if (state.stick) feed.scrollTo({ top: feed.scrollHeight, behavior: force ? "instant" : "smooth" });
}

feed.addEventListener("wheel", (event) => {
  if (event.deltaY < 0) state.stick = false;
}, { passive: true });
feed.addEventListener("touchmove", () => {
  state.stick = isNearBottom();
}, { passive: true });
feed.addEventListener("scroll", () => {
  if (isNearBottom()) state.stick = true;
}, { passive: true });

function appendMe(text, { animate = true } = {}) {
  const element = document.createElement("div");
  element.className = `line me ${animate ? "" : "static"}`;
  element.innerHTML = `<span class="who">вы</span><p></p>`;
  element.querySelector("p").textContent = text;
  feed.append(element);
}

function ticketLineHtml(booking) {
  const coworking = findCoworking(booking.id);
  return `
    <div class="ticket-line reveal">
      <span class="mono">${escapeHtml(booking.code)}</span>
      <span>«${escapeHtml(coworking.name)}», ${escapeHtml(formatDay(booking.date))}</span>
    </div>`;
}

async function streamText(element, text) {
  if (reduceMotion.matches) {
    element.textContent = text;
    return;
  }
  const tokens = text.split(/(\s+)/);
  const words = tokens.filter((token) => token.trim()).length;
  const delay = Math.max(10, Math.min(30, 900 / words));
  for (const token of tokens) {
    if (!token) continue;
    if (token.trim()) {
      const span = document.createElement("span");
      span.className = "word";
      span.textContent = token;
      element.append(span);
      await wait(delay);
    } else {
      element.append(document.createTextNode(token));
    }
    scrollToBottom();
  }
}

async function appendBot(reply, { animate = true } = {}) {
  const element = document.createElement("div");
  element.className = `line bot ${animate ? "" : "static"}`;
  element.innerHTML = `
    <span class="who">ии</span>
    <div class="say ${animate ? "pending" : ""}">
      ${reply.text ? '<p class="say-text"></p>' : ""}
      ${reply.question ? `<p class="say-q reveal">${escapeHtml(reply.question)}</p>` : ""}
      ${reply.booking ? ticketLineHtml(reply.booking) : ""}
    </div>`;
  feed.append(element);

  const text = element.querySelector(".say-text");
  if (!animate) {
    if (text) text.textContent = reply.text;
    return;
  }
  if (text) await streamText(text, reply.text);
  element.querySelector(".say").classList.remove("pending");
  scrollToBottom();
}

function showTyping() {
  const element = document.createElement("div");
  element.className = "line bot";
  element.innerHTML = `<span class="who">ии</span><div class="typing" aria-label="Консультант печатает"><span></span><span></span><span></span></div>`;
  feed.append(element);
  scrollToBottom();
  return element;
}

function renderAnswers(reply) {
  state.options = (reply && reply.options) || [];
  state.multi = Boolean(reply && reply.multi);
  state.picked.clear();

  const buttons = state.options.map((option, index) => `
    <button class="opt" type="button" style="--i:${index}" data-opt="${index}"
      ${state.multi ? 'aria-pressed="false"' : ""}>${escapeHtml(option.label)}</button>`);
  if (state.multi) {
    buttons.push(`<button class="opt primary" type="button" style="--i:${buttons.length}" data-done>Готово →</button>`);
  }
  answers.innerHTML = buttons.join("");
}

function handleOption(index) {
  const option = state.options[index];
  if (!option || state.busy) return;

  if (state.multi) {
    const button = answers.querySelector(`[data-opt="${index}"]`);
    if (state.picked.has(index)) state.picked.delete(index);
    else state.picked.add(index);
    button.setAttribute("aria-pressed", String(state.picked.has(index)));
    return;
  }

  if (option.action) {
    runAction(option.action);
    return;
  }
  send(option.label, option.send || option.label);
}

function submitMulti() {
  const labels = [...state.picked].sort((a, b) => a - b).map((index) => state.options[index].label);
  if (labels.length) send(labels.join(", "));
  else send("Не важно");
}

function runAction(action) {
  if (action.type === "book") openDetail(action.id, { focusBooking: true });
  if (action.type === "compare") {
    setView("compare");
    openBoard();
  }
  if (action.type === "reset") resetBrief();
  if (action.type === "remove") removeToken(action.key);
  if (action.type === "close") closeDetail();
}

async function deliver(result, userText) {
  state.busy = true;
  updateSendState();
  answers.innerHTML = "";

  if (userText) {
    appendMe(userText);
    state.messages.push({ role: "me", text: userText });
  }
  scrollToBottom(true);

  const typing = showTyping();
  await wait(380 + Math.random() * 380);
  typing.remove();

  state.session = result.session;
  state.messages.push({ role: "bot", reply: result.reply });
  save();

  renderProgress();
  if (result.reply.view) setView(result.reply.view);
  renderBoard({ animate: true });

  await appendBot(result.reply);
  renderAnswers(result.reply);
  scrollToBottom();
  state.busy = false;
  updateSendState();

  if (result.reply.open) openDetail(result.reply.open, { focusBooking: true });
  else if (result.reply.view && mobile.matches) openBoard();
}

function send(displayText, parseText = displayText) {
  const text = displayText.trim();
  if (!text || state.busy) return;
  input.value = "";
  updateSendState();
  deliver(respond(parseText, state.session), text);
}

function removeToken(key) {
  if (state.busy) return;
  deliver(removeFromBrief(key, state.session), null);
}

function resetBrief() {
  if (state.busy) return;
  closeDetail();
  state.messages = [];
  feed.innerHTML = "";
  setView("list");
  deliver(greeting(), null);
}

function tileHtml(item, { hasFilters, isBest, hits }) {
  const coworking = item.coworking;
  const amenities = coworking.amenities
    .map((name) => `<li class="${hits.includes(name) ? "hit" : ""}">${escapeHtml(name)}</li>`)
    .join("");
  const miss = hasFilters && item.missing.length
    ? `<p class="tile-miss">не хватает: ${escapeHtml(item.missing.slice(0, 2).join(", "))}</p>`
    : "";
  return `
    <div class="tile-top">
      <span>${escapeHtml(coworking.docId)}</span>
      ${isBest ? '<span class="best-badge">лучшее</span>' : ""}
      <span class="tile-price">${coworking.price} ₽</span>
    </div>
    <h3>${escapeHtml(coworking.name)}</h3>
    <p class="tile-place">${escapeHtml(coworking.city)} · ${escapeHtml(coworking.hours)} · до ${coworking.team} чел.</p>
    <ul class="amen">${amenities}</ul>
    ${miss}`;
}

function renderGrid(ranking, criteria, animate) {
  const hasFilters = hasCriteria(criteria);
  const bestId = hasFilters && ranking.exact.length ? ranking.exact[0].id : null;
  const before = new Map();
  [...grid.children].forEach((element) => before.set(element.dataset.open, element.getBoundingClientRect()));

  ranking.all.forEach((item) => {
    let element = grid.querySelector(`[data-open="${item.id}"]`);
    if (!element) {
      element = document.createElement("article");
      element.className = "tile";
      element.tabIndex = 0;
      element.dataset.open = String(item.id);
      element.innerHTML = `<img class="tile-photo" src="${escapeHtml(item.coworking.photo.src)}" alt="" decoding="async"><div class="tile-body"></div>`;
    }
    const isMatch = item.missing.length === 0;
    element.classList.toggle("is-off", hasFilters && !isMatch);
    element.classList.toggle("is-best", item.id === bestId);
    element.setAttribute("aria-label", `${item.coworking.name}, ${item.coworking.price} рублей${isMatch ? "" : ", не подходит"}`);
    element.querySelector(".tile-body").innerHTML = tileHtml(item, { hasFilters, isBest: item.id === bestId, hits: criteria.amenities });
    grid.append(element);
  });

  if (!animate || reduceMotion.matches) return;
  [...grid.children].forEach((element) => {
    const first = before.get(element.dataset.open);
    if (!first) return;
    const last = element.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (!dx && !dy) return;
    element.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: 560, easing: "cubic-bezier(0.22, 0.8, 0.24, 1)" }
    );
  });
}

function renderCompare(ranking) {
  const items = ranking.exact.slice(0, 4).map((item) => item.coworking);
  if (items.length < 2) {
    compareView.innerHTML = `<p class="empty-note">Для сравнения нужно хотя бы два подходящих места.</p>`;
    return;
  }
  const hits = state.session.criteria.amenities;
  const minPrice = Math.min(...items.map((item) => item.price));
  const amenityNames = [...new Set(items.flatMap((item) => item.amenities))];
  const row = (label, cells, className = "") => `<tr><th scope="row" class="${className}">${label}</th>${cells}</tr>`;
  const head = items
    .map((item) => `<th scope="col">${escapeHtml(item.name)}<small>${escapeHtml(item.docId)}</small></th>`)
    .join("");
  const rows = [
    row("Цена", items.map((item) => `<td class="${item.price === minPrice ? "best" : ""}">${item.price} ₽</td>`).join("")),
    row("Город", items.map((item) => `<td>${escapeHtml(item.city)}</td>`).join("")),
    row("Часы", items.map((item) => `<td>${escapeHtml(item.hours)}</td>`).join("")),
    row("Команда", items.map((item) => `<td>до ${item.team} чел.</td>`).join("")),
    ...amenityNames.map((name) =>
      row(
        escapeHtml(name),
        items.map((item) => `<td class="${item.amenities.includes(name) ? "yes" : "no"}"></td>`).join(""),
        hits.includes(name) ? "hit" : ""
      )),
  ].join("");
  compareView.innerHTML = `
    <div class="compare-wrap">
      <table class="compare"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>
    </div>`;
}

function renderTokens(criteria) {
  const tokens = criteriaTokens(criteria);
  $("#tokens").innerHTML = tokens.length
    ? tokens.map((token) => `
        <span class="token">${escapeHtml(token.label)}
          <button type="button" data-remove="${escapeHtml(token.key)}" aria-label="Убрать условие ${escapeHtml(token.label)}">${icon("close")}</button>
        </span>`).join("")
    : "";
}

function renderBoard({ animate = false } = {}) {
  const criteria = state.session.criteria;
  const ranking = rankCoworkings(criteria);
  const total = coworkings.length;
  const count = ranking.exact.length;

  $("#countNum").textContent = String(count).padStart(2, "0");
  $("#countTotal").textContent = total;
  $("#pillCount").textContent = `${count}/${total}`;
  renderTokens(criteria);
  renderGrid(ranking, criteria, animate);
  if (state.view === "compare") renderCompare(ranking);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".segmented [data-view]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.view === view));
  });
  grid.hidden = view !== "list";
  compareView.hidden = view !== "compare";
  if (view === "compare") renderCompare(rankCoworkings(state.session.criteria));
}

function dateButtons() {
  const today = new Date();
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    const label = offset === 0 ? "сегодня" : offset === 1 ? "завтра"
      : date.toLocaleDateString("ru-RU", { weekday: "short" });
    return `
      <button class="date" type="button" data-date="${toIsoDate(date)}" aria-pressed="false">
        <small>${label}</small><strong>${date.getDate()}</strong>
      </button>`;
  }).join("");
}

function bookingHtml() {
  return `
    <section class="booking" id="booking" aria-label="Бронирование">
      <h3>Когда придёте?</h3>
      <div class="dates">${dateButtons()}</div>
      <label class="other-date">другая
        <input type="date" id="otherDate" min="${toIsoDate(new Date())}">
      </label>
      <button class="book-btn" id="bookButton" type="button" disabled>Забронировать (демо)</button>
      <p class="booking-hint" id="bookingHint" role="status"></p>
    </section>`;
}

function openDetail(id, { focusBooking = false } = {}) {
  const coworking = findCoworking(id);
  if (!coworking) return;
  state.detailId = id;
  state.detailDate = null;

  const item = rankCoworkings(state.session.criteria).all.find((entry) => entry.id === id);
  const verdict = !hasCriteria(state.session.criteria)
    ? ""
    : item.missing.length ? `не хватает: ${item.missing.join(", ")}` : "подходит";

  detailContent.innerHTML = `
    <button class="back" type="button" id="detailBack">${icon("back")} К подборке</button>
    <figure class="detail-photo">
      <img src="${escapeHtml(coworking.photo.src)}" alt="Интерьер, похожий на «${escapeHtml(coworking.name)}»">
      <figcaption>Фото: <a href="${escapeHtml(coworking.photo.url)}" target="_blank" rel="noopener">${escapeHtml(coworking.photo.author)}</a>, ${escapeHtml(coworking.photo.license)}, Wikimedia Commons</figcaption>
    </figure>
    <p class="detail-kicker">${escapeHtml(coworking.city)} · ${escapeHtml(coworking.docId)}</p>
    <h2 id="detailTitle">${escapeHtml(coworking.name)}</h2>
    <p class="detail-desc">${escapeHtml(coworking.desc)}</p>
    <dl class="facts">
      <div><dt>Цена</dt><dd class="mono">${coworking.price} ₽ / день</dd></div>
      <div><dt>Часы</dt><dd>${escapeHtml(coworking.hours)}</dd></div>
      <div><dt>Адрес</dt><dd>${escapeHtml(coworking.address)}</dd></div>
      <div><dt>Удобства</dt><dd>${escapeHtml(coworking.amenities.join(", "))}</dd></div>
      ${verdict ? `<div><dt>По брифу</dt><dd>${escapeHtml(verdict)}</dd></div>` : ""}
    </dl>
    ${bookingHtml()}`;

  detail.scrollTop = 0;
  detail.setAttribute("aria-hidden", "false");
  document.body.classList.add("detail-open");
  openBoard();
  setTimeout(() => {
    $("#detailBack").focus({ preventScroll: true });
    if (focusBooking) $("#booking").scrollIntoView({ behavior: "smooth", block: "end" });
  }, reduceMotion.matches ? 0 : 320);
}

function closeDetail() {
  if (!document.body.classList.contains("detail-open")) return;
  document.body.classList.remove("detail-open");
  detail.setAttribute("aria-hidden", "true");
}

function selectDate(iso) {
  state.detailDate = iso || null;
  detailContent.querySelectorAll(".date").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.date === iso));
  });
  if (detailContent.querySelector(`.date[data-date="${iso}"]`)) $("#otherDate").value = "";
  $("#bookButton").disabled = !iso;
  $("#bookingHint").textContent = iso ? formatDay(iso, true) : "";
}

function confirmBooking() {
  const { detailId, detailDate } = state;
  if (!detailId || !detailDate || state.busy) return;
  const coworking = findCoworking(detailId);
  const code = `DEMO-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  $("#booking").outerHTML = `
    <div class="ticket booking" role="status">
      <span class="ticket-label">демо-билет</span>
      <strong>${escapeHtml(formatDay(detailDate, true))}</strong>
      <span class="ticket-code">${code}</span>
      <p>Это имитация — место не зарезервировано.</p>
    </div>`;

  deliver({
    reply: {
      text: "Готово, демо-бронь оформлена.",
      booking: { id: detailId, date: detailDate, code },
      options: [
        { label: "К подборке", action: { type: "close" } },
        { label: "Новый бриф", action: { type: "reset" } },
      ],
    },
    session: state.session,
  }, null);
}

function updateSendState() {
  sendButton.disabled = state.busy || !input.value.trim();
}

function currentTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit) return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  const apply = () => {
    document.documentElement.dataset.theme = next;
  };
  if (document.startViewTransition && !reduceMotion.matches) document.startViewTransition(apply);
  else apply();
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (error) {
  }
}

function openBoard() {
  if (mobile.matches) document.body.classList.add("board-open");
}

function closeBoard() {
  document.body.classList.remove("board-open");
}

$("#composer").addEventListener("submit", (event) => {
  event.preventDefault();
  send(input.value);
});
input.addEventListener("input", updateSendState);

answers.addEventListener("click", (event) => {
  const option = event.target.closest("[data-opt]");
  if (option) handleOption(Number(option.dataset.opt));
  else if (event.target.closest("[data-done]")) submitMulti();
});

document.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove]");
  if (remove) {
    removeToken(remove.dataset.remove);
    return;
  }
  const open = event.target.closest("[data-open]");
  if (open) openDetail(Number(open.dataset.open));
});

grid.addEventListener("keydown", (event) => {
  const tile = event.target.closest("[data-open]");
  if (tile && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openDetail(Number(tile.dataset.open));
  }
});

detailContent.addEventListener("click", (event) => {
  if (event.target.closest("#detailBack")) closeDetail();
  const date = event.target.closest("[data-date]");
  if (date) selectDate(date.dataset.date);
  if (event.target.closest("#bookButton")) confirmBooking();
});

detailContent.addEventListener("change", (event) => {
  if (event.target.id === "otherDate") selectDate(event.target.value);
});

document.querySelectorAll(".segmented [data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

$("#resetBrief").addEventListener("click", resetBrief);
$("#brand").addEventListener("click", (event) => {
  event.preventDefault();
  resetBrief();
});
$("#themeToggle").addEventListener("click", toggleTheme);
$("#boardPill").addEventListener("click", openBoard);
$("#boardClose").addEventListener("click", closeBoard);
$("#scrim").addEventListener("click", closeBoard);

$("#openAbout").addEventListener("click", () => about.showModal());
$("#aboutClose").addEventListener("click", () => about.close());
about.addEventListener("click", (event) => {
  if (event.target !== about) return;
  const box = about.getBoundingClientRect();
  const inside = event.clientX >= box.left && event.clientX <= box.right &&
    event.clientY >= box.top && event.clientY <= box.bottom;
  if (!inside) about.close();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (document.body.classList.contains("detail-open")) closeDetail();
  else closeBoard();
});

const saved = load();
if (saved) {
  state.session = saved.session;
  state.messages = saved.messages;
  state.messages.forEach((message) => {
    if (message.role === "me") appendMe(message.text, { animate: false });
    else appendBot(message.reply, { animate: false });
  });
  const lastBot = [...state.messages].reverse().find((message) => message.role === "bot");
  renderProgress();
  renderBoard();
  renderAnswers(lastBot && lastBot.reply);
  scrollToBottom(true);
  if (document.fonts) document.fonts.ready.then(() => scrollToBottom(true));
} else {
  renderProgress();
  renderBoard();
  deliver(greeting(), null);
}
input.focus();
