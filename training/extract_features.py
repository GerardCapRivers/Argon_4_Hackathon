"""Run MediaPipe FaceLandmarker over Columbia Gaze and write features.csv.

Uses the same face_landmarker.task model file as the browser, and features.py for the
feature formulas, so the trained model sees exactly what the webcam pipeline produces.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import (  # noqa: E402
    CHIN, EYE_A_BOTTOM, EYE_A_INNER, EYE_A_OUTER, EYE_A_TOP, EYE_B_BOTTOM, EYE_B_INNER, EYE_B_OUTER,
    EYE_B_TOP, FEATURE_NAMES, FOREHEAD, IRIS_A, IRIS_B, NOSE_TIP, compute,
)

USED_LANDMARKS = [EYE_A_OUTER, EYE_A_INNER, EYE_A_TOP, EYE_A_BOTTOM, IRIS_A, EYE_B_INNER, EYE_B_OUTER,
                  EYE_B_TOP, EYE_B_BOTTOM, IRIS_B, NOSE_TIP, FOREHEAD, CHIN]

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "datasets" / "columbia_gaze"
MODEL = ROOT / "frontend" / "public" / "mediapipe" / "face_landmarker.task"
NAME = re.compile(r"^(\d{4})_2m_(-?\d+)P_(-?\d+)V_(-?\d+)H\.jpg$", re.I)
MAX_SIDE = 1280

_landmarker = None


def _init() -> None:
    global _landmarker
    from mediapipe.tasks import python as mp_tasks
    from mediapipe.tasks.python import vision

    opts = vision.FaceLandmarkerOptions(
        base_options=mp_tasks.BaseOptions(model_asset_path=str(MODEL)),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
    )
    _landmarker = vision.FaceLandmarker.create_from_options(opts)


def _process(path: str) -> dict | None:
    import mediapipe as mp

    m = NAME.match(Path(path).name)
    subject, P, V, H = m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(4))
    img = Image.open(path)
    img.draft("RGB", (MAX_SIDE, MAX_SIDE))  # fast JPEG downscale while decoding (originals are 5184x3456)
    img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    res = _landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(img)))
    if not res.face_landmarks:
        return {"path": path, "subject": subject, "P": P, "V": V, "H": H, "face": 0}
    shapes = {c.category_name: c.score for c in res.face_blendshapes[0]}
    lm = [(p.x, p.y) for p in res.face_landmarks[0]]
    feats = compute(shapes, lm)
    mat = np.asarray(res.facial_transformation_matrixes[0])
    row = {"path": path, "subject": subject, "P": P, "V": V, "H": H, "face": 1,
           # Only used for the old-heuristic baseline (same formula as the browser had).
           "head_angle": math.acos(min(1.0, abs(float(mat[2, 2]))))}
    row.update(dict(zip(FEATURE_NAMES, feats)))
    # Raw inputs, so the frontend can check its feature code reproduces these numbers.
    row["_raw"] = {"blendshapes": shapes, "landmarks": {str(i): list(lm[i]) for i in USED_LANDMARKS},
                   "features": feats}
    return row


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--subjects", type=int, default=0, help="only the first N subjects (quick smoke test)")
    args = ap.parse_args()
    if not MODEL.exists():
        sys.exit(f"Missing {MODEL}. Run `npm install` in frontend/ (postinstall fetches it).")
    paths = sorted(str(p) for p in DATA.rglob("*") if NAME.match(p.name))
    if not paths:
        sys.exit(f"No Columbia Gaze images under {DATA}. Run training/download.py first.")
    if args.subjects:
        keep = sorted({NAME.match(Path(p).name).group(1) for p in paths})[: args.subjects]
        paths = [p for p in paths if NAME.match(Path(p).name).group(1) in keep]
    print(f"Extracting features from {len(paths)} images ...")
    rows = []
    with ProcessPoolExecutor(max_workers=6, initializer=_init) as ex:
        for i, row in enumerate(ex.map(_process, paths, chunksize=16), 1):
            rows.append(row)
            if i % 500 == 0:
                print(f"  {i}/{len(paths)}")

    raws = [r.pop("_raw") for r in rows if "_raw" in r]
    (DATA / "raw_samples.json").write_text(json.dumps(raws[:5]))
    out = DATA / "features.csv"
    cols = ["path", "subject", "P", "V", "H", "face", "head_angle", *FEATURE_NAMES]
    with out.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)

    found = [r for r in rows if r["face"]]
    print(f"Faces found in {len(found)}/{len(rows)} images ({len(found) / len(rows):.1%}) -> {out}")
    # Sanity check: head yaw should track the labelled head pose P.
    if found:
        P = np.array([r["P"] for r in found], float)
        yaw = np.array([r["head_yaw"] for r in found], float)
        print(f"corr(head_yaw, P label) = {np.corrcoef(P, yaw)[0, 1]:+.3f}  (expect |r| > 0.9)")


if __name__ == "__main__":
    main()
