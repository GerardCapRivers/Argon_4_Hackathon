/**
 * Eye-contact detection, fully in the browser (no frames leave the device).
 *
 * MediaPipe FaceLandmarker → 14 features (gaze blendshapes, iris position between eye corners
 * and lids, head yaw/pitch from landmark geometry) → a small MLP pretrained on the Columbia Gaze
 * dataset (training/). The optional 6-second calibration fits a 2-parameter Platt rescaling on
 * top, personalising the decision boundary to the presenter's face and lighting.
 */
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { applyPlatt, computeFeatures, Features, fitPlatt, forward, GAZE_KEYS, PretrainedNet } from "./eyeModel";

export type Sample = { features: Features; headAngle: number };

/**
 * MediaPipe's wasm runtime prints routine glog lines (e.g. "INFO: Created TensorFlow Lite XNNPACK
 * delegate for CPU.") through console.error, which Next's dev overlay shows as an error. Drop
 * those INFO/WARNING lines; anything else still reaches console.error.
 */
let consoleFiltered = false;
function filterMediapipeLogs() {
  if (consoleFiltered || typeof console === "undefined") return;
  consoleFiltered = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (/^(INFO|WARNING|W\d{4}|I\d{4}): /.test(first) || first.includes("XNNPACK delegate")) return;
    original(...args);
  };
}

export async function createLandmarker(): Promise<FaceLandmarker> {
  filterMediapipeLogs();
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task", delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
}

/** Extract features for one video frame, or null when no face is visible. */
export function extractSample(lm: FaceLandmarker, video: HTMLVideoElement, ts: number): Sample | null {
  const r = lm.detectForVideo(video, ts);
  const shapes = r.faceBlendshapes?.[0]?.categories;
  const points = r.faceLandmarks?.[0];
  const mat = r.facialTransformationMatrixes?.[0]?.data;
  if (!shapes || !points || points.length < 478 || !mat) return null;
  const blend = Object.fromEntries(shapes.map((c) => [c.categoryName, c.score]));
  // Element [2][2] of the pose (index 10 in row- or column-major order) = cos(head angle off camera axis).
  const headAngle = Math.acos(Math.min(1, Math.abs(mat[10])));
  return { features: computeFeatures(blend, points), headAngle };
}

/** Fallback when the pretrained model can't load: eyes roughly centred, head roughly facing the camera. */
export function heuristic(s: Sample): number {
  const maxGaze = Math.max(...GAZE_KEYS.map((_, i) => s.features[i]));
  return maxGaze < 0.45 && s.headAngle < 0.4 ? 0.9 : 0.1;
}

export class EyeContactModel {
  net: PretrainedNet | null = null;
  calibration: { a: number; c: number } | null = null;

  /** Load the Columbia Gaze model; returns its subject-held-out AUC, or null if unavailable. */
  async loadPretrained(url = "/models/eye_contact.json"): Promise<number | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      this.net = (await res.json()) as PretrainedNet;
      return this.net.metrics_subject_holdout?.mlp?.auc ?? null;
    } catch {
      return null;
    }
  }

  baseProb(s: Sample): number {
    return this.net ? forward(this.net, s.features) : heuristic(s);
  }

  prob(s: Sample): number {
    const p = this.baseProb(s);
    return this.calibration ? applyPlatt(p, this.calibration) : p;
  }

  predict(s: Sample): boolean {
    // Platt output is a calibrated probability (0.5 boundary); the raw net uses its tuned threshold.
    const threshold = this.calibration || !this.net ? 0.5 : this.net.threshold;
    return this.prob(s) >= threshold;
  }

  /** Personalise on calibration samples. Returns accuracy on them before and after. */
  calibrate(positives: Sample[], negatives: Sample[]): { before: number; after: number } {
    if (positives.length < 5 || negatives.length < 5) {
      throw new Error("Not enough calibration samples, keep your face in view");
    }
    const samples = [...positives, ...negatives];
    const labels = [...positives.map(() => 1), ...negatives.map(() => 0)];
    const accuracy = () => samples.filter((s, i) => Number(this.predict(s)) === labels[i]).length / samples.length;
    this.calibration = null;
    const before = accuracy();
    const base = samples.map((s) => this.baseProb(s));
    this.calibration = fitPlatt(base, labels, this.net?.threshold ?? 0.5);
    return { before, after: accuracy() };
  }
}
