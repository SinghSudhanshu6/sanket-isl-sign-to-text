"""Landmark -> feature vector. MUST match extension/lib/core.js (featureVector / normalizeHand)."""
import numpy as np

PER_HAND = 65
FEATURE_DIM = PER_HAND * 2


def normalize_hand(lm):
    """lm: 21 landmarks with .x .y .z. Relative to wrist, scaled by wrist->middle-MCP distance."""
    pts = np.array([[p.x, p.y, p.z] for p in lm], dtype=np.float32)
    scale = np.linalg.norm(pts[9] - pts[0]) or 1e-6
    rel = (pts - pts[0]) / scale
    return np.concatenate([rel.reshape(-1), pts[0, :2]])


def feature_vector(result):
    """result: mediapipe.solutions.hands results (image NOT mirrored, same as the browser)."""
    if not result.multi_hand_landmarks:
        return None
    vec = np.zeros(FEATURE_DIM, dtype=np.float32)
    used = [False, False]
    for i, lm in enumerate(result.multi_hand_landmarks[:2]):
        label = result.multi_handedness[i].classification[0].label if result.multi_handedness else "Right"
        slot = 0 if label == "Left" else 1
        if used[slot]:
            slot = 1 - slot
        used[slot] = True
        vec[slot * PER_HAND:(slot + 1) * PER_HAND] = normalize_hand(lm.landmark)
    return vec
