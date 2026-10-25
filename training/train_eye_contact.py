"""Train the eye-contact classifier on Columbia Gaze features and export it for the browser.

Label: eye contact = vertical gaze 0 deg and horizontal gaze within +-5 deg of the camera.
Evaluation: 5-fold GroupKFold by subject, so every score is on people never seen in training.
Export: frontend/public/models/eye_contact.json (scaler + MLP weights + threshold + metrics +
test vectors that the frontend parity check replays).
"""
from __future__ import annotations

import csv
import json
import math
import sys
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, f1_score, roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import FEATURE_NAMES  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
FEATURES_CSV = ROOT / "data" / "datasets" / "columbia_gaze" / "features.csv"
RAW_SAMPLES = FEATURES_CSV.parent / "raw_samples.json"
OUT = ROOT / "frontend" / "public" / "models" / "eye_contact.json"
HIDDEN = 16
SEED = 0


def load():
    with FEATURES_CSV.open() as f:
        rows = [r for r in csv.DictReader(f) if r["face"] == "1"]
    X = np.array([[float(r[k]) for k in FEATURE_NAMES] for r in rows])
    y = np.array([int(int(r["V"]) == 0 and abs(int(r["H"])) <= 5) for r in rows])
    groups = np.array([r["subject"] for r in rows])
    head_angle = np.array([float(r["head_angle"]) for r in rows])
    return X, y, groups, head_angle


def heuristic(X: np.ndarray, head_angle: np.ndarray) -> np.ndarray:
    """The browser's previous untrained rule, for a baseline."""
    max_gaze = X[:, :8].max(axis=1)
    return np.where((max_gaze < 0.45) & (head_angle < 0.4), 0.9, 0.1)


def balanced(X, y, rng):
    """Oversample positives to a 1:1 ratio (MLPClassifier has no class_weight)."""
    pos, neg = np.where(y == 1)[0], np.where(y == 0)[0]
    extra = rng.choice(pos, size=max(len(neg) - len(pos), 0), replace=True)
    idx = np.concatenate([neg, pos, extra])
    rng.shuffle(idx)
    return X[idx], y[idx]


def make_mlp():
    return MLPClassifier(hidden_layer_sizes=(HIDDEN,), activation="tanh", alpha=1e-3,
                         max_iter=2000, early_stopping=True, random_state=SEED)


def best_threshold(y, p):
    grid = np.linspace(0.05, 0.95, 91)
    f1s = [f1_score(y, p >= t) for t in grid]
    return float(grid[int(np.argmax(f1s))])


def report(name, y, p, thr):
    pred = p >= thr
    tn, fp, fn, tp = confusion_matrix(y, pred).ravel()
    m = {"auc": round(roc_auc_score(y, p), 4), "f1": round(f1_score(y, pred), 4),
         "accuracy": round(float((pred == y).mean()), 4), "precision": round(tp / max(tp + fp, 1), 4),
         "recall": round(tp / max(tp + fn, 1), 4), "threshold": round(thr, 3),
         "confusion": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)}}
    print(f"{name:22} AUC {m['auc']:.3f}  F1 {m['f1']:.3f}  acc {m['accuracy']:.3f}  "
          f"P {m['precision']:.3f}  R {m['recall']:.3f}  thr {thr:.2f}  {m['confusion']}")
    return m


def main() -> None:
    if not FEATURES_CSV.exists():
        sys.exit("Run training/extract_features.py first.")
    X, y, groups, head_angle = load()
    print(f"{len(y)} samples, {y.sum()} positives, {len(set(groups))} subjects")
    rng = np.random.default_rng(SEED)

    oof = {"mlp": np.zeros(len(y)), "logreg": np.zeros(len(y))}
    for tr, te in GroupKFold(n_splits=5).split(X, y, groups):
        scaler = StandardScaler().fit(X[tr])
        Xtr, ytr = balanced(scaler.transform(X[tr]), y[tr], rng)
        oof["mlp"][te] = make_mlp().fit(Xtr, ytr).predict_proba(scaler.transform(X[te]))[:, 1]
        lr = LogisticRegression(class_weight="balanced", max_iter=2000).fit(scaler.transform(X[tr]), y[tr])
        oof["logreg"][te] = lr.predict_proba(scaler.transform(X[te]))[:, 1]

    print("\nSubject-held-out (5-fold GroupKFold) results:")
    metrics = {
        "heuristic_baseline": report("old heuristic", y, heuristic(X, head_angle), 0.5),
        "logreg": report("logistic regression", y, oof["logreg"], best_threshold(y, oof["logreg"])),
    }
    thr = best_threshold(y, oof["mlp"])
    metrics["mlp"] = report("MLP (exported)", y, oof["mlp"], thr)

    # Final model on all subjects.
    scaler = StandardScaler().fit(X)
    Xb, yb = balanced(scaler.transform(X), y, rng)
    mlp = make_mlp().fit(Xb, yb)

    test_idx = rng.choice(len(y), size=10, replace=False)
    test_vectors = [{"x": X[i].tolist(), "p": float(mlp.predict_proba(scaler.transform(X[i:i + 1]))[0, 1])}
                    for i in test_idx]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "version": 1,
        "features": FEATURE_NAMES,
        "mean": scaler.mean_.tolist(),
        "scale": scaler.scale_.tolist(),
        "W1": mlp.coefs_[0].tolist(),            # [n_features][HIDDEN]
        "b1": mlp.intercepts_[0].tolist(),
        "W2": mlp.coefs_[1][:, 0].tolist(),      # [HIDDEN]
        "b2": float(mlp.intercepts_[1][0]),
        "activation": "tanh",
        "threshold": thr,
        "label_rule": "vertical gaze 0 deg and |horizontal gaze| <= 5 deg",
        "metrics_subject_holdout": metrics,
        "dataset": {
            "name": "Columbia Gaze Data Set",
            "samples": int(len(y)), "positives": int(y.sum()), "subjects": int(len(set(groups))),
            "license": "Non-commercial research use only (Columbia CAVE)",
            "citation": "B.A. Smith, Q. Yin, S.K. Feiner, S.K. Nayar. Gaze Locking: Passive Eye Contact "
                        "Detection for Human-Object Interaction. ACM UIST 2013.",
        },
        "test_vectors": test_vectors,
        "feature_samples": json.loads(RAW_SAMPLES.read_text()) if RAW_SAMPLES.exists() else [],
    }, indent=1))
    print(f"\nExported {OUT.relative_to(ROOT)}  (threshold {thr:.2f})")
    if not math.isfinite(metrics["mlp"]["auc"]):
        sys.exit("Training produced invalid metrics")


if __name__ == "__main__":
    main()
