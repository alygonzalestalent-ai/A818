#!/usr/bin/env python3
"""Speech-to-text with word timings (Whisper). Usage: transcribe.py <media> <out.json> [model]

Uses the local model in .models/whisper-small when present (see scripts/setup.sh),
otherwise lets faster-whisper download the named model.
"""
import json, os, subprocess, sys
import numpy as np
from faster_whisper import WhisperModel

media, out = sys.argv[1], sys.argv[2]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
local = os.path.join(root, ".models", "whisper-small")
model_name = sys.argv[3] if len(sys.argv) > 3 else (local if os.path.exists(os.path.join(local, "model.bin")) else "small")

pcm = subprocess.run(
    ["ffmpeg", "-v", "error", "-i", media, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
    check=True, capture_output=True,
).stdout
audio = np.frombuffer(pcm, dtype=np.float32)

model = WhisperModel(model_name, device="cpu", compute_type="int8")
segments, info = model.transcribe(audio, word_timestamps=True, vad_filter=False, condition_on_previous_text=False)
words, segs = [], []
for s in segments:
    segs.append({"s": round(s.start, 3), "e": round(s.end, 3), "text": s.text.strip()})
    for w in s.words or []:
        words.append({"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3)})

os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
with open(out, "w") as f:
    json.dump({"language": info.language, "duration": round(len(audio) / 16000, 3), "segments": segs, "words": words}, f, indent=1)
print(f"{len(words)} words, {len(segs)} segments -> {out}")
