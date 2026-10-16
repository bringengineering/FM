// Closed visual vocabulary: never forward model prose or inferred personal data.
export const SPACES = ["living", "bedroom", "kitchen", "bath", "veranda", "entrance", "other", "unknown"];
export const TARGETS = ["floor", "window", "sink", "cabinet", "hood", "toilet", "wall", "aircon", "refrigerator", "other", "unknown"];
export const ACTIONS = ["wiping", "sweeping", "mopping", "scrubbing", "washing", "collecting", "unknown"];
export const CONTACTS = ["wiping_surface", "driving_tool", "holding_object", "bracing", "none", "unknown"];
export const WATER = ["jet_to_target", "droplets_only", "wet_surface", "none", "unknown"];
export const FEATURES = ["room_fixtures", "floor_surface", "window_frame", "sink_bowl", "cabinet_interior", "toilet_bowl", "wall_surface", "hood_body", "metal_mesh", "grease_filter_frame", "aircon_body", "plastic_mesh", "aircon_filter_frame", "refrigerator_body", "shelf_rail", "transparent_drawer", "steps", "balustrade", "continuous_corridor", "doorway", "ceiling_fixture", "waste_bins", "cleaning_contact", "plumbing_fixture", "screen_capture", "document_layout", "kitchen_counter", "cooking_fixture", "bath_fixture", "inactive_tool", "supporting_hand", "cloth_display", "active_hand_contact", "water_flow", "open_walkway", "ceiling_surface"];
export const ANCHORS = ["tile_pattern", "fixture_position", "frame_shape", "surface_edge"];
export const QUALITY = ["clear", "blurred", "too_small", "obstructed", "unknown"];
export const ISSUES = ["quality", "category_uncertain", "space_uncertain", "target_uncertain", "contradiction", "missing_result", "review_disagreement", "non_work"];
const score = value => Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
const oneOf = (value, values) => values.includes(value) ? value : "unknown";
const any = (features, names) => names.some(name => features.includes(name));
const FEATURE_LABELS = Object.freeze({ room_fixtures: "공간의 고정 설비", floor_surface: "바닥면", window_frame: "창틀 구조", sink_bowl: "싱크볼", cabinet_interior: "수납장 내부", toilet_bowl: "변기", wall_surface: "벽면", hood_body: "후드 본체", metal_mesh: "금속 망", grease_filter_frame: "후드 필터 프레임", aircon_body: "에어컨 본체", plastic_mesh: "플라스틱 망", aircon_filter_frame: "에어컨 필터 프레임", refrigerator_body: "냉장고 본체", shelf_rail: "선반 레일", transparent_drawer: "투명 서랍", steps: "계단 단차", balustrade: "난간 구조", continuous_corridor: "이어지는 복도", doorway: "출입문 구조", ceiling_fixture: "천장 설비", waste_bins: "분리수거 용기", cleaning_contact: "대상에 접촉하는 청소 동작", plumbing_fixture: "수전·급수 설비" });

export function categoryFor(space, target) {
  if (["hood", "aircon", "refrigerator"].includes(target)) return target;
  if (target === "unknown" || space === "unknown") return "review";
  if (["bath", "veranda"].includes(space)) return space;
  if (target === "window") return "window";
  if (space === "kitchen" && ["sink", "cabinet"].includes(target)) return "kitchen";
  if (target === "cabinet") return "storage";
  return target === "floor" ? "floor" : "finish";
}

function targetVisible(target, f) {
  if (!TARGETS.includes(target)) return false;
  if (target === "hood") return f.includes("hood_body") || ["metal_mesh", "grease_filter_frame"].every(x => f.includes(x));
  if (target === "aircon") return f.includes("aircon_body") || ["plastic_mesh", "aircon_filter_frame"].every(x => f.includes(x));
  if (target === "refrigerator") return f.includes("refrigerator_body") || ["shelf_rail", "transparent_drawer"].every(x => f.includes(x));
  const evidence = { floor: ["floor_surface", "steps", "continuous_corridor"], window: ["window_frame"], sink: ["sink_bowl"], cabinet: ["cabinet_interior"], toilet: ["toilet_bowl"], wall: ["wall_surface"], other: ["balustrade", "ceiling_fixture", "ceiling_surface", "waste_bins", "doorway", "plumbing_fixture"] };
  return any(f, evidence[target] || []);
}

export function normalizeEvidence(row, kind, categories) {
  const quality = oneOf(row.quality, QUALITY);
  const features = [...new Set(Array.isArray(row.features) ? row.features.filter(x => FEATURES.includes(x)) : [])].slice(0, 8);
  const scores = { category: score(row.confidence), space: score(row.spaceConfidence), target: score(row.targetConfidence), phase: score(row.phaseConfidence) };
  const nonWork = Array.isArray(row.features) && row.features.some(x => x === "screen_capture" || x === "document_layout");
  const clear = quality === "clear" && !nonWork;
  // Named fixed fixtures can prove room context without also repeating the
  // generic room_fixtures token. A lone sink/loose filter still proves no room.
  const roomVisible = any(features, ["room_fixtures"])
    || (row.space === "kitchen" && (any(features, ["kitchen_counter", "cooking_fixture"]) || ["sink_bowl", "cabinet_interior"].every(x => features.includes(x))))
    || (row.space === "bath" && any(features, ["toilet_bowl", "bath_fixture"]))
    || (row.space === "entrance" && features.includes("doorway"))
    || (row.space === "other" && (any(features, ["continuous_corridor", "steps", "waste_bins", "balustrade"])
      || ["open_walkway", "floor_surface"].every(x => features.includes(x))));
  const space = clear && scores.space >= 75 && roomVisible ? oneOf(row.space, SPACES) : "unknown";
  const target = clear && scores.target >= 75 && targetVisible(row.target, features) ? oneOf(row.target, TARGETS) : "unknown";
  const contact = oneOf(row.contact, CONTACTS), water = oneOf(row.water, WATER);
  // Literal physical observations are required as well as the abstract action
  // token. A glove gripping a wet part or a tap above it proves no wiping/flow.
  const activeContact = (features.includes("active_hand_contact") && ["wiping_surface", "driving_tool"].includes(contact))
    || (features.includes("water_flow") && water === "jet_to_target");
  // One hand may brace the person while the other visibly wipes. Bracing alone
  // is not work; a cloth/tool resting on a surface is not a driven action.
  const inactive = Array.isArray(row.features) && (any(row.features, ["inactive_tool", "cloth_display"]) || (row.features.includes("supporting_hand") && !activeContact));
  const action = !clear || inactive || !activeContact ? "unknown" : oneOf(row.action, ACTIONS);
  const phase = clear && row.phase === "during" && scores.phase >= 85 && action !== "unknown" && activeContact && features.includes("cleaning_contact") ? "during" : "unknown";
  let category = clear && scores.category >= 75 && Object.hasOwn(categories, row.category) ? row.category : "review";
  const issues = [];
  if (nonWork) issues.push("non_work");
  else if (!clear) issues.push("quality");
  if (kind === "common") {
    const required = { entrance: ["doorway"], corridor: ["continuous_corridor"], stairs: ["steps"], handrail: ["balustrade"], windows: ["window_frame"], lighting: ["ceiling_fixture", "ceiling_surface"], recycle: ["waste_bins"] };
    const targets = { corridor: ["floor"], stairs: ["floor"], windows: ["window"], lighting: ["other"] };
    // The existing labels include common floors and ceilings, not only indoor
    // corridors and light fixtures. Preserve scene evidence instead of requiring
    // a fixture that is not part of the photographed work.
    const categoryVisible = any(features, required[category] || [])
      || (category === "corridor" && ["open_walkway", "floor_surface"].every(x => features.includes(x)));
    if (category !== "review" && (!categoryVisible || (targets[category] && target !== "unknown" && !targets[category].includes(target)))) {
      category = "review"; issues.push("contradiction");
    }
  } else {
    const derived = categoryFor(space, target);
    if (category !== "review" && derived !== category) { category = "review"; issues.push("contradiction"); }
    // A confident object can survive an unknown room, but not conflicting labels.
  }
  if (category === "review") issues.push("category_uncertain");
  if (space === "unknown") issues.push("space_uncertain");
  if (target === "unknown") issues.push("target_uncertain");
  const needsReview = !clear || category === "review" || target === "unknown";
  const candidates = [...new Set(Array.isArray(row.candidates) ? row.candidates.filter(x => Object.hasOwn(categories, x) && x !== "review") : [])].slice(0, 2);
  const extraLabels = { kitchen_counter: "주방 조리대 구조", cooking_fixture: "고정 조리 설비", bath_fixture: "욕실 고정 설비", active_hand_contact: "직접 닦는 손·도구", water_flow: "대상에 닿는 물줄기", open_walkway: "경계가 보이는 외부 통로", ceiling_surface: "위쪽 천장면" };
  const evidenceText = features.map(x => FEATURE_LABELS[x] || extraLabels[x]).filter(Boolean).slice(0, 3).join("·");
  return { category, confidence: scores.category, space, target, spaceConfidence: scores.space, targetConfidence: scores.target, phase, phaseConfidence: scores.phase, action, contact, water, quality, features, issues, candidates, needsReview, analysisVersion: 2,
    reason: nonWork ? "문서·메신저 화면은 현장 작업 사진으로 분류하지 않습니다." : issues.includes("contradiction") ? "구역·대상 근거가 서로 달라 확인이 필요합니다." : !clear ? "화질·가림 때문에 대상을 명확히 확인하지 못했습니다." : category === "review" ? "구역을 확정할 근거가 부족합니다. 확인된 대상은 유지합니다." : `${categories[category]} 추천 근거: ${evidenceText}. 저장 전 확인해 주세요.` };
}
