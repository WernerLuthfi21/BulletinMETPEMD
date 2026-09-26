#!/usr/bin/env python3
"""
Regenerates assets/audio/tracks.json from whatever audio files are sitting
in assets/audio/. Drop a new .mp3/.m4a/.ogg/.wav in that folder, run this
(or let the GitHub Action run it on push), and it shows up in the site's
music picker automatically -- no code edits needed.

Filename -> id:   the filename stem, as-is (used for the localStorage key
                   and as a stable React-free "key" for the picker option).
Filename -> label: stem with -/_ turned into spaces, then title-cased with
                   a couple of small-word rules so "dj-mabur-duwur" reads
                   as "DJ Mabur Duwur" instead of "Dj Mabur Duwur".
"""
import json
import os
import sys

AUDIO_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "audio")
MANIFEST_PATH = os.path.join(AUDIO_DIR, "tracks.json")
EXTENSIONS = (".mp3", ".m4a", ".ogg", ".wav")

UPPER_WORDS = {"dj", "mc", "tv", "id", "ep"}
LOWER_WORDS = {"x", "ft", "feat", "vs", "the", "of", "and",
               "di", "ke", "dari", "dan", "yang", "atau", "ini"}


def label_from_stem(stem: str) -> str:
    words = [w for w in stem.replace("_", " ").replace("-", " ").split(" ") if w]
    out = []
    for i, w in enumerate(words):
        lw = w.lower()
        if lw in UPPER_WORDS:
            out.append(w.upper())
        elif lw in LOWER_WORDS and i != 0:
            out.append(lw)
        else:
            out.append(lw[:1].upper() + lw[1:])
    return " ".join(out)


def main() -> int:
    if not os.path.isdir(AUDIO_DIR):
        print(f"No audio folder at {AUDIO_DIR}", file=sys.stderr)
        return 1

    files = sorted(
        f for f in os.listdir(AUDIO_DIR)
        if f.lower().endswith(EXTENSIONS)
    )

    tracks = []
    for fname in files:
        stem = os.path.splitext(fname)[0]
        tracks.append({
            "id": stem,
            "label": label_from_stem(stem),
            "src": f"assets/audio/{fname}",
        })

    with open(MANIFEST_PATH, "w", encoding="utf-8") as fh:
        json.dump(tracks, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(f"Wrote {len(tracks)} track(s) to {MANIFEST_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
