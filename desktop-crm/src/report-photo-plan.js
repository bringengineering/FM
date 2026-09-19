// Drive 사진 폴더를 읽어 결과보고서 초안을 짠다.
//
// 대표가 물은 것은 이것이다. "구글드라이브에 폴더가 있는데 거기 사진
// 활용해서 네가 알아서 만들어주면 안 되나?"
//
// 된다. 폴더가 이미 보고서 모양으로 정리돼 있기 때문이다.
//
//   입주청소(햇빛빌라)_블로그_20260831/
//     화장실/     20260831_172901.jpg  20260831_172904.jpg  …
//     주방/       IMG_4310.HEIC  …
//     베란다/     …
//     계단청소/   …
//
// 바깥 폴더 이름에 작업·건물·날짜가 다 있고, 안쪽 폴더 이름이 곧 보고서의
// 위치다. 사람이 이미 손으로 해 둔 분류를 다시 시키지 않는다.
//
// 전과 후를 무엇으로 가르는가
//
// 파일 이름에 '전'·'후' 가 적혀 있지 않다. 대신 **시각이 뭉쳐 있다.**
// 화장실 폴더를 보면 17:29 에 다섯 장, 17:53 에 두 장, 다음 날 10:18 에
// 다섯 장이다. 사람은 작업 전에 한 번 찍고 끝나고 한 번 찍는다. 그래서
// 시각이 크게 벌어지는 자리에서 자르면 앞 무리가 작업 전, 뒤 무리가
// 작업 후다.
//
// 이 짐작은 틀릴 수 있다. 그래서 **짐작이라고 말한다.** 화면은 초안을
// 보여 주고 사람이 뒤집을 수 있게 두지, 조용히 확정하지 않는다.
//
// 하지 않는 것
//
// 1. 사진을 여기서 받지 않는다. 목록만 보고 계획을 짠다.
// 2. 상태를 완료로 올리지 않는다. 사진이 있다는 것과 다 했다는 것은
//    다른 말이다. 사람이 보고 올린다.
// 3. HEIC 를 열려고 하지 않는다. 못 여는 것을 못 연다고 말한다.
(function attachReportPhotoPlan(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringReportPhotoPlan = api;
})(typeof globalThis === "object" ? globalThis : this, function createReportPhotoPlan() {
  "use strict";

  const text = (value, limit = 300) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);

  // 크롬은 HEIC 를 못 연다. 전자 앱도 크롬이다. 링크로 두든 문서에 박든
  // 화면에도 PDF 에도 빈칸으로 나온다 — 그러니 미리 말해 준다.
  const VIEWABLE = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);
  const UNVIEWABLE = Object.freeze(["image/heif", "image/heic"]);

  // 시각이 이만큼 벌어지면 다른 무리로 본다. 청소 한 판이 보통 한두
  // 시간이라 40분이면 같은 판 안에서는 안 갈리고 전·후 사이에서는 갈린다.
  const GAP_MINUTES = 40;

  // 폴더 이름이 곧 보고서의 위치다. 표준 항목과 이어 주면 사람이 다시
  // 고르지 않아도 된다. 못 이으면 이름 그대로 항목을 하나 만든다 —
  // 버리지 않는다. 버리면 그 사진은 보고서에 영영 안 들어간다.
  const FOLDER_HINTS = Object.freeze({
    moveIn: Object.freeze({
      바닥: "floor", 거실: "floor", 방: "floor",
      창호: "window", 창틀: "window", 샷시: "window", 새시: "window", 유리: "window",
      주방: "kitchen", 싱크대: "kitchen", 씽크대: "kitchen",
      욕실: "bath", 화장실: "bath", 욕조: "bath",
      베란다: "veranda", 발코니: "veranda",
      붙박이장: "storage", 신발장: "storage", 수납: "storage", 가구: "storage",
      마감: "finish", 마감점검: "finish", 현관: "finish",
    }),
    stairs: Object.freeze({
      계단: "stairFloor", 계단실: "stairFloor", 계단청소: "stairFloor",
      난간: "handrail", 손잡이: "handrail",
      창틀: "stairWindow", 유리: "stairWindow", 창호: "stairWindow",
      조명: "light", 천장: "light", 등: "light",
      현관: "entrance", 출입구: "entrance", 공용출입구: "entrance", 로비: "entrance",
      분리수거장: "recycle", 수거장: "recycle", 재활용: "recycle",
    }),
    special: Object.freeze({
      작업전: "before", 전: "before",
      본작업: "work", 작업: "work",
      폐기물: "waste", 반출: "waste", 폐기: "waste",
      마감: "after", 작업후: "after", 후: "after",
    }),
  });

  function normalizeFolderWord(value) {
    return text(value, 120).replace(/[\s·・.,_()[\]{}-]/gu, "").toLowerCase();
  }

  /**
   * 바깥 폴더 이름에서 작업·건물·날짜를 뽑는다.
   *
   *   "입주청소(햇빛빌라)_블로그_20260831"
   *   "계단 청소(영업 하면서 찍은 사진)_블로그_260904"
   */
  function parseFolderName(name) {
    const raw = text(name, 300);
    const result = { raw, work: "", building: "", date: "", kind: "" };
    if (!raw) return result;

    const bracket = raw.match(/^([^(（]*)[(（]([^)）]*)[)）]/u);
    if (bracket) {
      result.work = text(bracket[1], 100);
      result.building = text(bracket[2], 100);
    } else {
      result.work = text(raw.split("_")[0], 100);
    }

    // 뒤쪽 토막에서 날짜를 찾는다. 20260831 도 260904 도 쓴다.
    const parts = raw.split("_").map(part => text(part, 60));
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const found = parseDateChunk(parts[index]);
      if (found) { result.date = found; break; }
    }
    result.kind = kindFromWords(result.work);
    return result;
  }

  function parseDateChunk(chunk) {
    const clean = text(chunk, 20).replace(/[^\d]/gu, "");
    if (clean.length === 8) {
      const year = Number(clean.slice(0, 4));
      if (year >= 2000 && year <= 2999) return formatDate(year, clean.slice(4, 6), clean.slice(6, 8));
    }
    if (clean.length === 6) {
      // 260904 는 2026-09-04 다. 두 자리 연도는 2000년대로 읽는다.
      return formatDate(2000 + Number(clean.slice(0, 2)), clean.slice(2, 4), clean.slice(4, 6));
    }
    return "";
  }

  function formatDate(year, monthText, dayText) {
    const month = Number(monthText);
    const day = Number(dayText);
    if (!(year >= 2000 && year <= 2999)) return "";
    if (!(month >= 1 && month <= 12)) return "";
    if (!(day >= 1 && day <= 31)) return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // 폴더 이름에 적힌 작업이 어느 표준 종류인지. 못 알아보면 비워 둔다 —
  // 짐작해서 입주청소로 깔면 계단청소 항목이 통째로 어긋난다.
  function kindFromWords(value) {
    const word = normalizeFolderWord(value);
    if (!word) return "";
    if (word.includes("입주") || word.includes("이사")) return "moveIn";
    if (word.includes("계단") || word.includes("공용")) return "stairs";
    if (word.includes("특수") || word.includes("폐기물") || word.includes("특수청소")) return "special";
    return "";
  }

  /** 하위 폴더 이름을 표준 항목에 잇는다. 못 이으면 빈 문자열. */
  function itemKeyForFolder(kind, folderName) {
    const table = FOLDER_HINTS[text(kind, 20)];
    if (!table) return "";
    const word = normalizeFolderWord(folderName);
    if (!word) return "";
    if (table[word]) return table[word];
    // 정확히 안 맞으면 들어 있는지 본다. "계단실 바닥" 은 "계단" 을 품는다.
    const hit = Object.keys(table).find(key => word.includes(key));
    return hit ? table[hit] : "";
  }

  /**
   * 사진이 언제 찍혔는지. 파일 이름이 먼저다 — Drive 에 올린 시각은
   * 찍은 시각이 아니라 옮긴 시각이라, 다섯 장을 한꺼번에 올리면 다
   * 같은 시각이 되어 전·후를 가를 수 없다.
   */
  function takenAt(file) {
    const value = file && typeof file === "object" ? file : {};
    const name = text(value.name || value.title, 200);
    const stamped = name.match(/(\d{8})[_-](\d{6})/u);
    if (stamped) {
      const day = stamped[1];
      const time = stamped[2];
      const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`;
      const parsed = Date.parse(iso);
      if (Number.isFinite(parsed)) return { at: parsed, from: "name" };
    }
    const created = Date.parse(text(value.createdTime, 40));
    if (Number.isFinite(created)) return { at: created, from: "drive" };
    return { at: NaN, from: "none" };
  }

  function viewable(mimeType) {
    return VIEWABLE.indexOf(text(mimeType, 60).toLowerCase()) >= 0;
  }

  function unviewable(mimeType) {
    return UNVIEWABLE.indexOf(text(mimeType, 60).toLowerCase()) >= 0;
  }

  /**
   * 한 위치의 사진을 작업 전과 후로 가른다.
   *
   * 시각이 크게 벌어지는 자리에서 자른다. 무리가 하나뿐이면 가르지 않고
   * 전부 '알 수 없음' 으로 둔다 — 반씩 잘라 놓으면 그럴듯해 보이지만
   * 틀린 보고서가 된다. 틀린 것보다 비어 있는 편이 낫다.
   */
  function splitBeforeAfter(photos, options) {
    const settings = options && typeof options === "object" ? options : {};
    const gapMs = (Number(settings.gapMinutes) > 0 ? Number(settings.gapMinutes) : GAP_MINUTES) * 60 * 1000;
    const list = rows(photos)
      .map(photo => Object.assign({}, photo, takenAt(photo)))
      .filter(photo => Number.isFinite(photo.at))
      .sort((left, right) => left.at - right.at);
    const undated = rows(photos).filter(photo => !Number.isFinite(takenAt(photo).at));

    if (!list.length) return { before: [], after: [], unsorted: undated, confident: false, reason: "찍은 시각을 알 수 없습니다." };

    let cutAt = -1;
    let widest = 0;
    for (let index = 1; index < list.length; index += 1) {
      const gap = list[index].at - list[index - 1].at;
      if (gap >= gapMs && gap > widest) { widest = gap; cutAt = index; }
    }
    if (cutAt < 0) {
      return {
        before: [], after: [], unsorted: list.concat(undated), confident: false,
        reason: "사진이 한 번에 찍혔습니다. 작업 전인지 후인지 골라 주세요.",
      };
    }
    return {
      before: list.slice(0, cutAt),
      after: list.slice(cutAt),
      unsorted: undated,
      confident: true,
      reason: `${Math.round(widest / 60000)}분이 벌어진 자리에서 나눴습니다.`,
    };
  }

  /**
   * 폴더 나무를 통째로 받아 보고서 초안을 짠다.
   *
   * tree 는 { name, folders: [{ name, files: [...] }], files: [...] } 모양이다.
   * Drive 를 여기서 부르지 않는다 — 부르면 검사할 수 없다.
   */
  function planFromTree(tree, options) {
    const settings = options && typeof options === "object" ? options : {};
    const source = tree && typeof tree === "object" ? tree : {};
    const parsed = parseFolderName(source.name);
    const kind = text(settings.kind, 20) || parsed.kind;

    const buckets = [];
    const folders = rows(source.folders);
    // 바깥에 그냥 놓인 사진도 버리지 않는다. 이름 없는 자리로 모은다.
    const loose = rows(source.files);
    if (loose.length) folders.push({ name: "", files: loose });

    const skipped = [];
    folders.forEach(folder => {
      const files = rows(folder && folder.files);
      const images = files.filter(file => viewable(file && file.mimeType));
      const heic = files.filter(file => unviewable(file && file.mimeType));
      const other = files.filter(file => !viewable(file && file.mimeType) && !unviewable(file && file.mimeType));
      if (!images.length && !heic.length) {
        if (other.length) skipped.push({ folder: text(folder && folder.name, 120), count: other.length, why: "사진이 아닙니다." });
        return;
      }
      const split = splitBeforeAfter(images);
      buckets.push({
        folder: text(folder && folder.name, 120),
        itemKey: itemKeyForFolder(kind, folder && folder.name),
        before: split.before,
        after: split.after,
        unsorted: split.unsorted,
        confident: split.confident,
        reason: split.reason,
        heic,
        skipped: other.length,
      });
    });

    const heicCount = buckets.reduce((sum, bucket) => sum + bucket.heic.length, 0);
    const photoCount = buckets.reduce((sum, bucket) => sum + bucket.before.length + bucket.after.length + bucket.unsorted.length, 0);
    const warnings = [];
    if (!kind) warnings.push("폴더 이름으로는 작업 종류를 알 수 없습니다. 위에서 골라 주세요.");
    if (!parsed.building) warnings.push("폴더 이름에 건물이 없습니다. 건물을 골라 주세요.");
    if (heicCount) warnings.push(`아이폰 사진(HEIC) ${heicCount}장은 화면과 PDF 에서 안 열립니다. JPG 로 바꿔 올려 주세요.`);
    const unsure = buckets.filter(bucket => !bucket.confident && (bucket.unsorted.length || bucket.before.length + bucket.after.length));
    if (unsure.length) warnings.push(`${unsure.length}곳은 작업 전·후를 가르지 못했습니다. 직접 골라 주세요.`);

    return {
      folderName: parsed.raw,
      work: parsed.work,
      buildingName: parsed.building,
      workDate: parsed.date,
      kind,
      buckets,
      warnings,
      skipped,
      photoCount,
      heicCount,
      matched: buckets.filter(bucket => bucket.itemKey).length,
      unmatched: buckets.filter(bucket => !bucket.itemKey).map(bucket => bucket.folder).filter(Boolean),
    };
  }

  /**
   * 초안을 결과보고서 모양으로 바꾼다.
   *
   * 상태는 올리지 않는다. 사진이 붙었다는 것과 다 했다는 것은 다른
   * 말이다. 사람이 보고 올린다.
   */
  function toReportDraft(plan, options) {
    const settings = options && typeof options === "object" ? options : {};
    const core = settings.core;
    if (!core || typeof core.itemsFor !== "function") {
      return { ok: false, code: "CORE_MISSING", error: "결과보고서 모듈을 못 불러왔습니다." };
    }
    const made = plan && typeof plan === "object" ? plan : {};
    const kind = text(settings.kind, 20) || text(made.kind, 20);
    if (!core.kindOf(kind)) {
      return { ok: false, code: "KIND_REQUIRED", error: "작업 종류를 골라 주세요." };
    }
    const toPhoto = file => core.normalizePhoto({
      id: text(file && file.id, 80),
      name: text(file && (file.name || file.title), 200),
      webViewLink: text(file && (file.webViewLink || file.viewUrl), 500),
      caption: "",
    });

    const items = core.itemsFor(kind, []).map(item => Object.assign({}, item));
    const byKey = new Map(items.map(item => [item.key, item]));
    const leftovers = [];

    rows(made.buckets).forEach(bucket => {
      const target = bucket.itemKey ? byKey.get(bucket.itemKey) : null;
      if (!target) {
        if (bucket.before.length || bucket.after.length || bucket.unsorted.length) leftovers.push(bucket);
        return;
      }
      target.before = target.before.concat(bucket.before.map(toPhoto));
      target.after = target.after.concat(bucket.after.map(toPhoto));
      // 못 가른 것은 작업 전에 몰아 두지 않는다. 몰아 두면 사람이
      // 옮겼는지 원래 그런지 알 수 없다. 메모로 남겨 눈에 띄게 한다.
      if (bucket.unsorted.length) {
        target.note = text(`${target.note ? `${target.note} / ` : ""}전·후를 못 가른 사진 ${bucket.unsorted.length}장이 Drive 에 더 있습니다.`, 500);
      }
    });

    return {
      ok: true,
      draft: {
        kind,
        buildingName: text(made.buildingName, 200),
        workDate: text(made.workDate, 10),
        category: "single",
        items,
      },
      leftovers,
      warnings: rows(made.warnings),
    };
  }

  return Object.freeze({
    VIEWABLE,
    UNVIEWABLE,
    GAP_MINUTES,
    FOLDER_HINTS,
    parseFolderName,
    parseDateChunk,
    kindFromWords,
    itemKeyForFolder,
    normalizeFolderWord,
    takenAt,
    viewable,
    unviewable,
    splitBeforeAfter,
    planFromTree,
    toReportDraft,
    text,
    rows,
  });
});
