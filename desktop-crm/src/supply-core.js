// 비품·자재. 우리가 산 것과, 그것이 지금 어디에 몇 개 있는지.
//
// 이 화면이 있는 이유는 "물건 목록을 갖는 것"이 아니다. 목록은 아무도 안
// 본다. 여기가 다루는 것은 **현장에 나가서야 없는 걸 아는 일**이다.
//
// 청소용품이든 실리콘이든, 없는 걸 현장에서 알면 그날 일이 통째로 밀린다.
// 그래서 이 화면은 "무엇을 샀는가"가 아니라 "지금 몇 개 남았는가"와
// "언제 떨어지는가"를 먼저 보여 준다.
//
// 남은 수량은 저장하지 않는다
//
// 재고 숫자를 칸에 적어 두면, 두 사람이 같은 날 다르게 고치는 순간 그 숫자는
// 아무 뜻이 없어진다. 그래서 여기는 **들어온 것과 나간 것만 적고, 남은 것은
// 그때그때 계산한다.** 급여에서 합계를 서버가 다시 계산하는 것과 같은 이유다.
//
//   입고    샀거나 받았다 (+)
//   사용    현장에서 썼다 (−)
//   폐기    버렸다 (−)
//   실사    세어 보니 실제로 N개였다 (= N 으로 맞춤)
//
// 기록은 지우지 않는다. 잘못 적었으면 반대 기록이나 실사로 바로잡는다.
// 지울 수 있는 장부는 장부가 아니다.
//
// 누가 무엇을 적을 수 있는가
//
// **일하는 사람은 다 적는다.** 처음에는 입고와 실사를 관리자만 하게 뒀다 —
// 아무나 재고를 만들어내면 숫자를 못 믿는다는 이유였다. 대표가 열라고
// 정했고, 그 판단이 맞다. 물건을 받는 사람과 세는 사람이 대표가 아닌데
// 대표만 적게 하면, 받은 날 안 적히고 나중에 기억으로 적힌다. 늦게 적힌
// 숫자보다 그 자리에서 적힌 숫자가 낫다.
//
// 대신 **틀린 것을 지우는 길만 대표에게 남긴다.** 적는 것은 쌓는 일이라
// 틀려도 다음 기록으로 덮이지만, 지우는 것은 되돌릴 수 없다.
//
// 조회 전용 계정은 보기만 한다. 그건 그 계정의 뜻이다.
//
// 하지 않는 것
//
// 1. 자동으로 발주하지 않는다. 모자란다고 보여 줄 뿐, 사는 건 사람이 한다.
// 2. 품목을 지우지 않는다. 지우면 과거 기록의 이름이 사라진다. 안 쓰는
//    품목은 '사용 안 함'으로 내린다.
// 3. 수량은 정수만 쓴다. 소수를 허용하면 "실리콘 0.5통"을 두 사람이 다르게
//    센다. 단위를 통·박스로 잡아서 정수로 만든다.
//
// 단가가 따로 있는 이유
//
// supplyCosts 는 품목과 다른 노드다. 원래는 원가를 대표만 보게 하려고
// 나눈 것이었고, 지금은 팀 전체가 본다. 그래도 합치지 않는다 — 다시
// 닫아야 할 날이 오면, 노드가 갈려 있어야 규칙 한 줄로 닫힌다. 합쳐
// 두면 그때는 자료를 옮겨야 한다.
(function attachSupplyCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringSupplyCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createSupplyCore() {
  "use strict";

  const text = (value, limit = 200) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value, 10));

  // 수량은 0 이상 정수. 위 주석의 이유로 소수를 받지 않는다.
  function countOf(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(999999, Math.max(0, Math.round(number)));
  }

  // 분류는 물건을 찾는 순서다. 창고에서 손이 가는 순서로 뒀다.
  const CATEGORIES = Object.freeze([
    { key: "clean", label: "청소용품" },
    { key: "consumable", label: "소모자재" },
    { key: "safety", label: "안전·보호구" },
    { key: "tool", label: "공구·장비" },
    { key: "office", label: "사무용품" },
    { key: "etc", label: "기타" },
  ]);

  // sign 은 재고에 어떻게 반영되는가. 실사(adjust)는 더하고 빼는 것이 아니라
  // "그 숫자로 맞춘다"는 뜻이라 sign 이 0 이다.
  const MOVE_KINDS = Object.freeze([
    { key: "in", label: "입고", sign: 1, needsReason: false },
    { key: "out", label: "사용", sign: -1, needsReason: false },
    { key: "disposal", label: "폐기", sign: -1, needsReason: true },
    { key: "adjust", label: "실사", sign: 0, needsReason: true },
  ]);

  const CATEGORY_KEYS = Object.freeze(CATEGORIES.map(item => item.key));
  const MOVE_KEYS = Object.freeze(MOVE_KINDS.map(item => item.key));

  // 품목에서 나중에 못 바꾸는 것은 없다. 이름·규격은 고쳐 쓰는 게 맞다.
  // 다만 분류를 바꾸면 과거 기록의 분류도 같이 바뀌는데, 그건 물건이 하나라서
  // 자연스럽다.
  function categoryLabel(key) {
    const found = CATEGORIES.find(item => item.key === key);
    return found ? found.label : "기타";
  }

  function moveLabel(key) {
    const found = MOVE_KINDS.find(item => item.key === key);
    return found ? found.label : key;
  }

  function moveKind(key) {
    return MOVE_KINDS.find(item => item.key === key) || null;
  }

  function isCategory(key) {
    return CATEGORY_KEYS.indexOf(text(key, 20)) >= 0;
  }

  function isMoveKind(key) {
    return MOVE_KEYS.indexOf(text(key, 20)) >= 0;
  }

  function normalizeItem(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const category = text(value.category, 20);
    return {
      id: text(value.id, 60),
      name: text(value.name, 120),
      category: isCategory(category) ? category : "etc",
      spec: text(value.spec, 200),
      unit: text(value.unit, 20) || "개",
      minStock: countOf(value.minStock),
      location: text(value.location, 120),
      vendor: text(value.vendor, 120),
      note: text(value.note, 1000),
      active: value.active !== false,
      createdAt: text(value.createdAt, 40),
      updatedAt: text(value.updatedAt, 40),
      updatedBy: text(value.updatedBy, 60),
    };
  }

  function normalizeMove(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const kind = text(value.kind, 20);
    return {
      id: text(value.id, 60),
      itemId: text(value.itemId, 60),
      kind: isMoveKind(kind) ? kind : "out",
      qty: countOf(value.qty),
      date: isDate(value.date) ? text(value.date, 10) : "",
      buildingId: text(value.buildingId, 80),
      reason: text(value.reason, 500),
      byName: text(value.byName, 80),
      createdAt: text(value.createdAt, 40),
      createdBy: text(value.createdBy, 60),
    };
  }

  // 단가는 따로 산다. 관리자만 읽는 노드에 들어간다.
  function normalizeCost(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const price = Number(value.unitPrice);
    return {
      itemId: text(value.itemId, 60),
      unitPrice: Number.isFinite(price) && price > 0 ? Math.round(price) : 0,
      pricedAt: isDate(value.pricedAt) ? text(value.pricedAt, 10) : "",
      updatedAt: text(value.updatedAt, 40),
      updatedBy: text(value.updatedBy, 60),
    };
  }

  function validateItem(source) {
    const item = normalizeItem(source);
    if (!item.id) return { ok: false, error: "품목 번호가 없습니다.", code: "VALIDATION_ERROR" };
    if (!item.name) return { ok: false, error: "품목 이름을 적어 주세요.", code: "NAME_REQUIRED" };
    if (!item.unit) return { ok: false, error: "단위를 적어 주세요. 개·통·박스처럼.", code: "UNIT_REQUIRED" };
    return { ok: true, item };
  }

  // 진짜로 막는 것은 서버 규칙이고, 여기는 같은 기준을 사람 말로 먼저
  // 보여 주기 위한 것이다. 두 기준이 어긋나면 사람은 이유 없는 권한
  // 오류만 본다.
  function validateMove(source) {
    const move = normalizeMove(source);
    if (!move.id) return { ok: false, error: "기록 번호가 없습니다.", code: "VALIDATION_ERROR" };
    if (!move.itemId) return { ok: false, error: "어느 품목인지 정해 주세요.", code: "ITEM_REQUIRED" };
    if (!move.date) return { ok: false, error: "날짜를 골라 주세요.", code: "DATE_REQUIRED" };
    const kind = moveKind(move.kind);
    if (!kind) return { ok: false, error: "입고·사용·폐기·실사 중에서 골라 주세요.", code: "KIND_REQUIRED" };
    // 실사는 0 이 뜻이 있다. "세어 보니 하나도 없었다"이다.
    if (move.kind !== "adjust" && move.qty <= 0) {
      return { ok: false, error: "수량은 1 이상으로 적어 주세요.", code: "QTY_REQUIRED" };
    }
    if (kind.needsReason && !move.reason) {
      return { ok: false, error: `${kind.label}는 이유를 적어야 합니다.`, code: "REASON_REQUIRED" };
    }
    return { ok: true, move };
  }

  function validateCost(source) {
    const cost = normalizeCost(source);
    if (!cost.itemId) return { ok: false, error: "어느 품목인지 정해 주세요.", code: "ITEM_REQUIRED" };
    return { ok: true, cost };
  }

  // 오래된 것부터. 실사가 중간에 있으면 그 앞은 다 지워진다.
  function sortMoves(moves) {
    return rows(moves)
      .map(normalizeMove)
      .filter(move => move.id)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
      });
  }

  // 남은 수량. 저장된 숫자를 믿지 않고 기록에서 다시 센다.
  function stockOf(itemId, moves) {
    const id = text(itemId, 60);
    let total = 0;
    sortMoves(moves).forEach(move => {
      if (move.itemId !== id) return;
      if (move.kind === "adjust") total = move.qty;
      else total += moveKind(move.kind).sign * move.qty;
    });
    return Math.max(0, total);
  }

  function stockMap(items, moves) {
    const sorted = sortMoves(moves);
    const map = {};
    rows(items).map(normalizeItem).forEach(item => {
      if (item.id) map[item.id] = 0;
    });
    sorted.forEach(move => {
      if (!Object.prototype.hasOwnProperty.call(map, move.itemId)) map[move.itemId] = 0;
      if (move.kind === "adjust") map[move.itemId] = move.qty;
      else map[move.itemId] = map[move.itemId] + moveKind(move.kind).sign * move.qty;
    });
    Object.keys(map).forEach(key => { map[key] = Math.max(0, map[key]); });
    return map;
  }

  // 마지막으로 움직인 날. "석 달째 안 나간 물건"을 찾는 데 쓴다.
  function lastMovedMap(moves) {
    const map = {};
    sortMoves(moves).forEach(move => { map[move.itemId] = move.date; });
    return map;
  }

  // 부족한 것. 0 개인 것을 먼저, 그 다음 최소 수량 아래인 것.
  function lowStock(items, moves) {
    const stock = stockMap(items, moves);
    return rows(items)
      .map(normalizeItem)
      .filter(item => item.id && item.active)
      .map(item => Object.assign({}, item, { stock: stock[item.id] || 0 }))
      .filter(item => item.minStock > 0 ? item.stock < item.minStock : item.stock <= 0)
      .sort((a, b) => {
        if ((a.stock === 0) !== (b.stock === 0)) return a.stock === 0 ? -1 : 1;
        return a.name.localeCompare(b.name, "ko");
      });
  }

  function summarize(items, moves, asOf) {
    const list = rows(items).map(normalizeItem).filter(item => item.id);
    const active = list.filter(item => item.active);
    const stock = stockMap(list, moves);
    const month = text(asOf, 10).slice(0, 7);
    const recent = sortMoves(moves).filter(move => !month || move.date.slice(0, 7) === month);
    return {
      items: active.length,
      retired: list.length - active.length,
      empty: active.filter(item => (stock[item.id] || 0) <= 0).length,
      low: lowStock(list, moves).length,
      movesThisMonth: recent.length,
      usedThisMonth: recent
        .filter(move => move.kind === "out")
        .reduce((sum, move) => sum + move.qty, 0),
    };
  }

  // 분류별로 묶는다. 빈 분류도 남긴다 — 창고 칸이 비어 있는 것도 정보다.
  function groupByCategory(items, moves) {
    const stock = stockMap(items, moves);
    const list = rows(items).map(normalizeItem).filter(item => item.id);
    return CATEGORIES.map(category => ({
      key: category.key,
      label: category.label,
      items: list
        .filter(item => item.category === category.key)
        .map(item => Object.assign({}, item, { stock: stock[item.id] || 0 }))
        .sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1;
          return a.name.localeCompare(b.name, "ko");
        }),
    }));
  }

  function movesOfItem(itemId, moves, limit = 50) {
    const id = text(itemId, 60);
    return sortMoves(moves).filter(move => move.itemId === id).reverse().slice(0, limit);
  }

  function recentMoves(moves, limit = 30) {
    return sortMoves(moves).reverse().slice(0, limit);
  }

  function findItem(items, itemId) {
    const id = text(itemId, 60);
    if (!id) return null;
    const found = rows(items).map(normalizeItem).find(item => item.id === id);
    return found || null;
  }

  return Object.freeze({
    CATEGORIES,
    MOVE_KINDS,
    CATEGORY_KEYS,
    MOVE_KEYS,
    categoryLabel,
    moveLabel,
    moveKind,
    isCategory,
    isMoveKind,
    countOf,
    normalizeItem,
    normalizeMove,
    normalizeCost,
    validateItem,
    validateMove,
    validateCost,
    sortMoves,
    stockOf,
    stockMap,
    lastMovedMap,
    lowStock,
    summarize,
    groupByCategory,
    movesOfItem,
    recentMoves,
    findItem,
    text,
    rows,
  });
});
