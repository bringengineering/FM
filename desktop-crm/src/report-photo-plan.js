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
// 아래 시간 휴리스틱은 기타 작업의 기존 폴더 초안에만 남긴다.
// 입주·공용부 AI 분류는 시간만으로 전후를 배치하지 않는다.
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
// 3. HEIC 원본은 화면에서 직접 열지 않는다. 보고서 사진으로는 분류하고,
//    PDF 를 만들 때 로컬 변환기가 JPG 사본을 만든다.
(function attachReportPhotoPlan(root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./photo-capture-time") : root.BringPhotoCaptureTime);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringReportPhotoPlan = api;
})(typeof globalThis === "object" ? globalThis : this, function createReportPhotoPlan(Capture) {
  "use strict";

  const text = (value, limit = 300) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);

  // 크롬은 HEIC 를 직접 못 연지만 PDF 내보내기에서는 JPG 사본으로 바꾼다.
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
      후드: "hood", 후드필터: "hood", 렌지후드: "hood",
      에어컨: "aircon", 에어컨필터: "aircon",
      냉장고: "refrigerator", 냉장고선반: "refrigerator", 냉장고서랍: "refrigerator",
      욕실: "bath", 화장실: "bath", 욕조: "bath",
      베란다: "veranda", 발코니: "veranda",
      붙박이장: "storage", 신발장: "storage", 수납: "storage", 가구: "storage",
      마감: "finish", 마감점검: "finish", 현관: "finish",
    }),
    moveOut: Object.freeze({
      바닥: "floor", 거실: "floor", 방: "floor",
      창호: "window", 창틀: "window", 샷시: "window", 새시: "window", 유리: "window",
      주방: "kitchen", 싱크대: "kitchen", 씽크대: "kitchen",
      욕실: "bath", 화장실: "bath", 욕조: "bath",
      베란다: "veranda", 발코니: "veranda",
      붙박이장: "storage", 신발장: "storage", 수납: "storage",
      가전: "appliances", 옵션: "appliances",
      잔류물: "waste", 폐기물: "waste", 반출: "waste", 폐기: "waste",
      마감: "finish", 인계: "finish",
    }),
    common: Object.freeze({
      출입구: "entrance", 현관: "entrance", 로비: "entrance",
      복도: "corridor", 공용바닥: "corridor", 바닥: "corridor",
      계단: "stairs", 계단실: "stairs", 계단참: "stairs",
      난간: "handrail", 손잡이: "handrail",
      창틀: "windows", 레일: "windows", 창호: "windows", 샷시: "windows", 새시: "windows",
      유리: "glass", 유리창: "glass", 창문: "glass", 공용유리: "glass",
      마당: "yard", 마당바닥: "yard", 뜰: "yard", 외부바닥: "yard", 건물앞: "yard",
      주차장: "parking", 주차장바닥: "parking", 주차구역: "parking",
      배수구: "drain", 배수로: "drain", 트렌치: "drain", 그레이팅: "drain",
      옥상: "rooftop", 옥상바닥: "rooftop", 테라스: "rooftop", 테라스바닥: "rooftop",
      승강기: "elevator", 엘리베이터: "elevator",
      벽면: "walls", 외벽: "walls", 벽: "walls", 문: "walls",
      소화기: "fixtures", 설비함: "fixtures", 전기함: "fixtures", 계량기함: "fixtures", 게시판: "fixtures",
      조명: "lighting", 천장: "lighting", 등: "lighting",
      분리수거장: "recycle", 수거장: "recycle", 재활용: "recycle",
      마감: "final", 안전: "final",
    }),
    stairs: Object.freeze({
      계단: "stairFloor", 계단실: "stairFloor", 계단청소: "stairFloor",
      난간: "handrail", 손잡이: "handrail",
      창틀: "stairWindow", 유리: "stairWindow", 창호: "stairWindow",
      조명: "light", 천장: "light", 등: "light",
      현관: "entrance", 출입구: "entrance", 공용출입구: "entrance", 로비: "entrance",
      분리수거장: "recycle", 수거장: "recycle", 재활용: "recycle",
    }),
    general: Object.freeze({
      범위: "scope", 합의범위: "scope", 작업전: "before", 전: "before",
      본작업: "work", 청소: "work", 작업: "work",
      폐기물: "waste", 반출: "waste", 폐기: "waste",
      마감: "after", 작업후: "after", 후: "after",
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
    if (word.includes("퇴실") || word.includes("퇴거") || word.includes("공실")) return "moveOut";
    if (word.includes("입주") || word.includes("이사")) return "moveIn";
    if (word.includes("공용")) return "common";
    if (word.includes("계단")) return "stairs";
    if (word.includes("일반청소") || word.includes("기타청소")) return "general";
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
    const hit = Object.keys(table).sort((left, right) => right.length - left.length).find(key => word.includes(key));
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

  // '작업 전후'·'전·후 비교'처럼 둘을 함께 적은 이름은 어느 쪽의 근거도 아니다.
  // 지우지 않으면 앞의 '전'만 읽혀 폴더 전체가 작업 전으로 확정된다.
  const COMBINED_PHASE = /전\s*[·・/&,~-]?\s*후|before\s*[&/_+-]?\s*(?:and\s*)?after/giu;
  // '전'·'후' 바로 뒤가 끝·구분자·숫자·'사진'일 때만 단계 표기로 본다.
  // 청소전문·작업전체·청소후기 같은 낱말은 단계가 아니다.
  const PHASE_END = "(?=$|[\\s_()\\[\\]/.,·・\\-\\d]|사진)";
  const BEFORE_HINT = new RegExp(`(?:작업|청소|시공)\\s*전${PHASE_END}|(?:^|[\\s_()/.-])(?:전|before)${PHASE_END}`, "iu");
  const AFTER_HINT = new RegExp(`(?:작업|청소|시공)\\s*후${PHASE_END}|(?:^|[\\s_()/.-])(?:후|after)${PHASE_END}`, "iu");

  function phaseHint(file, folderName) {
    const value = [file && file.name, (file && file.parentName) || folderName].map(word => text(word, 300).replace(COMBINED_PHASE, " ")).join(" / ");
    const before = BEFORE_HINT.test(value);
    const after = AFTER_HINT.test(value);
    return before && after ? "conflict" : before ? "before" : after ? "after" : "";
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
    const named = { before: [], after: [], unsorted: [] };
    const remaining = [];
    rows(photos).forEach(photo => {
      const hint = phaseHint(photo, settings.folderName);
      if (hint === "before" || hint === "after") named[hint].push(Object.assign({}, photo, { phaseReason: "파일·폴더의 전·후 표기" }));
      else if (hint === "conflict") named.unsorted.push(Object.assign({}, photo, { phaseReason: "전·후 표기가 서로 다릅니다." }));
      else remaining.push(photo);
    });
    const finish = split => Object.assign({}, split, {
      before: named.before.concat(split.before), after: named.after.concat(split.after), unsorted: named.unsorted.concat(split.unsorted),
      confident: !named.unsorted.length && !split.unsorted.length,
      reason: named.before.length + named.after.length ? `파일·폴더 전·후 표기를 우선했습니다. ${split.reason}`.trim() : split.reason,
    });
    if (settings.requireVisualEvidence) return finish({ before: [], after: [], unsorted: remaining, confident: false, reason: "촬영시각만으로 전·후를 나누지 않습니다. 같은 장면의 실제 변화 또는 직접 확인이 필요합니다." });
    const gapMs = (Number(settings.gapMinutes) > 0 ? Number(settings.gapMinutes) : GAP_MINUTES) * 60 * 1000;
    const list = remaining
      .map(photo => Object.assign({}, photo, takenAt(photo)))
      .filter(photo => Number.isFinite(photo.at) && photo.from !== "drive")
      .sort((left, right) => left.at - right.at);
    // Drive createdTime is upload time, never evidence of before/after work.
    const undated = remaining.filter(photo => !Number.isFinite(takenAt(photo).at) || takenAt(photo).from === "drive");

    if (!list.length) return finish({ before: [], after: [], unsorted: undated, confident: false, reason: undated.length ? "촬영시각을 알 수 없습니다. 전·후를 선택해 주세요." : "" });

    let cutAt = -1;
    let widest = 0;
    for (let index = 1; index < list.length; index += 1) {
      const gap = list[index].at - list[index - 1].at;
      if (gap >= gapMs && gap > widest) { widest = gap; cutAt = index; }
    }
    if (cutAt < 0) {
      return finish({
        before: [], after: [], unsorted: list.concat(undated), confident: false,
        reason: "사진이 한 번에 찍혔습니다. 작업 전인지 후인지 골라 주세요.",
      });
    }
    return finish({
      before: list.slice(0, cutAt).map(photo => Object.assign({}, photo, { phaseReason: "파일명 촬영시각으로 추천 · 확인 필요" })),
      after: list.slice(cutAt).map(photo => Object.assign({}, photo, { phaseReason: "파일명 촬영시각으로 추천 · 확인 필요" })),
      unsorted: undated,
      confident: true,
      reason: `${Math.round(widest / 60000)}분이 벌어진 자리에서 나눴습니다.`,
    });
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
      const split = kind === "common"
        ? { before: [], after: [], unsorted: images.concat(heic), confident: false, reason: "공용부는 청소 동작과 같은 장소의 변화를 분석합니다. 촬영시각만으로 전·후를 나누지 않습니다." }
        : splitBeforeAfter(images.concat(heic), { folderName: folder && folder.name, requireVisualEvidence: kind === "moveIn" });
      buckets.push({
        folder: text(folder && folder.name, 120),
        itemKey: itemKeyForFolder(kind, folder && folder.name),
        before: split.before,
        during: [],
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
    const buildingName = text(settings.buildingName, 200) || parsed.building;
    if (!buildingName) warnings.push("건물을 먼저 골라 주세요.");
    if (heicCount) warnings.push(`아이폰 사진(HEIC) ${heicCount}장은 PDF 생성 시 JPG로 자동 변환됩니다. 원본은 변경되지 않습니다.`);
    const unsure = buckets.filter(bucket => !bucket.confident && (bucket.unsorted.length || bucket.before.length + bucket.after.length));
    if (unsure.length) warnings.push(`${unsure.length}곳은 작업 전·후를 가르지 못했습니다. 직접 골라 주세요.`);

    return {
      folderName: parsed.raw,
      work: parsed.work,
      buildingName,
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
  // 보고서는 작업 전 n번과 작업 후 n번을 나란히 싣는다. 들어온 순서대로 두면 서로
  // 다른 장소가 짝지어진다. 1) AI·사람이 같은 장소로 묶은 짝을 앞에 같은 번호로 두고
  // 2) 나머지는 각각 촬영 시각 순으로 세운다 — 작업 전·후에 현장을 같은 순서로
  // 돌며 찍으므로 시각 순서가 장소 순서와 대개 같다. 사진을 버리거나 단계를 바꾸지 않는다.
  // 보고서에 나란히 싣는 짝은 확인된 것만: 사람이 묶었거나 확인한 짝, 또는
  // 같은 장소 짝 찾기(match)가 고정 구조로 확인한 짝. 전·후 비교(compare)의
  // pairWith 는 단계 추천 근거일 뿐이라 실사진에서 다른 장소가 섞였다(2026-11-02).
  function pairKey(file) {
    const review = text(file && file.reviewPair, 300);
    if (review && (review.startsWith("manual:") || file.reviewConfirmed === true)) return review;
    const other = text(file && file.samePlaceWith, 200);
    return other ? [text(file.id, 200), other].sort().join("|") : "";
  }
  function orderPairs(before, after) {
    const afterByKey = new Map();
    rows(after).forEach(file => { const key = pairKey(file); if (key && !afterByKey.has(key)) afterByKey.set(key, file); });
    const pairedBefore = [], pairedAfter = [], usedAfter = new Set();
    rows(before).forEach(file => {
      const key = pairKey(file), match = key && afterByKey.get(key);
      if (match && !usedAfter.has(match)) { pairedBefore.push(file); pairedAfter.push(match); usedAfter.add(match); }
    });
    const byTime = (left, right) => {
      const a = Capture.normalize(left && left.captureTime), b = Capture.normalize(right && right.captureTime);
      return a && b ? a.local.localeCompare(b.local) : a ? -1 : b ? 1 : 0;
    };
    const restBefore = rows(before).filter(file => !pairedBefore.includes(file)).sort(byTime);
    const restAfter = rows(after).filter(file => !usedAfter.has(file)).sort(byTime);
    return { before: pairedBefore.concat(restBefore), after: pairedAfter.concat(restAfter), paired: pairedBefore.length };
  }

  function toReportDraft(plan, options) {
    const settings = options && typeof options === "object" ? options : {};
    const core = settings.core;
    if (!core || typeof core.itemsFor !== "function") {
      return { ok: false, code: "CORE_MISSING", error: "결과보고서 모듈을 못 불러왔습니다." };
    }
    const made = plan && typeof plan === "object" ? plan : {};
    if (settings.requireResolved && made.kind !== "common" && photoReviewRows(made).some(row => !row.itemKey || row.phase === "unsorted")) {
      return { ok: false, code: "PHOTO_REVIEW_REQUIRED", error: "모든 사진의 구역과 전·후를 확인해 주세요." };
    }
    const kind = text(settings.kind, 20) || text(made.kind, 20);
    if (!core.kindOf(kind)) {
      return { ok: false, code: "KIND_REQUIRED", error: "작업 종류를 골라 주세요." };
    }
    const toPhoto = file => core.normalizePhoto({
      id: text(file && file.id, 80),
      driveFileId: text(file && file.id, 120),
      name: text(file && (file.name || file.title), 200),
      webViewLink: text(file && (file.webViewLink || file.viewUrl), 500),
      caption: "",
      pairId: pairKey(file),
    });

    const selectedItems = rows(made.buckets).map(bucket => ({ key: text(bucket && bucket.itemKey, 40) })).filter(item => item.key);
    const items = core.itemsFor(kind, selectedItems).map(item => Object.assign({}, item));
    const byKey = new Map(items.map(item => [item.key, item]));
    const leftovers = [];

    rows(made.buckets).forEach(bucket => {
      const target = bucket.itemKey ? byKey.get(bucket.itemKey) : null;
      if (!target) {
        if (bucket.before.length || rows(bucket.during).length || bucket.after.length || bucket.unsorted.length) leftovers.push(bucket);
        return;
      }
      const ordered = orderPairs(bucket.before, bucket.after);
      target.before = target.before.concat(ordered.before.map(toPhoto));
      if (["moveIn", "common"].includes(kind)) target.during = target.during.concat(rows(bucket.during).map(toPhoto));
      target.after = target.after.concat(ordered.after.map(toPhoto));
      // 못 가른 것은 작업 전에 몰아 두지 않는다. 몰아 두면 사람이
      // 옮겼는지 원래 그런지 알 수 없다. 메모로 남겨 눈에 띄게 한다.
      if (bucket.unsorted.length && kind !== "common") {
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

  const AI_CATEGORY_LABELS = Object.freeze({
    entrance: "출입구·현관", corridor: "복도·공용 바닥", stairs: "계단·계단참", handrail: "난간·손잡이", windows: "창틀·레일", glass: "공용 유리", yard: "마당·외부 바닥", parking: "주차장", drain: "배수구·트렌치", rooftop: "옥상·테라스", elevator: "승강기", walls: "벽면·문", fixtures: "공용 설비·게시판", lighting: "조명·천장", recycle: "분리수거장", final: "마감·안전 확인",
    floor: "바닥",
    window: "창호·새시",
    kitchen: "싱크대·상하부장",
    hood: "주방 후드·필터",
    bath: "욕실",
    veranda: "베란다",
    storage: "붙박이장·수납",
    aircon: "에어컨 필터·커버",
    refrigerator: "냉장고 선반·서랍",
    finish: "기타 가전·마감",
    review: "분류 확인 필요",
  });

  function photoReviewRows(plan) {
    return rows(plan && plan.buckets).flatMap(bucket => ["before", "during", "after", "unsorted"].flatMap(phase => rows(bucket[phase]).map(file => ({
      id: text(file.id, 200), file, phase,
      itemKey: text(bucket.itemKey || bucket.manualItemKey, 40),
      reason: text(file.aiReason || bucket.reason, 120),
      phaseReason: text(file.phaseReason, 120),
    }))));
  }

  function assignPhotoPhase(plan, fileId, phase) {
    if (!["before", "after", "unsorted", ...(["moveIn", "common"].includes(plan?.kind) ? ["during"] : [])].includes(phase)) return plan;
    return Object.assign({}, plan, { buckets: rows(plan && plan.buckets).map(bucket => {
      const copy = Object.assign({}, bucket);
      let moved;
      ["before", "during", "after", "unsorted"].forEach(key => { copy[key] = rows(bucket[key]).filter(file => {
        if (text(file.id, 200) !== text(fileId, 200)) return true;
        moved = Object.assign({}, file, { manualPhase: true, phaseReason: phase === "unsorted" ? "직접 확인 대기" : "사용자가 직접 선택했습니다." }); return false;
      }); });
      if (moved) copy[phase].push(moved);
      return copy;
    }) });
  }

  function assignPhotoCategory(plan, fileId, itemKey) {
    let moved; let phase;
    const buckets = rows(plan && plan.buckets).map(bucket => {
      const copy = Object.assign({}, bucket);
      ["before", "during", "after", "unsorted"].forEach(key => { copy[key] = rows(bucket[key]).filter(file => {
        if (text(file.id, 200) !== text(fileId, 200)) return true;
        moved = Object.assign({}, file, { manualCategory: true, aiReason: "사용자가 직접 선택했습니다." }); phase = key; return false;
      }); });
      copy.heic = rows(bucket.heic).filter(file => text(file.id, 200) !== text(fileId, 200));
      return copy;
    });
    if (!moved) return plan;
    const key = text(itemKey, 40);
    let target = buckets.find(bucket => bucket.itemKey === key && !bucket.manualItemKey);
    if (!target) { target = { folder: AI_CATEGORY_LABELS[key] || "직접 분류", itemKey: key, before: [], during: [], after: [], unsorted: [], heic: [], skipped: 0, reason: "사용자가 직접 선택했습니다." }; buckets.push(target); }
    target[phase].push(moved);
    if (unviewable(moved.mimeType)) target.heic.push(moved);
    return Object.assign({}, plan, { buckets: buckets.filter(bucket => bucket.before.length + rows(bucket.during).length + bucket.after.length + bucket.unsorted.length) });
  }

  function mergeDraftPhotos(existingItems, incomingItems) {
    const merged = rows(existingItems).map(item => Object.assign({}, item, { before: rows(item.before).slice(), during: rows(item.during).slice(), after: rows(item.after).slice() }));
    const identity = photo => text(photo && (photo.driveFileId || photo.id), 200);
    const seen = new Set(merged.flatMap(item => rows(item.before).concat(rows(item.during), rows(item.after))).map(identity).filter(Boolean));
    let added = 0;
    rows(incomingItems).forEach(item => {
      let target = merged.find(row => row.key === item.key);
      if (!target) { target = Object.assign({}, item, { before: [], during: [], after: [] }); merged.push(target); }
      ["before", "during", "after"].forEach(phase => rows(item[phase]).forEach(photo => {
        const id = identity(photo);
        if (!id || seen.has(id)) return;
        seen.add(id); target[phase].push(photo); added += 1;
      }));
    });
    return { items: merged, added };
  }

  // 구역은 이 모듈에서 묶고 입주청소 단계·독립 근거는 photo-pair-review에서 검증한다.
  // 수동 선택을 유지하며 공용부는 실제 동작/변화에 근거한 단계만 적용한다.
  // 원본 계획을 매번 다시 묶으므로 사용자가 한 사진의 분류를 바꿔도 다른
  // 사진의 단계나 메타데이터가 손실되지 않는다.
  function applyPhotoClassifications(plan, classifications) {
    const source = plan && typeof plan === "object" ? plan : {};
    if (source.kind === "common") return applyCommonClassifications(source, classifications);
    const decisions = new Map(rows(classifications).map(row => [text(row && row.id, 200), {
      id: text(row && row.id, 200),
      category: Object.hasOwn(AI_CATEGORY_LABELS, text(row && row.category, 40)) ? text(row.category, 40) : "review",
      confidence: Math.max(0, Math.min(100, Math.round(Number(row && row.confidence) || 0))),
      reason: text(row && row.reason, 120),
    }]).filter(([id]) => id));
    const grouped = new Map();
    const add = (file, phase, original, originalIndex) => {
      const decision = decisions.get(text(file && file.id, 200)) || { category: "review", confidence: 0, reason: "분류 결과가 없어 확인이 필요합니다." };
      const category = decision.category;
      const itemKey = category === "review" ? "" : category;
      const groupKey = itemKey ? `ai:${itemKey}` : "ai:review";
      if (!grouped.has(groupKey)) grouped.set(groupKey, {
        folder: AI_CATEGORY_LABELS[category] || "분류 확인 필요",
        itemKey,
        before: [], during: [], after: [], unsorted: [], heic: [], skipped: 0,
        confident: category !== "review",
        reason: category === "review" ? "AI가 확정하지 않았습니다. 사진별 항목을 직접 골라 주세요." : "AI 사진 분류 추천입니다. 저장 전 확인해 주세요.",
        sourceBuckets: [],
      });
      const target = grouped.get(groupKey);
      const decorated = Object.assign({}, file, {
        aiItemKey: itemKey,
        aiConfidence: decision.confidence,
        aiReason: decision.reason,
        aiSourceBucket: originalIndex,
      });
      target[phase].push(decorated);
      if (unviewable(file && file.mimeType)) target.heic.push(decorated);
      if (!target.sourceBuckets.includes(originalIndex)) target.sourceBuckets.push(originalIndex);
    };
    rows(source.buckets).forEach((bucket, bucketIndex) => {
      ["before", "during", "after", "unsorted"].forEach(phase => rows(bucket && bucket[phase]).forEach(file => add(file, phase, bucket, bucketIndex)));
    });
    const buckets = [...grouped.values()];
    const warnings = rows(source.warnings).filter(line => !String(line).includes("AI 사진 분류"));
    warnings.push("AI 사진 분류는 추천입니다. 사진별 구역을 확인한 뒤 초안에 적용해 주세요.");
    const reviewCount = rows(classifications).filter(row => text(row && row.category, 40) === "review").length;
    if (reviewCount) warnings.push(`${reviewCount}장은 AI가 확정하지 않았습니다. 직접 구역을 골라 주세요.`);
    return Object.assign({}, source, {
      buckets,
      warnings,
      matched: buckets.filter(bucket => bucket.itemKey).length,
      unmatched: buckets.filter(bucket => !bucket.itemKey).map(bucket => bucket.folder),
      aiClassified: true,
      aiClassifications: [...decisions.values()],
    });
  }

  // Common-area evidence has two independent axes. Missing AI decisions never
  // erase a previous recommendation or a user's explicit correction.
  function applyCommonClassifications(plan, classifications) {
    const allowed = new Set(["entrance", "corridor", "stairs", "handrail", "windows", "glass", "yard", "parking", "drain", "rooftop", "elevator", "walls", "fixtures", "lighting", "recycle", "final"]);
    const decisions = new Map(rows(classifications).map(row => [text(row.id, 200), row]));
    let result = plan;
    for (const row of photoReviewRows(plan)) {
      const decision = decisions.get(row.id);
      if (!decision) continue;
      if (!row.file.manualCategory) {
        const category = (decision.manual || Number(decision.confidence) >= 75) && allowed.has(decision.category) ? decision.category : "";
        result = assignPhotoCategory(result, row.id, category);
      }
      if (!row.file.manualPhase) {
        const phase = decision.phase === "during" && Number(decision.phaseConfidence) >= 85 ? "during" : "unsorted";
        result = assignPhotoPhase(result, row.id, phase);
      }
    }
    const previous = new Map(photoReviewRows(plan).map(row => [row.id, row.file]));
    return { ...result, aiClassified: true, buckets: rows(result.buckets).map(bucket => ({ ...bucket,
      reason: "구역·작업 단계 추천입니다. 완료 여부와 별도로 확인해 주세요.",
      ...Object.fromEntries(["before", "during", "after", "unsorted"].map(phase => [phase, rows(bucket[phase]).map(file => {
        const old = previous.get(file.id) || {};
        return { ...file, manualCategory: !!old.manualCategory, manualPhase: !!old.manualPhase,
          aiReason: old.manualCategory ? "사용자가 직접 선택했습니다." : (decisions.get(file.id)?.reason || old.aiReason || (bucket.itemKey ? "공용부 구역 추천" : "구역 확인 필요")),
          aiCandidates: decisions.get(file.id)?.candidates || old.aiCandidates || [], aiReviewState: decisions.get(file.id)?.reviewState || old.aiReviewState || "",
          phaseReason: old.manualPhase ? old.phaseReason : phase === "during" ? "청소 동작이 보여 작업 중으로 추천했습니다. 완료 증명은 아닙니다." : "전·후 판단 근거가 부족해 확인이 필요합니다." };
      })])),
    })) };
  }

  function commonComparisonGroups(plan) {
    const groups = new Map();
    for (const bucket of rows(plan?.buckets).filter(bucket => bucket.itemKey)) {
      for (const file of rows(bucket.unsorted).filter(file => !file.manualPhase)) {
        const captured = Capture.normalize(file.captureTime);
        const visit = captured ? `${captured.local.slice(0, 10)}:${captured.offset}` : "undated";
        const group = `${visit}:${bucket.itemKey}`;
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(file.id);
      }
    }
    return [...groups.values()].filter(ids => ids.length > 1);
  }

  function withCommonCaptureTimes(plan, times) {
    const byId = new Map(rows(times).map(row => [String(row.id), Capture.normalize(row.captureTime)]));
    return { ...plan, buckets: rows(plan?.buckets).map(bucket => ({ ...bucket,
      ...Object.fromEntries(["before", "during", "after", "unsorted"].map(phase => [phase, rows(bucket[phase]).map(file => byId.has(file.id) ? { ...file, captureTime: byId.get(file.id) } : file)])),
    })) };
  }

  function mergeCommonSelection(incoming, existing) {
    const old = new Map(photoReviewRows(existing).map(row => [row.id, row]));
    let result = incoming;
    for (const row of photoReviewRows(incoming)) {
      const saved = old.get(row.id); if (!saved) continue;
      result = assignPhotoCategory(result, row.id, saved.itemKey);
      result = assignPhotoPhase(result, row.id, saved.phase);
    }
    return { ...result, buckets: rows(result.buckets).map(bucket => ({ ...bucket,
      ...Object.fromEntries(["before", "during", "after", "unsorted"].map(phase => [phase, rows(bucket[phase]).map(file => ({ ...file, ...(old.get(file.id)?.file || {}) }))])),
    })) };
  }

  function removeCommonPhotos(plan, ids) {
    const removed = new Set(ids);
    const buckets = rows(plan?.buckets).map(bucket => ({ ...bucket,
      ...Object.fromEntries(["before", "during", "after", "unsorted", "heic"].map(phase => [phase, rows(bucket[phase]).filter(file => !removed.has(file.id))])),
    }));
    const photoCount = buckets.reduce((sum, bucket) => sum + ["before", "during", "after", "unsorted"].reduce((n, phase) => n + bucket[phase].length, 0), 0);
    return { ...plan, buckets, photoCount, selectedCount: photoCount };
  }

  function applyCommonPairs(plan, pairs) {
    const byId = new Map(photoReviewRows(plan).map(row => [row.id, row]));
    const used = new Set(), partner = new Map(); let result = plan;
    for (const pair of rows(pairs)) {
      const before = byId.get(pair.beforeId), after = byId.get(pair.afterId);
      if (!["debris_removed", "stain_reduced", "items_removed"].includes(pair.evidence) || !before || !after || before.id === after.id || used.has(before.id) || used.has(after.id)) continue;
      if (!before.itemKey || before.itemKey !== after.itemKey || [before, after].some(row => row.phase !== "unsorted" || row.file.manualPhase)) continue;
      const a = Capture.normalize(before.file.captureTime), b = Capture.normalize(after.file.captureTime);
      if (a && b && (!Capture.comparable(a, b) || Capture.differenceMinutes(a, b) <= 0)) continue;
      used.add(before.id); used.add(after.id); partner.set(before.id, after.id); partner.set(after.id, before.id);
      result = assignPhotoPhase(assignPhotoPhase(result, before.id, "before"), after.id, "after");
    }
    return { ...result, buckets: rows(result.buckets).map(bucket => ({ ...bucket,
      ...Object.fromEntries(["before", "after"].map(phase => [phase, rows(bucket[phase]).map(file => used.has(file.id) ? { ...file, manualPhase: false, pairWith: partner.get(file.id), phaseReason: "같은 장소의 명확한 변화로 전·후 추천 · 저장 전 확인" } : file)])),
    })) };
  }

  // 공용부 사진을 사람이 버튼으로 요청했을 때만 촬영 시각 순서로 나눈다.
  //
  // 작업자는 처음에 작업 전을 몰아 찍고 끝에 작업 후를 몰아 찍는다. 그래서
  // 구역마다 같은 날 찍은 원본 시각을 늘어놓고 가장 크게 벌어진 자리에서 자른다.
  // 자동으로 하지 않는 이유는 그대로다 — 시각만으로는 확실하지 않다. 그래서
  // 사람이 누를 때만 하고, 결과는 화면에서 바로 고칠 수 있는 추천으로 둔다.
  // 사람이 이미 고른 단계, 원본 시각이 없는 사진, 간격이 작은 구역은 건드리지 않는다.
  const COMMON_SPLIT_GAP_MINUTES = 15;
  // 공백 한쪽에 사진이 너무 적으면 그 공백은 '작업 전·후 사이' 가 아니라 따로 찍은
  // 한두 장일 가능성이 크다. 양쪽 모두 2장 이상, 전체의 15% 이상일 때만 기준으로 쓴다.
  // 짧게 끝난 현장(2026-11-03 햇빛빌라: 전 16장 10:46~10:49 → 13분 공백 → 후 22장 11:02~11:04)은
  // 15분에 못 미쳐도 전·후 사이가 분명하다. 그날 전체 흐름이 8장 이상이고, 가장 긴 공백이
  // 5분 이상이면서 두 번째로 긴 공백의 5배 이상이면 그 자리를 경계로 본다(구역별 작은 묶음에는 쓰지 않는다).
  const COMMON_SPLIT_ADAPTIVE_MINUTES = 5;
  function sessionCut(list, gap, adaptive = false) {
    const minimum = Math.max(2, Math.ceil(list.length * 0.15));
    const gaps = [];
    for (let index = 1; index < list.length; index += 1) gaps.push({ index, minutes: Capture.differenceMinutes(list[index - 1].captured, list[index].captured) });
    const eligible = gaps.filter(entry => entry.index >= minimum && list.length - entry.index >= minimum).sort((left, right) => right.minutes - left.minutes);
    const best = eligible[0];
    if (!best) return null;
    if (best.minutes >= gap) return { at: list[best.index].captured.local, minutes: best.minutes };
    if (!adaptive || list.length < 8 || best.minutes < COMMON_SPLIT_ADAPTIVE_MINUTES) return null;
    const second = Math.max(0, ...gaps.filter(entry => entry !== best).map(entry => entry.minutes));
    return best.minutes >= second * 5 ? { at: list[best.index].captured.local, minutes: best.minutes } : null;
  }
  function splitCommonByCaptureTime(plan, options) {
    const gap = Number(options && options.gapMinutes) > 0 ? Number(options.gapMinutes) : COMMON_SPLIT_GAP_MINUTES;
    const all = photoReviewRows(plan);
    const visitOf = captured => `${captured.local.slice(0, 10)}|${captured.offset}`;
    const byTime = (left, right) => left.captured.local.localeCompare(right.captured.local);
    // 1) 같은 날 찍은 모든 사진(구역·단계 무관)의 흐름에서 작업 전 한 바퀴와 작업 후
    //    한 바퀴 사이의 공백을 찾는다. 이미 짝이 정해진 사진도 흐름을 보는 데는 쓴다.
    const visits = new Map();
    for (const row of all) {
      const captured = Capture.normalize(row.file.captureTime);
      if (!captured) continue;
      if (!visits.has(visitOf(captured))) visits.set(visitOf(captured), []);
      visits.get(visitOf(captured)).push({ id: row.id, captured });
    }
    const cuts = new Map([...visits].map(([visit, list]) => [visit, sessionCut(list.sort(byTime), gap, true)]));
    // 2) 나눌 대상: 구역이 정해졌고, 아직 미분류이며, 사람이 고르지 않은 사진.
    const targets = new Map();
    let undated = 0;
    for (const row of all) {
      if (!row.itemKey || row.phase !== "unsorted" || row.file.manualPhase) continue;
      const captured = Capture.normalize(row.file.captureTime);
      if (!captured) { undated += 1; continue; }
      const visit = visitOf(captured);
      const key = cuts.get(visit) ? `visit|${visit}` : `${row.itemKey}|${visit}`;
      if (!targets.has(key)) targets.set(key, []);
      targets.get(key).push({ id: row.id, captured, visit });
    }
    let result = plan, photos = 0, skipped = 0;
    const areas = new Set(), reasons = new Map();
    for (const [key, list] of targets) {
      list.sort(byTime);
      // 날짜 전체의 공백이 있으면 그것으로, 없으면 그 구역 사진만의 공백으로 나눈다.
      const cut = key.startsWith("visit|") ? cuts.get(list[0].visit) : sessionCut(list, gap);
      if (!cut) { skipped += list.length; continue; }
      const reason = key.startsWith("visit|")
        ? `같은 날 촬영 흐름의 ${Math.round(cut.minutes)}분 공백 기준 추천 · 확인 필요`
        : `촬영 시각 순서로 나눈 추천(${Math.round(cut.minutes)}분 간격) · 확인 필요`;
      for (const entry of list) {
        result = assignPhotoPhase(result, entry.id, entry.captured.local < cut.at ? "before" : "after");
        reasons.set(entry.id, reason); photos += 1;
        areas.add(all.find(row => row.id === entry.id).itemKey);
      }
    }
    result = Object.assign({}, result, { buckets: rows(result.buckets).map(bucket => Object.assign({}, bucket,
      Object.fromEntries(["before", "after"].map(phase => [phase, rows(bucket[phase]).map(file => reasons.has(file.id) ? Object.assign({}, file, { phaseReason: reasons.get(file.id) }) : file)])))) });
    return { plan: result, areas: areas.size, photos, skipped, undated };
  }

  // AI 같은 장소 짝 찾기 결과를 반영한다. 이미 작업 전·후로 나뉜 같은 구역 사진끼리만
  // 짝짓고 단계는 바꾸지 않는다. 사람이 직접 고른 짝·단계는 건드리지 않는다.
  function applyMatchedPairs(plan, pairs) {
    const byId = new Map(photoReviewRows(plan).map(row => [row.id, row]));
    const partner = new Map();
    for (const pair of rows(pairs)) {
      const before = byId.get(text(pair.beforeId, 200)), after = byId.get(text(pair.afterId, 200));
      if (!before || !after || before.phase !== "before" || after.phase !== "after" || !before.itemKey || before.itemKey !== after.itemKey) continue;
      if (partner.has(before.id) || partner.has(after.id) || text(before.file.samePlaceWith, 200) || text(after.file.samePlaceWith, 200)) continue;
      partner.set(before.id, after.id); partner.set(after.id, before.id);
    }
    return { plan: Object.assign({}, plan, { buckets: rows(plan && plan.buckets).map(bucket => Object.assign({}, bucket,
      Object.fromEntries(["before", "after"].map(phase => [phase, rows(bucket[phase]).map(file => partner.has(file.id) ? Object.assign({}, file, { samePlaceWith: partner.get(file.id) }) : file)])))) }),
      paired: partner.size / 2 };
  }
  // 짝 찾기를 보낼 구역: 작업 전·후가 모두 있고 아직 짝이 없는 사진이 남은 구역.
  // 같은 장소 짝 찾기는 더 신중한 모델을 쓰므로 한 번에 16장까지만 보낸다(17장에 약 55초).
  function matchRequests(plan, limit = 16) {
    const requests = [];
    for (const bucket of rows(plan && plan.buckets)) {
      if (!bucket.itemKey) continue;
      const unpaired = phase => rows(bucket[phase]).filter(file => !text(file.samePlaceWith, 200));
      const before = unpaired("before"), after = unpaired("after");
      if (!before.length || !after.length) continue;
      // 한 번에 30장까지: 작업 후는 모두, 작업 전은 남는 자리만큼 촬영 시각 순으로.
      const afterIds = after.slice(0, Math.min(after.length, limit - 1));
      const beforeIds = before.slice(0, limit - afterIds.length);
      const phases = Object.fromEntries([...beforeIds.map(file => [file.id, "before"]), ...afterIds.map(file => [file.id, "after"])]);
      requests.push({ itemKey: bucket.itemKey, fileIds: Object.keys(phases), phases });
    }
    return requests;
  }

  function syncCommonDraftPhotos(existing, incoming, managedIds) {
    const phases = ["before", "during", "after"], identity = photo => photo.driveFileId || photo.id;
    const previous = new Map(rows(existing).flatMap(item => phases.flatMap(phase => rows(item[phase]))).map(photo => [identity(photo), photo]));
    const managed = new Set(managedIds);
    const kept = rows(existing).map(item => ({ ...item, ...Object.fromEntries(phases.map(phase => [phase, rows(item[phase]).filter(photo => !managed.has(identity(photo)))])) }));
    const freshPair = photo => { const { pairId: _old, ...rest } = previous.get(identity(photo)) || {}; return { ...photo, ...rest, ...(photo.pairId ? { pairId: photo.pairId } : {}) }; };
    const enriched = rows(incoming).map(item => ({ ...item, ...Object.fromEntries(phases.map(phase => [phase, rows(item[phase]).map(freshPair)])) }));
    return { ...mergeDraftPhotos(kept, enriched), ids: enriched.flatMap(item => phases.flatMap(phase => rows(item[phase]))).map(identity) };
  }

  return Object.freeze({
    commonComparisonGroups, withCommonCaptureTimes, applyCommonPairs, applyMatchedPairs, matchRequests, splitCommonByCaptureTime, COMMON_SPLIT_GAP_MINUTES, syncCommonDraftPhotos, mergeCommonSelection, removeCommonPhotos,
    VIEWABLE,
    UNVIEWABLE,
    GAP_MINUTES,
    FOLDER_HINTS,
    AI_CATEGORY_LABELS,
    parseFolderName,
    parseDateChunk,
    kindFromWords,
    itemKeyForFolder,
    normalizeFolderWord,
    takenAt,
    viewable,
    unviewable,
    splitBeforeAfter,
    phaseHint,
    orderPairs,
    photoReviewRows,
    assignPhotoPhase,
    assignPhotoCategory,
    mergeDraftPhotos,
    planFromTree,
    toReportDraft,
    applyPhotoClassifications,
    text,
    rows,
  });
});
