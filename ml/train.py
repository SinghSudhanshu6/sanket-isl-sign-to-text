"""Train an MLP on landmark vectors (static signs). Holds one signer out for the honest accuracy number.

    python train.py --csv data/samples.csv --holdout ravi
Outputs: model/sanket_mlp.keras and model/labels.json. Then run export_tfjs.py.
For moving signs, replace the MLP with an LSTM / 1D-CNN over 30-frame windows of the same vectors.
"""
import argparse
import json
import os

import numpy as np
import pandas as pd
import tensorflow as tf

p = argparse.ArgumentParser()
p.add_argument("--csv", default="data/samples.csv")
p.add_argument("--holdout", default="", help="signer name kept entirely out of training")
p.add_argument("--epochs", type=int, default=40)
args = p.parse_args()

df = pd.read_csv(args.csv)
feat = [c for c in df.columns if c.startswith("f")]
labels = sorted(df["label"].unique())
idx = {l: i for i, l in enumerate(labels)}
test = df[df["signer"] == args.holdout] if args.holdout else df.iloc[0:0]
train = df[df["signer"] != args.holdout] if args.holdout else df
X, y = train[feat].values.astype("float32"), train["label"].map(idx).values

model = tf.keras.Sequential([
    tf.keras.layers.Input((len(feat),)),
    tf.keras.layers.Dense(128, activation="relu"), tf.keras.layers.Dropout(0.3),
    tf.keras.layers.Dense(64, activation="relu"),
    tf.keras.layers.Dense(len(labels), activation="softmax"),
])
model.compile("adam", "sparse_categorical_crossentropy", metrics=["accuracy"])
model.fit(X, y, epochs=args.epochs, batch_size=32, validation_split=0.15, verbose=2)

if len(test):
    _, acc = model.evaluate(test[feat].values.astype("float32"), test["label"].map(idx).values, verbose=0)
    print(f"Accuracy on UNSEEN signer '{args.holdout}': {acc:.3f}   <- the number for your last slide")

os.makedirs("model", exist_ok=True)
model.save("model/sanket_mlp.keras")
json.dump(labels, open("model/labels.json", "w"))
