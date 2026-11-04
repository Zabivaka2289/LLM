const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const frontend = path.join(__dirname, "..", "frontend");
const context = vm.createContext({});
["data.js", "assistant.js"].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(frontend, file), "utf8"), context, { filename: file });
});
const engine = vm.runInContext(
  "({ respond, greeting, removeFromBrief, rankCoworkings, briefProgress, parseCriteria, coworkings })",
  context
);

const matches = (session) => [...engine.rankCoworkings(session.criteria).exact].map((item) => item.id);
const labels = (reply) => [...(reply.options || [])].map((option) => option.label);

function run(...answers) {
  let result = engine.greeting();
  answers.forEach((answer) => {
    result = engine.respond(answer, result.session);
  });
  return result;
}

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
}

console.log("assistant.js");

test("разбирает город, цену и удобство", () => {
  const criteria = engine.parseCriteria("Москва до 800 ₽ с переговорной");
  assert.strictEqual(criteria.city, "Москва");
  assert.strictEqual(criteria.maxPrice, 800);
  assert.deepStrictEqual([...criteria.amenities], ["Переговорная"]);
});

test("«до 22:00» — это часы, а не цена", () => {
  const criteria = engine.parseCriteria("до 22:00 в спб");
  assert.strictEqual(criteria.maxPrice, null);
  assert.strictEqual(criteria.openUntil, 22);
});

test("размер команды не путается с ценой", () => {
  const criteria = engine.parseCriteria("для команды из 6 человек до 900 руб");
  assert.strictEqual(criteria.teamSize, 6);
  assert.strictEqual(criteria.maxPrice, 900);
});

test("приветствие задаёт первый вопрос брифа", () => {
  const { reply } = engine.greeting();
  assert.strictEqual(reply.slot, "city");
  assert.ok(labels(reply).includes("Москва"));
});

test("каждый ответ сужает подборку и переходит к следующему вопросу", () => {
  const afterCity = run("Москва");
  assert.strictEqual(matches(afterCity.session).length, 4);
  assert.strictEqual(afterCity.reply.slot, "budget");
  const afterBudget = run("Москва", "до 800 ₽");
  assert.strictEqual(matches(afterBudget.session).length, 3);
  assert.strictEqual(afterBudget.reply.slot, "needs");
});

test("полный бриф даёт итог только с подходящими местами", () => {
  const { reply, session } = run("Москва", "до 800 ₽", "Переговорная", "не важно");
  assert.strictEqual(reply.question, null);
  assert.deepStrictEqual(matches(session), [1, 5]);
  assert.strictEqual(reply.best, 1);
  [...reply.recommend].forEach((item) => assert.strictEqual(item.missing.length, 0));
  assert.ok(briefProgress(session).every((step) => step.state === "done"));
});

test("одна фраза закрывает несколько вопросов", () => {
  const { reply } = run("Москва до 800 ₽ с переговорной");
  assert.strictEqual(reply.slot, "team");
});

test("«Не важно» пропускает вопрос", () => {
  const { reply, session } = run("Не важно");
  assert.strictEqual(reply.slot, "budget");
  assert.ok([...session.skipped].includes("city"));
});

test("без совпадений — кнопки снять условие, у мест видно, чего не хватает", () => {
  const { reply, session } = run("круглосуточно в Казани");
  assert.strictEqual(matches(session).length, 0);
  assert.ok(labels(reply).every((label) => label.startsWith("Убрать:")));
  [...engine.rankCoworkings(session.criteria).all].forEach((item) => assert.ok(item.missing.length > 0));
});

test("пока бриф не закончен, помощник отвечает только вопросом", () => {
  const { reply } = run("Москва");
  assert.strictEqual(reply.text, "");
  assert.ok(reply.question);
});

test("снятие условия обновляет подборку и не задаёт вопрос заново", () => {
  const before = run("круглосуточно в Казани");
  const { session } = engine.removeFromBrief("city", before.session);
  assert.deepStrictEqual(matches(session), [2, 8]);
  assert.ok([...session.skipped].includes("city"));
});

test("непонятный ответ повторяет текущий вопрос", () => {
  const { reply } = run("Москва", "asdf");
  assert.strictEqual(reply.slot, "budget");
});

test("сравнение включается, когда подходят хотя бы два места", () => {
  assert.strictEqual(run("Москва", "сравни").reply.view, "compare");
  assert.strictEqual(run("Москва до 600 ₽", "сравни").reply.view, undefined);
});

test("бронирование по названию открывает карточку", () => {
  assert.strictEqual(run("Забронируй Точку Сборки").reply.open, 1);
});

test("«заново» сбрасывает бриф", () => {
  const { session } = run("Москва", "заново");
  assert.strictEqual(matches(session).length, engine.coworkings.length);
});

test("у каждого места есть документ-источник cw-…", () => {
  [...engine.coworkings].forEach((item) => assert.match(item.docId, /^cw-\d{3}$/));
});

function briefProgress(session) {
  return [...engine.briefProgress(session)];
}

console.log(`\n${passed} passed`);
