function wordStart(stem) {
  return new RegExp(`(^|[^а-яa-z0-9])${stem}`);
}

const CITIES = [
  { name: "Москва", patterns: [/москв/, wordStart("мск")] },
  { name: "Санкт-Петербург", patterns: [/петербург/, /питер/, wordStart("спб"), wordStart("санкт")] },
  { name: "Казань", patterns: [/казан/] },
];

const AMENITIES = [
  { name: "Wi-Fi", lower: "Wi-Fi", pattern: /wi-?fi|вай-?фай|интернет/ },
  { name: "Кофе", lower: "кофе", pattern: /кофе|кухн|перекус/ },
  { name: "Переговорная", lower: "переговорная", pattern: /переговор|встреч|созвон/ },
  { name: "Парковка", lower: "парковка", pattern: /парков|на машине|авто(?!бус)/ },
  { name: "Принтер", lower: "принтер", pattern: /принтер|печат/ },
  { name: "Тихая зона", lower: "тихая зона", pattern: /тих|спокойн|фокус|сосредоточ|без шума/ },
];

function normalize(text) {
  return String(text).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function formatHour(hour) {
  return hour >= 24 ? "00:00" : `${String(hour).padStart(2, "0")}:00`;
}

function emptyCriteria() {
  return {
    city: null,
    maxPrice: null,
    amenities: [],
    excluded: [],
    openUntil: null,
    lateLabel: null,
    allDay: false,
    openBy: null,
    teamSize: null,
    cheap: false,
  };
}

function hasCriteria(criteria) {
  return Boolean(
    criteria.city ||
      criteria.maxPrice ||
      criteria.amenities.length ||
      criteria.openUntil ||
      criteria.allDay ||
      criteria.openBy ||
      criteria.teamSize ||
      criteria.cheap
  );
}

function parseCriteria(text) {
  const t = normalize(text);
  const criteria = emptyCriteria();

  const city = CITIES.find((item) => item.patterns.some((pattern) => pattern.test(t)));
  if (city) criteria.city = city.name;

  AMENITIES.forEach((amenity) => {
    const match = t.match(amenity.pattern);
    if (!match) return;
    const before = t.slice(Math.max(0, match.index - 5), match.index);
    if (/без\s*$/.test(before) && amenity.name !== "Тихая зона") {
      criteria.excluded.push(amenity.name);
    } else {
      criteria.amenities.push(amenity.name);
    }
  });

  let rest = t;
  if (/круглосуточ|24\/7|24 часа|ночью|ночь/.test(t)) criteria.allDay = true;

  const afterMatch = t.match(/после\s*(\d{1,2})(?:[:.]00)?/);
  if (afterMatch && Number(afterMatch[1]) < 24) {
    criteria.openUntil = Number(afterMatch[1]) + 1;
    criteria.lateLabel = `после ${formatHour(Number(afterMatch[1]))}`;
    rest = rest.replace(afterMatch[0], " ");
  }
  const untilMatch = t.match(/до\s*(\d{1,2})(?:[:.]00|\s*(?:час|вечера))/);
  if (untilMatch && Number(untilMatch[1]) <= 24) {
    criteria.openUntil = Math.max(criteria.openUntil || 0, Number(untilMatch[1]));
    criteria.lateLabel = `до ${formatHour(criteria.openUntil)}`;
    rest = rest.replace(untilMatch[0], " ");
  }
  if (!criteria.openUntil && !criteria.allDay && /допоздна|поздно|вечер/.test(t)) {
    criteria.openUntil = 23;
    criteria.lateLabel = "допоздна";
  }

  const fromMatch = t.match(/с\s*(\d{1,2})[:.]00/);
  if (fromMatch) {
    criteria.openBy = Number(fromMatch[1]);
    rest = rest.replace(fromMatch[0], " ");
  } else if (/рано|с утра|утром|жаворон/.test(t)) {
    criteria.openBy = 8;
  }

  const teamMatch = rest.match(/(?:нас|на|для|из)?\s*(\d{1,2})\s*(?:человек|чел|участник)/) ||
    rest.match(/нас\s*(\d{1,2})/);
  if (teamMatch) {
    criteria.teamSize = Number(teamMatch[1]);
    rest = rest.replace(teamMatch[0], " ");
  } else if (/команд|коллег|группой|вместе с/.test(t)) {
    criteria.teamSize = 4;
  }

  const priceMatch =
    rest.match(/(?:до|не дороже|дешевле|меньше|максимум|макс|в пределах|бюджет|за)\s*(\d[\d\s]{1,6})/) ||
    rest.match(/(\d{3,5})\s*(?:₽|р(?![а-я])|руб)/);
  if (priceMatch) {
    const value = Number(priceMatch[1].replace(/\s/g, ""));
    if (value >= 100) criteria.maxPrice = value;
  }

  if (/дешев|недорог|бюджетн|эконом/.test(t)) criteria.cheap = true;

  return criteria;
}

function mergeCriteria(previous, next) {
  const merged = { ...previous };
  ["city", "maxPrice", "openUntil", "lateLabel", "openBy", "teamSize"].forEach((key) => {
    if (next[key]) merged[key] = next[key];
  });
  if (next.allDay) {
    merged.allDay = true;
    merged.openUntil = null;
    merged.lateLabel = null;
  }
  if (next.openUntil) merged.allDay = false;
  merged.cheap = previous.cheap || next.cheap;
  merged.amenities = [...new Set([...previous.amenities, ...next.amenities])].filter(
    (name) => !next.excluded.includes(name)
  );
  merged.excluded = [];
  return merged;
}

function buildChecks(criteria) {
  const checks = [];

  if (criteria.city) {
    checks.push({
      weight: 2,
      test: (c) => c.city === criteria.city,
      ok: (c) => c.city,
      miss: (c) => `другой город — ${c.city}`,
    });
  }
  if (criteria.maxPrice) {
    checks.push({
      weight: 1,
      test: (c) => c.price <= criteria.maxPrice,
      ok: (c) => `${c.price} ₽`,
      miss: (c) => `дороже бюджета: ${c.price} ₽`,
    });
  }
  criteria.amenities.forEach((name) => {
    const amenity = AMENITIES.find((item) => item.name === name);
    checks.push({
      weight: 1,
      test: (c) => c.amenities.includes(name),
      ok: () => amenity.lower,
      miss: () => `нет: ${amenity.lower}`,
    });
  });
  if (criteria.allDay) {
    checks.push({
      weight: 1,
      test: (c) => c.open === 0 && c.close >= 24,
      ok: () => "круглосуточно",
      miss: (c) => `не круглосуточно: ${c.hours}`,
    });
  } else if (criteria.openUntil) {
    checks.push({
      weight: 1,
      test: (c) => c.close >= criteria.openUntil,
      ok: (c) => (c.close >= 24 && c.open === 0 ? "круглосуточно" : `до ${formatHour(c.close)}`),
      miss: (c) => `закрывается в ${formatHour(c.close)}`,
    });
  }
  if (criteria.openBy) {
    checks.push({
      weight: 1,
      test: (c) => c.open <= criteria.openBy,
      ok: (c) => (c.open === 0 ? "круглосуточно" : `с ${formatHour(c.open)}`),
      miss: (c) => `открывается только в ${formatHour(c.open)}`,
    });
  }
  if (criteria.teamSize) {
    checks.push({
      weight: 1,
      test: (c) => c.team >= criteria.teamSize,
      ok: (c) => `до ${c.team} человек`,
      miss: (c) => `только до ${c.team} человек`,
    });
  }

  return checks;
}

function rankCoworkings(criteria, list = coworkings) {
  const checks = buildChecks(criteria);
  const scored = list.map((coworking) => {
    const reasons = [];
    const missing = [];
    let score = 0;
    let total = 0;
    checks.forEach((check) => {
      total += check.weight;
      if (check.test(coworking)) {
        score += check.weight;
        reasons.push(check.ok(coworking));
      } else {
        missing.push(check.miss(coworking));
      }
    });
    if (!checks.length) reasons.push(`${coworking.price} ₽ в день · ${coworking.hours}`);
    return { id: coworking.id, coworking, reasons, missing, score, ratio: total ? score / total : 1 };
  });

  const byPrice = (a, b) => a.coworking.price - b.coworking.price;
  const exact = scored.filter((item) => item.missing.length === 0).sort(byPrice);
  let partial = scored.filter((item) => item.missing.length > 0 && item.score > 0);
  const sameCity = partial.filter((item) => item.coworking.city === criteria.city);
  if (sameCity.length) partial = sameCity;
  partial = partial.sort((a, b) => b.ratio - a.ratio || byPrice(a, b)).slice(0, 3);
  const all = [...scored].sort(
    (a, b) => (a.missing.length === 0 ? 0 : 1) - (b.missing.length === 0 ? 0 : 1) ||
      b.ratio - a.ratio || byPrice(a, b)
  );

  return { exact, partial, all };
}

function criteriaTokens(criteria) {
  const tokens = [];
  if (criteria.city) tokens.push({ key: "city", label: criteria.city });
  if (criteria.maxPrice) tokens.push({ key: "maxPrice", label: `до ${criteria.maxPrice} ₽` });
  criteria.amenities.forEach((name) => tokens.push({ key: `amenity:${name}`, label: name }));
  if (criteria.allDay) tokens.push({ key: "allDay", label: "круглосуточно" });
  else if (criteria.openUntil) tokens.push({ key: "late", label: criteria.lateLabel });
  if (criteria.openBy) tokens.push({ key: "openBy", label: `с ${formatHour(criteria.openBy)}` });
  if (criteria.teamSize) tokens.push({ key: "team", label: `от ${criteria.teamSize} чел.` });
  if (criteria.cheap) tokens.push({ key: "cheap", label: "подешевле" });
  return tokens;
}

function removeCriterion(criteria, key) {
  const next = { ...criteria, amenities: [...criteria.amenities] };
  if (key === "city") next.city = null;
  if (key === "maxPrice") next.maxPrice = null;
  if (key === "allDay") next.allDay = false;
  if (key === "late") {
    next.openUntil = null;
    next.lateLabel = null;
  }
  if (key === "openBy") next.openBy = null;
  if (key === "team") next.teamSize = null;
  if (key === "cheap") next.cheap = false;
  if (key.startsWith("amenity:")) next.amenities = next.amenities.filter((name) => `amenity:${name}` !== key);
  return next;
}

function findCoworkingByName(text) {
  const t = normalize(text);
  return coworkings.find((coworking) => {
    const stem = normalize(coworking.name).split(" ")[0].replace(/[аяоеьыиу]$/, "");
    return wordStart(stem).test(t);
  });
}

const BRIEF = [
  {
    slot: "city",
    label: "Город",
    question: "В каком городе?",
    options: [{ label: "Москва" }, { label: "Санкт-Петербург" }, { label: "Казань" }, { label: "Не важно" }],
    filled: (c) => Boolean(c.city),
  },
  {
    slot: "budget",
    label: "Бюджет",
    question: "Бюджет на день?",
    options: [{ label: "до 600 ₽" }, { label: "до 800 ₽" }, { label: "до 1000 ₽" }, { label: "Не важно" }],
    filled: (c) => Boolean(c.maxPrice),
  },
  {
    slot: "needs",
    label: "Условия",
    question: "Что важно на месте?",
    multi: true,
    options: ["Переговорная", "Тихая зона", "Кофе", "Парковка", "Принтер", "Допоздна", "Круглосуточно"]
      .map((label) => ({ label })),
    filled: (c) => Boolean(c.amenities.length || c.openUntil || c.allDay || c.openBy),
  },
  {
    slot: "team",
    label: "Команда",
    question: "Сколько вас?",
    options: [
      { label: "Только я", send: "не важно" },
      { label: "2–4 человека", send: "нас 2 человек" },
      { label: "5 и больше", send: "нас 5 человек" },
    ],
    filled: (c) => Boolean(c.teamSize),
  },
];

const TOKEN_SLOT = { city: "city", maxPrice: "budget", team: "team", cheap: "budget" };

const SKIP = /^(не важно|неважно|любой|любая|любое|без разницы|все равно|пропусти|дальше|только я|я один|одна|один|не знаю)/;

function newSession() {
  return { criteria: emptyCriteria(), skipped: [] };
}

function copySession(session) {
  return {
    criteria: { ...session.criteria, amenities: [...session.criteria.amenities], excluded: [] },
    skipped: [...session.skipped],
  };
}

function nextSlot(session) {
  return BRIEF.find((step) => !step.filled(session.criteria) && !session.skipped.includes(step.slot)) || null;
}

function briefProgress(session) {
  const next = nextSlot(session);
  return BRIEF.map((step) => {
    let state = "todo";
    if (step.filled(session.criteria) || session.skipped.includes(step.slot)) state = "done";
    else if (next && next.slot === step.slot) state = "current";
    return { slot: step.slot, label: step.label, state };
  });
}

function afterUpdate(session) {
  const { exact } = rankCoworkings(session.criteria);
  const next = nextSlot(session);

  if (!exact.length) {
    return {
      reply: {
        text: "Под все условия ничего не подходит. Снимите одно:",
        question: null,
        options: criteriaTokens(session.criteria).map((token) => ({
          label: `Убрать: ${token.label}`,
          action: { type: "remove", key: token.key },
        })),
      },
      session,
    };
  }

  if (next && exact.length > 1) {
    return {
      reply: { text: "", question: next.question, slot: next.slot, multi: Boolean(next.multi), options: next.options },
      session,
    };
  }

  const best = exact[0];
  const why = best.reasons.filter((reason) => reason !== best.coworking.city).slice(0, 2);
  const lead = exact.length === 1 ? "Подходит одно место" : "Лучшее";

  return {
    reply: {
      text: `${lead} — «${best.coworking.name}»${why.length ? `: ${why.join(", ")}` : ""}.`,
      question: null,
      recommend: exact.slice(0, 3).map((item) => ({ id: item.id, reasons: item.reasons, missing: [] })),
      best: best.id,
      options: [
        { label: "Забронировать", action: { type: "book", id: best.id } },
        ...(exact.length > 1 ? [{ label: "Сравнить", action: { type: "compare" } }] : []),
        { label: "Новый бриф", action: { type: "reset" } },
      ],
    },
    session,
  };
}

function greeting() {
  const first = BRIEF[0];
  return {
    reply: {
      text: "Подберу коворкинг за четыре вопроса. Отвечайте кнопками или своими словами.",
      question: first.question,
      slot: first.slot,
      options: first.options,
    },
    session: newSession(),
  };
}

function removeFromBrief(key, session) {
  const next = copySession(session);
  next.criteria = removeCriterion(next.criteria, key);
  const slot = TOKEN_SLOT[key] || "needs";
  const step = BRIEF.find((item) => item.slot === slot);
  if (!step.filled(next.criteria) && !next.skipped.includes(slot)) next.skipped.push(slot);
  return afterUpdate(next);
}

function respond(text, session = newSession()) {
  const t = normalize(text);
  const current = copySession(session);
  const step = nextSlot(current);
  const repeat = (lead) => ({
    reply: {
      text: lead,
      question: step ? step.question : null,
      slot: step ? step.slot : null,
      multi: Boolean(step && step.multi),
      options: step ? step.options : [{ label: "Новый бриф", action: { type: "reset" } }],
    },
    session: current,
  });

  if (/^(заново|начать заново|новый бриф|сброс|сбросить|очисти|с начала)/.test(t)) {
    const fresh = greeting();
    fresh.reply.text = "Начнём заново.";
    return fresh;
  }

  if (/умеешь|помощь|help|как (это )?работает|кто ты|что ты/.test(t)) {
    return repeat("Понимаю город, бюджет, удобства, часы и размер команды. Это демо: без нейросети, каталог вымышленный.");
  }

  if (/сравни|сравнение|сопостав/.test(t)) {
    const { exact } = rankCoworkings(current.criteria);
    const enough = exact.length >= 2;
    const result = repeat(enough ? "Сравнение — в подборке." : "Для сравнения нужно хотя бы два места.");
    if (enough) result.reply.view = "compare";
    return result;
  }

  if (/(покажи|показать|открой).{0,12}(все|весь|каталог)|^каталог/.test(t)) {
    const result = repeat("Весь каталог — в подборке.");
    result.reply.view = "list";
    return result;
  }

  const named = /(заброн|бронь|бронир|расскажи|подробн|про |открой)/.test(t) ? findCoworkingByName(t) : null;
  if (named) {
    const booking = /(заброн|бронь|бронир)/.test(t);
    const result = repeat(booking ? `«${named.name}» — выберите дату.` : `Открыл «${named.name}».`);
    result.reply.open = named.id;
    return result;
  }

  const parsed = parseCriteria(t);
  if (!hasCriteria(parsed) && !parsed.excluded.length) {
    if (SKIP.test(t) && step) {
      current.skipped.push(step.slot);
      return afterUpdate(current);
    }
    if (/^(привет|здравств|добр(ый|ое|ого)|хай|hello|hi)/.test(t)) return repeat("Привет!");
    if (/спасибо|благодар|супер|отлично/.test(t)) return repeat("Пожалуйста!");
    return repeat("Не понял — выберите вариант ниже.");
  }

  current.criteria = mergeCriteria(current.criteria, parsed);
  return afterUpdate(current);
}
