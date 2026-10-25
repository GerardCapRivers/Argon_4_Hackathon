/**
 * Eye-contact model math with no browser/MediaPipe dependencies, so the Node parity
 * check (scripts/check-eye-model.mjs) runs this exact file against Python's outputs.
 *
 * Feature formulas mirror training/features.py, which is the source of truth.
 */

export const GAZE_KEYS = [
  "eyeLookInLeft", "eyeLookOutLeft", "eyeLookUpLeft", "eyeLookDownLeft",
  "eyeLookInRight", "eyeLookOutRight", "eyeLookUpRight", "eyeLookDownRight",
];

// FaceMesh landmark indices (478-point model with irises); same as training/features.py.
const EYE_A = { outer: 33, inner: 133, top: 159, bottom: 145, iris: 468 };
const EYE_B = { inner: 362, outer: 263, top: 386, bottom: 374, iris: 473 };
const NOSE_TIP = 1, FOREHEAD = 10, CHIN = 152;

export type Point = { x: number; y: number };
export type Features = number[];

const safeDiv = (a: number, b: number) => (Math.abs(b) > 1e-6 ? a / b : 0);

export function computeFeatures(blendshapes: Record<string, number>, lm: Point[]): Features {
  const x = (i: number) => lm[i].x;
  const y = (i: number) => lm[i].y;
  const irisHA = safeDiv(x(EYE_A.iris) - x(EYE_A.outer), x(EYE_A.inner) - x(EYE_A.outer));
  const irisHB = safeDiv(x(EYE_B.iris) - x(EYE_B.inner), x(EYE_B.outer) - x(EYE_B.inner));
  const irisVA = safeDiv(y(EYE_A.iris) - y(EYE_A.top), y(EYE_A.bottom) - y(EYE_A.top));
  const irisVB = safeDiv(y(EYE_B.iris) - y(EYE_B.top), y(EYE_B.bottom) - y(EYE_B.top));
  const eyeMidX = (x(EYE_A.outer) + x(EYE_B.outer)) / 2;
  const eyeMidY = (y(EYE_A.outer) + y(EYE_B.outer)) / 2;
  const headYaw = safeDiv(x(NOSE_TIP) - eyeMidX, Math.abs(x(EYE_B.outer) - x(EYE_A.outer)));
  const headPitch = safeDiv(y(NOSE_TIP) - eyeMidY, Math.abs(y(CHIN) - y(FOREHEAD)));
  return [...GAZE_KEYS.map((k) => blendshapes[k] ?? 0), irisHA, irisHB, irisVA, irisVB, headYaw, headPitch];
}

/** Exported by training/train_eye_contact.py → public/models/eye_contact.json. */
export type PretrainedNet = {
  features: string[];
  mean: number[];
  scale: number[];
  W1: number[][]; // [nFeatures][hidden]
  b1: number[];
  /** v1 classifier: W2 [hidden], b2 number. v2 gaze model: W2 [hidden][2], b2 [2] -> (horizontal, vertical) degrees. */
  W2: number[] | number[][];
  b2: number | number[];
  output?: "gaze";
  sigma?: [number, number];
  calib?: [number, number];
  threshold: number;
  metrics_subject_holdout?: { mlp?: { auc: number; f1: number; accuracy: number } };
  test_vectors?: { x: number[]; p: number }[];
  feature_samples?: { blendshapes: Record<string, number>; landmarks: Record<string, [number, number]>; features: number[] }[];
};

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function hidden(net: PretrainedNet, x: Features): number[] {
  return net.b1.map((b, j) => {
    let s = b;
    for (let i = 0; i < x.length; i++) s += ((x[i] - net.mean[i]) / net.scale[i]) * net.W1[i][j];
    return Math.tanh(s);
  });
}

/** Predicted (horizontal, vertical) gaze angle in degrees relative to the camera (v2 gaze models). */
export function gazeAngles(net: PretrainedNet, x: Features): [number, number] {
  const h = hidden(net, x);
  const W2 = net.W2 as number[][];
  const b2 = net.b2 as number[];
  return [0, 1].map((k) => h.reduce((s, v, j) => s + v * W2[j][k], b2[k])) as [number, number];
}

/**
 * Eye-contact probability, identical to the Python export:
 * v1: standardize → tanh layer → sigmoid (MLPClassifier).
 * v2: predict gaze angles → distance from the lens in σ units → calibrated sigmoid.
 */
export function forward(net: PretrainedNet, x: Features): number {
  if (net.output === "gaze") {
    const [gh, gv] = gazeAngles(net, x);
    const [sh, sv] = net.sigma ?? [7.5, 5];
    const lens = -Math.sqrt((gh / sh) ** 2 + (gv / sv) ** 2);
    const [a, b] = net.calib ?? [1, 0];
    return sigmoid(a * lens + b);
  }
  const h = hidden(net, x);
  return sigmoid(h.reduce((s, v, j) => s + v * (net.W2 as number[])[j], net.b2 as number));
}

const logit = (p: number) => Math.log(Math.max(p, 1e-6) / Math.max(1 - p, 1e-6));

/**
 * Personal calibration on top of the pretrained net: Platt scaling p' = σ(a·logit(p) + c),
 * fitted on the presenter's 6-second look-at / look-away capture. Two parameters, so it
 * adapts the decision boundary to their face and lighting without overfitting.
 */
export function fitPlatt(baseProbs: number[], labels: number[], threshold: number, epochs = 500, lr = 0.1) {
  // Start from the pretrained decision boundary: logit(p) - logit(threshold).
  let a = 1;
  let c = -logit(threshold);
  const z = baseProbs.map(logit);
  for (let e = 0; e < epochs; e++) {
    let ga = 0, gc = 0;
    z.forEach((zi, i) => {
      const err = sigmoid(a * zi + c) - labels[i];
      ga += err * zi;
      gc += err;
    });
    a -= (lr * ga) / z.length;
    c -= (lr * gc) / z.length;
  }
  return { a, c };
}

export const applyPlatt = (p: number, cal: { a: number; c: number }) => sigmoid(cal.a * logit(p) + cal.c);
