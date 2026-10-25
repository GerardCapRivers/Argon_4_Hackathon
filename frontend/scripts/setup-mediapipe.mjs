// Copies MediaPipe's wasm runtime into public/ and fetches the face landmarker model,
// so eye-contact detection works offline and frames never leave the browser.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

const out = "public/mediapipe";
mkdirSync(out, { recursive: true });
cpSync("node_modules/@mediapipe/tasks-vision/wasm", `${out}/wasm`, { recursive: true });

const model = `${out}/face_landmarker.task`;
if (!existsSync(model)) {
  const url = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
  writeFileSync(model, Buffer.from(await res.arrayBuffer()));
}
console.log("MediaPipe assets ready in", out);
