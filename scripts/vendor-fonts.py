"""Vendor the two requested web fonts. Not needed for npm install/build.

Maintenance: python -m pip install fonttools brotli requests
             python scripts/vendor-fonts.py
"""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import json

import requests
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "public" / "fonts"
GOOGLE_REVISION = "66928797f271fed5ee428544e7229685e2d90127"
MOZILLA_REVISION = "c0460fdb2654dee584e75c4913bfa9fd2f873338"
SOURCES = {
    "TwemojiMozilla.woff2": "https://github.com/mozilla/twemoji-colr/releases/download/v0.7.0/Twemoji.Mozilla.ttf",
    "GoogleSans.woff2": f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_REVISION}/ofl/googlesans/GoogleSans%5BGRAD%2Copsz%2Cwght%5D.ttf",
    "GoogleSans-Italic.woff2": f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_REVISION}/ofl/googlesans/GoogleSans-Italic%5BGRAD%2Copsz%2Cwght%5D.ttf",
}
LICENSES = {
    "TwemojiMozilla-LICENSE.md": f"https://raw.githubusercontent.com/mozilla/twemoji-colr/{MOZILLA_REVISION}/LICENSE.md",
    "GoogleSans-OFL.txt": f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_REVISION}/ofl/googlesans/OFL.txt",
    "GoogleSans-TRADEMARKS.md": f"https://raw.githubusercontent.com/google/fonts/{GOOGLE_REVISION}/ofl/googlesans/TRADEMARKS.md",
}


def fetch(item):
    name, url = item
    response = requests.get(url, timeout=(15, 60))
    response.raise_for_status()
    return name, response.content


def unicode_ranges(points):
    # Avoid taking ordinary ASCII digits/punctuation away from the text font.
    points = sorted(point for point in points if point >= 0x80)
    intervals = []
    for point in points:
        if intervals and point == intervals[-1][1] + 1:
            intervals[-1][1] = point
        else:
            intervals.append([point, point])
    return ",".join(f"U+{first:X}" if first == last else f"U+{first:X}-{last:X}"
                    for first, last in intervals)


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "licenses").mkdir(exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        downloads = dict(pool.map(fetch, {**SOURCES, **LICENSES}.items()))
    manifest = {"googleFontsRevision": GOOGLE_REVISION, "twemojiVersion": "v0.7.0", "fonts": []}
    emoji_range = ""
    for filename, url in SOURCES.items():
        original = downloads[filename]
        font = TTFont(BytesIO(original), recalcTimestamp=False)
        if filename.startswith("Twemoji"):
            if "COLR" not in font or "CPAL" not in font:
                raise ValueError("Twemoji font must preserve its color tables")
            emoji_range = unicode_ranges(font.getBestCmap())
        else:
            axis = next(axis for axis in font["fvar"].axes if axis.axisTag == "wght")
            if axis.minValue > 400 or axis.maxValue < 700:
                raise ValueError("Google Sans must cover weights 400–700")
        font.flavor = "woff2"
        font.save(DEST / filename)
        binary = (DEST / filename).read_bytes()
        record = {
            "file": filename, "source": url, "sourceSha256": sha256(original).hexdigest(),
            "sha256": sha256(binary).hexdigest(), "size": len(binary),
            "family": font["name"].getDebugName(16) or font["name"].getDebugName(1),
            "glyphs": len(font.getBestCmap()),
        }
        manifest["fonts"].append(record)
        print(f"{filename}: {len(binary):,} bytes, {record['family']}", flush=True)
    for filename in LICENSES:
        (DEST / "licenses" / filename).write_bytes(downloads[filename])
    (DEST / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    css = f"""/* Local font files; original licenses and source hashes are in /fonts/. */
@font-face {{
  font-family: 'Twemoji Mozilla';
  src: local('Twemoji Mozilla'), url('/fonts/TwemojiMozilla.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  unicode-range: {emoji_range};
}}
@font-face {{
  font-family: 'Google Sans';
  src: local('Google Sans'), url('/fonts/GoogleSans.woff2') format('woff2');
  font-weight: 400 700;
  font-style: normal;
  font-display: swap;
}}
@font-face {{
  font-family: 'Google Sans';
  src: local('Google Sans Italic'), url('/fonts/GoogleSans-Italic.woff2') format('woff2');
  font-weight: 400 700;
  font-style: italic;
  font-display: swap;
}}
"""
    (ROOT / "src" / "fonts.css").write_text(css, encoding="utf-8")


if __name__ == "__main__":
    main()
