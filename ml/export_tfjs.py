"""Convert the trained Keras model to TensorFlow.js and drop it into the extension.

    python export_tfjs.py
Then load it in the browser with tf.loadLayersModel('model/model.json') and plug it in through
SanketCore's classifier.setModel(vec => [{label, conf}, ...]) (see extension/lib/core.js).
"""
import subprocess
import sys

OUT = "../extension/model"
subprocess.check_call([sys.executable, "-m", "tensorflowjs.converters.converter", "--input_format=keras",
                       "model/sanket_mlp.keras", OUT])
subprocess.check_call(["cp", "model/labels.json", f"{OUT}/labels.json"])
print("Exported to", OUT)
