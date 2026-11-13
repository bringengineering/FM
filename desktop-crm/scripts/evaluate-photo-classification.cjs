"use strict";
const fs = require("node:fs");
const { evaluate } = require("../src/photo-classification-evaluation");
try {
  const path = process.argv[2];
  if (!path || fs.statSync(path).size > 2 * 1024 * 1024) throw new Error("Invalid evaluation file");
  const data = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!data.baseline || !data.candidate) throw new Error("Both runs required");
  // Print aggregate metrics only, never private sample IDs or labels.
  process.stdout.write(JSON.stringify({ baseline: evaluate(data.labels, data.baseline), candidate: evaluate(data.labels, data.candidate) }, null, 2) + "\n");
} catch {
  process.stderr.write("평가 자료를 확인해 주세요. 독립 검수한 labels와 baseline/candidate 결과가 필요합니다.\n");
  process.exitCode = 1;
}
