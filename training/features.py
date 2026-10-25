"""Eye-contact features from MediaPipe FaceLandmarker output.

This is the single source of truth for the feature vector. frontend/lib/eyeContact.ts
implements the exact same formulas (checked by frontend/scripts/check-eye-model.mjs).

Only blendshape scores and landmark ratios within one image axis are used, so features
are identical between MediaPipe's Python and JS APIs and invariant to image size/aspect.
"""
from __future__ import annotations

GAZE_KEYS = [
    "eyeLookInLeft", "eyeLookOutLeft", "eyeLookUpLeft", "eyeLookDownLeft",
    "eyeLookInRight", "eyeLookOutRight", "eyeLookUpRight", "eyeLookDownRight",
]

# FaceMesh landmark indices (478-point model with irises).
EYE_A_OUTER, EYE_A_INNER, EYE_A_TOP, EYE_A_BOTTOM, IRIS_A = 33, 133, 159, 145, 468
EYE_B_INNER, EYE_B_OUTER, EYE_B_TOP, EYE_B_BOTTOM, IRIS_B = 362, 263, 386, 374, 473
NOSE_TIP, FOREHEAD, CHIN = 1, 10, 152

FEATURE_NAMES = GAZE_KEYS + [
    "iris_h_a", "iris_h_b",   # iris position between eye corners (0..1, ~0.5 = centred)
    "iris_v_a", "iris_v_b",   # iris position between eyelids
    "head_yaw",               # nose offset from eye midpoint, in inter-eye widths
    "head_pitch",             # nose offset below eye line, in face heights
]


def _safe_div(a: float, b: float) -> float:
    return a / b if abs(b) > 1e-6 else 0.0


def compute(blendshapes: dict[str, float], lm: list[tuple[float, float]]) -> list[float]:
    """blendshapes: name -> score. lm: list of (x, y) normalized landmarks (>= 478 points)."""
    x = lambda i: lm[i][0]  # noqa: E731
    y = lambda i: lm[i][1]  # noqa: E731
    iris_h_a = _safe_div(x(IRIS_A) - x(EYE_A_OUTER), x(EYE_A_INNER) - x(EYE_A_OUTER))
    iris_h_b = _safe_div(x(IRIS_B) - x(EYE_B_INNER), x(EYE_B_OUTER) - x(EYE_B_INNER))
    iris_v_a = _safe_div(y(IRIS_A) - y(EYE_A_TOP), y(EYE_A_BOTTOM) - y(EYE_A_TOP))
    iris_v_b = _safe_div(y(IRIS_B) - y(EYE_B_TOP), y(EYE_B_BOTTOM) - y(EYE_B_TOP))
    eye_mid_x = (x(EYE_A_OUTER) + x(EYE_B_OUTER)) / 2
    eye_mid_y = (y(EYE_A_OUTER) + y(EYE_B_OUTER)) / 2
    head_yaw = _safe_div(x(NOSE_TIP) - eye_mid_x, abs(x(EYE_B_OUTER) - x(EYE_A_OUTER)))
    head_pitch = _safe_div(y(NOSE_TIP) - eye_mid_y, abs(y(CHIN) - y(FOREHEAD)))
    return [blendshapes.get(k, 0.0) for k in GAZE_KEYS] + [
        iris_h_a, iris_h_b, iris_v_a, iris_v_b, head_yaw, head_pitch,
    ]
