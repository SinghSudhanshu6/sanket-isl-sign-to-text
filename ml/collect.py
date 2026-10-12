"""Record landmark samples for one sign from a webcam (landmarks only, never video).

    python collect.py --label HOSPITAL --signer ravi --n 100
Appends to data/samples.csv (columns: label, signer, f0..f129). Record each sign ~100x from 3+ people,
in different light and distances. Alternatively use the in-browser 'Teach Sanket a sign' and
`python manage.py export_samples -o ../ml/data/samples.csv`.
"""
import argparse
import csv
import os
import time

import cv2
import mediapipe as mp

from features import FEATURE_DIM, feature_vector

p = argparse.ArgumentParser()
p.add_argument("--label", required=True)
p.add_argument("--signer", required=True)
p.add_argument("--n", type=int, default=100)
args = p.parse_args()

os.makedirs("data", exist_ok=True)
path = "data/samples.csv"
new = not os.path.exists(path)
cap = cv2.VideoCapture(0)
hands = mp.solutions.hands.Hands(max_num_hands=2, min_detection_confidence=0.6, min_tracking_confidence=0.5)
print("Starting in 3 seconds - get ready"); time.sleep(3)

got = 0
with open(path, "a", newline="") as f:
    w = csv.writer(f)
    if new:
        w.writerow(["label", "signer"] + [f"f{i}" for i in range(FEATURE_DIM)])
    while got < args.n:
        ok, frame = cap.read()
        if not ok:
            break
        res = hands.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))  # no flip: matches the browser
        vec = feature_vector(res)
        if vec is not None:
            w.writerow([args.label.upper(), args.signer] + [round(float(x), 5) for x in vec])
            got += 1
        cv2.putText(frame, f"{args.label.upper()} {got}/{args.n}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        cv2.imshow("collect (q to quit)", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break
cap.release(); cv2.destroyAllWindows()
print(f"Saved {got} samples for {args.label.upper()}")
