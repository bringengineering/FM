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


  // --- 수기 기록 --------------------------------------------------------
  // 다이소에서 다섯 가지를 사 왔을 때, 품목 다섯 개를 먼저 만들고 입고를
  // 다섯 번 적는 것은 열 번의 폼이다. 그래서 종이 장부처럼 그냥 줄로
  // 적게 두고, 없는 품목은 적는 김에 같이 만든다.
  //
  // 다만 적은 것을 곧바로 쓰지는 않는다. 사람이 무엇이 들어갈지 표로
  // 보고 나서 누른다. 잘못 읽은 줄이 조용히 저장되면 재고가 틀어지고,
  // 기록은 고칠 수 없기 때문이다.

  const KIND_WORDS = Object.freeze([
    { kind: "in", words: ["입고", "구매", "구입", "삼", "샀음", "사옴", "들어옴"] },
    { kind: "out", words: ["사용", "씀", "썼음", "사용함", "출고", "가져감"] },
    { kind: "disposal", words: ["폐기", "버림", "버렸음", "파손", "분실"] },
    { kind: "adjust", words: ["실사", "재고", "세어봄", "확인"] },
  ]);

  // 수량 뒤에 붙는 단위. "2통" 을 2 와 통 으로 가른다.
  const QTY_PATTERN = /^(\d{1,6})\s*([^\d\s]{0,6})$/u;

  function kindFromWord(word) {
    const clean = text(word, 20);
    if (!clean) return "";
    const found = KIND_WORDS.find(entry => entry.words.indexOf(clean) >= 0);
    return found ? found.kind : "";
  }

  // 이름은 사람이 그때그때 다르게 친다. "락스 4L" 과 "락스4l" 은 같은 것이다.
  function nameKey(value) {
    return text(value, 120).replace(/[\s·・.,()[\]{}-]/gu, "").toLowerCase();
  }

  // 9/5, 09-05, 2026-09-05 을 다 받는다. 연도가 없으면 기준 연도를 쓴다.
  function parseDateToken(token, fallbackYear) {
    const clean = text(token, 12);
    const full = clean.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/u);
    const short = clean.match(/^(\d{1,2})[-./](\d{1,2})$/u);
    let year;
    let month;
    let day;
    if (full) {
      year = Number(full[1]);
      month = Number(full[2]);
      day = Number(full[3]);
    } else if (short) {
      year = Number(fallbackYear);
      month = Number(short[1]);
      day = Number(short[2]);
    } else {
      return "";
    }
    if (!(year >= 2000 && year <= 2999)) return "";
    if (!(month >= 1 && month <= 12)) return "";
    if (!(day >= 1 && day <= 31)) return "";
    const pad = value => String(value).padStart(2, "0");
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  function splitCells(line) {
    // 엑셀에서 복사해 붙이면 탭이 온다. 그때는 칸이 이미 갈라져 있으니
    // 짐작하지 않는다. 짐작은 틀릴 수 있고, 이미 갈라진 것은 확실하다.
    if (line.indexOf("\t") >= 0) return line.split("\t").map(cell => cell.trim());
    return null;
  }

  function parseManualLine(line, options) {
    const settings = options && typeof options === "object" ? options : {};
    const fallbackKind = isMoveKind(settings.kind) ? text(settings.kind, 20) : "in";
    const fallbackDate = isDate(settings.date) ? text(settings.date, 10) : "";
    const year = Number(text(fallbackDate, 10).slice(0, 4)) || new Date().getUTCFullYear();

    const raw = text(line, 400);
    const draft = { raw, date: fallbackDate, kind: fallbackKind, qty: 0, unit: "", name: "", reason: "" };

    const cells = splitCells(raw);
    if (cells) {
      const [name, qty, kindWord, reason] = cells;
      const qtyMatch = text(qty, 20).match(QTY_PATTERN);
      draft.name = text(name, 120);
      draft.qty = qtyMatch ? countOf(qtyMatch[1]) : countOf(qty);
      draft.unit = qtyMatch ? text(qtyMatch[2], 20) : "";
      draft.kind = kindFromWord(kindWord) || fallbackKind;
      draft.reason = text(reason, 500);
      return draft;
    }

    let tokens = raw.split(/\s+/u).filter(Boolean);
    if (!tokens.length) return draft;

    const dated = parseDateToken(tokens[0], year);
    if (dated) {
      draft.date = dated;
      tokens = tokens.slice(1);
    }

    // 종류 낱말은 어디에 있든 찾는다. 그 뒤는 전부 메모다.
    let kindAt = -1;
    for (let index = 0; index < tokens.length; index += 1) {
      if (kindFromWord(tokens[index])) {
        kindAt = index;
        break;
      }
    }
    if (kindAt >= 0) {
      draft.kind = kindFromWord(tokens[kindAt]);
      draft.reason = tokens.slice(kindAt + 1).join(" ").slice(0, 500);
      tokens = tokens.slice(0, kindAt);
    }

    // 수량은 종류 앞에서 마지막으로 나오는 숫자다. "락스 4L 2통" 에서
    // 4L 이 아니라 2통 을 집어야 한다 — 규격은 이름의 일부다.
    let qtyAt = -1;
    for (let index = tokens.length - 1; index >= 0; index -= 1) {
      if (QTY_PATTERN.test(tokens[index])) {
        qtyAt = index;
        break;
      }
    }
    if (qtyAt >= 0) {
      const matched = tokens[qtyAt].match(QTY_PATTERN);
      draft.qty = countOf(matched[1]);
      draft.unit = text(matched[2], 20);
      draft.name = tokens.slice(0, qtyAt).join(" ").slice(0, 120);
    } else {
      draft.name = tokens.join(" ").slice(0, 120);
    }
    return draft;
  }

  /**
   * 적은 줄들을 그대로 저장할 수 있는 모양으로 바꾼다.
   *
   * 저장하지는 않는다. 무엇이 들어갈지 돌려줄 뿐이고, 화면은 그것을
   * 표로 보여 준 다음에 사람이 누를 때만 저장한다.
   */
  function planManualEntry(source, options) {
    const settings = options && typeof options === "object" ? options : {};
    const known = rows(settings.items).map(normalizeItem).filter(item => item.id);
    const byName = new Map(known.map(item => [nameKey(item.name), item]));
    const category = isCategory(settings.category) ? text(settings.category, 20) : "etc";
    const makeId = typeof settings.makeId === "function"
      ? settings.makeId
      : () => `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const lines = String(source == null ? "" : source).split(/\r?\n/u);
    const entries = [];
    const newItems = [];
    // 같은 줄에서 두 번 나온 새 품목을 두 개 만들지 않는다.
    const pending = new Map();

    lines.forEach((line, index) => {
      const trimmed = text(line, 400);
      if (!trimmed || trimmed.startsWith("#")) return;

      const draft = parseManualLine(trimmed, settings);
      const entry = {
        lineNo: index + 1,
        raw: trimmed,
        name: draft.name,
        qty: draft.qty,
        unit: draft.unit,
        kind: draft.kind,
        date: draft.date,
        reason: draft.reason,
        itemId: "",
        isNew: false,
        ok: false,
        error: "",
        code: "",
      };

      if (!entry.name) {
        entry.error = "품목 이름을 못 읽었습니다.";
        entry.code = "NAME_REQUIRED";
        entries.push(entry);
        return;
      }

      const key = nameKey(entry.name);
      const existing = byName.get(key);
      const queued = pending.get(key);
      if (existing) {
        entry.itemId = existing.id;
        entry.unit = entry.unit || existing.unit;
      } else if (queued) {
        entry.itemId = queued.id;
        entry.isNew = true;
        entry.unit = entry.unit || queued.unit;
      } else {
        const made = normalizeItem({
          id: makeId(),
          name: entry.name,
          category,
          unit: entry.unit || "개",
          vendor: text(settings.vendor, 120),
          note: "수기 기록에서 만들어졌습니다.",
        });
        pending.set(key, made);
        newItems.push(made);
        entry.itemId = made.id;
        entry.isNew = true;
        entry.unit = made.unit;
      }

      const checked = validateMove({
        id: makeId(),
        itemId: entry.itemId,
        kind: entry.kind,
        qty: entry.qty,
        date: entry.date,
        reason: entry.reason,
        byName: text(settings.byName, 80),
      });
      if (!checked.ok) {
        entry.error = checked.error;
        entry.code = checked.code;
        entries.push(entry);
        return;
      }
      entry.ok = true;
      entry.move = checked.move;
      entries.push(entry);
    });

    const good = entries.filter(entry => entry.ok);
    const bad = entries.filter(entry => !entry.ok);
    // 하나라도 못 읽으면 아무것도 저장하지 않는다. 반만 들어간 장부는
    // 어디까지 들어갔는지 사람이 다시 세어야 한다.
    const usedNames = new Set(good.map(entry => nameKey(entry.name)));
    return {
      ok: entries.length > 0 && bad.length === 0,
      entries,
      moves: good.map(entry => entry.move),
      newItems: newItems.filter(item => usedNames.has(nameKey(item.name))),
      errorCount: bad.length,
    };
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
    parseManualLine,
    planManualEntry,
    nameKey,
    parseDateToken,
    kindFromWord,
    text,
    rows,
  });
});
