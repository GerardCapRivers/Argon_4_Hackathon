// Checks the browser's eye-contact code reproduces Python's numbers exactly:
//  1. computeFeatures() on raw MediaPipe outputs == training/features.py
//  2. forward() on test vectors == sklearn MLPClassifier.predict_proba
// Runs lib/eyeModel.ts directly via Node's built-in TypeScript type stripping.
import { readFileSync } from "node:fs";
import { computeFeatures, forward } from "../lib/eyeModel.ts";

const net = JSON.parse(readFileSync(new URL("../public/models/eye_contact.json", import.meta.url)));
let worst = 0;
let checks = 0;

for (const s of net.feature_samples ?? []) {
  const lm = [];
  for (const [i, [x, y]] of Object.entries(s.landmarks)) lm[Number(i)] = { x, y };
  const got = computeFeatures(s.blendshapes, lm);
  got.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - s.features[i])); checks++; });
}
for (const t of net.test_vectors ?? []) {
  worst = Math.max(worst, Math.abs(forward(net, t.x) - t.p));
  checks++;
}

if (checks === 0) throw new Error("No samples in eye_contact.json to check");
console.log(`${checks} values checked, max abs difference ${worst.toExponential(2)}`);
if (worst > 1e-4) {
  console.error("FAIL: browser eye-contact code disagrees with the Python model");
  process.exit(1);
}
console.log("OK: browser and Python eye-contact models match");
