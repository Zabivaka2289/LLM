// Логика учебного прототипа CoworkingFinder.
// Все данные локальные; реальные бронирования и RAG пока не реализованы.

const $ = (selector) => document.querySelector(selector);
const cardsContainer = $("#cards");
const detailsDialog = $("#details");

// Экранируем пользовательский ввод перед вставкой в HTML.
function escapeHtml(value) {
  const replacements = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return String(value).replace(/[&<>"']/g, (char) => replacements[char]);
}

function getFilteredCoworkings() {
  const query = $("#search").value.toLowerCase().trim();
  const city = $("#city").value;
  const maximumPrice = Number($("#price").value) || Infinity;

  return coworkings.filter((coworking) => {
    const matchesCity = !city || coworking.city === city;
    const matchesPrice = coworking.price <= maximumPrice;
    const searchableText = [
      coworking.name,
      coworking.city,
      coworking.area,
      ...coworking.amenities,
    ].join(" ").toLowerCase();
    const matchesQuery = !query || searchableText.includes(query);

    return matchesCity && matchesPrice && matchesQuery;
  });
}

function createCard(coworking) {
  const amenities = coworking.amenities
    .map((amenity) => `<span>${escapeHtml(amenity)}</span>`)
    .join("");

  return `
    <article class="card">
      <div class="card-image ${coworking.tone}">
        <span class="art-symbol">${coworking.emoji}</span>
        <span class="image-label">КОВОРКИНГ</span>
      </div>
      <div class="card-body">
        <div class="location">
          ⌖ ${escapeHtml(coworking.city)} · ${escapeHtml(coworking.area)}
        </div>
        <h3>${escapeHtml(coworking.name)}</h3>
        <p>${escapeHtml(coworking.desc)}</p>
        <div class="tags">${amenities}</div>
        <div class="card-bottom">
          <div>
            <strong>${coworking.price} ₽</strong>
            <small> / день</small>
          </div>
          <button class="button outline" data-id="${coworking.id}">
            Подробнее ↗
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderCatalog() {
  const filtered = getFilteredCoworkings();
  $("#count").textContent = `Найдено пространств: ${filtered.length}`;

  cardsContainer.innerHTML = filtered.length
    ? filtered.map(createCard).join("")
    : `<div class="empty">
         По этим параметрам ничего не найдено. Попробуйте изменить фильтры.
       </div>`;
}

function resetFilters() {
  $("#search").value = "";
  $("#city").value = "";
  $("#price").value = "";
  renderCatalog();
}

function openCoworkingDetails(id) {
  const coworking = coworkings.find((item) => item.id === id);
  if (!coworking) return;

  const amenities = coworking.amenities
    .map((amenity) => `<span>${escapeHtml(amenity)}</span>`)
    .join("");
  const today = new Date().toLocaleDateString("en-CA");

  $("#detailsContent").innerHTML = `
    <div class="modal-art ${coworking.tone}">${coworking.emoji}</div>
    <div class="modal-body">
      <div class="location">
        ⌖ ${escapeHtml(coworking.city)} · ${escapeHtml(coworking.area)}
      </div>
      <h2>${escapeHtml(coworking.name)}</h2>
      <p>${escapeHtml(coworking.desc)}</p>
      <div class="modal-info">
        <div>
          <small>Цена</small>
          <strong>${coworking.price} ₽ / день</strong>
        </div>
        <div>
          <small>Время работы</small>
          <strong>${escapeHtml(coworking.hours)}</strong>
        </div>
      </div>
      <div class="tags">${amenities}</div>
      <label class="date-label">
        Выберите дату
        <input id="bookingDate" type="date" min="${today}">
      </label>
      <button id="book" class="button primary full">
        Забронировать (демо) ↗
      </button>
      <p id="bookingResult" class="booking-result" role="status"></p>
    </div>
  `;

  detailsDialog.showModal();
  $("#book").addEventListener("click", confirmDemoBooking);
}

function confirmDemoBooking() {
  const selectedDate = $("#bookingDate").value;
  const result = $("#bookingResult");

  result.textContent = selectedDate
    ? `✓ Демонстрационное бронирование на ${selectedDate} оформлено! ` +
      `(Не является реальной бронью.)`
    : "Сначала выберите дату.";
}

function handleAssistantMessage(event) {
  event.preventDefault();
  const question = $("#question").value.trim();
  if (!question) return;

  const messages = $("#chatMessages");
  messages.insertAdjacentHTML("beforeend", `
    <div class="bubble user">${escapeHtml(question)}</div>
    <div class="bubble bot">
      <strong>Пример ответа:</strong>
      По вашему запросу можно было бы подобрать несколько коворкингов
      из каталога и объяснить выбор, ссылаясь на их описания.
      <br><br>
      <small>
        Это заглушка: поиск BM25 и генерация LLM ещё не реализованы.
      </small>
    </div>
  `);

  $("#question").value = "";
  messages.scrollTop = messages.scrollHeight;
}

// Обработчики событий интерфейса.
["#search", "#city", "#price"].forEach((selector) => {
  $(selector).addEventListener("input", renderCatalog);
});

$("#reset").addEventListener("click", resetFilters);

cardsContainer.addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");
  if (button) openCoworkingDetails(Number(button.dataset.id));
});

$("#close").addEventListener("click", () => detailsDialog.close());

detailsDialog.addEventListener("click", (event) => {
  if (event.target === detailsDialog) detailsDialog.close();
});

$("#chatForm").addEventListener("submit", handleAssistantMessage);

renderCatalog();
