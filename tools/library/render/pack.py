"""Pack the rendered clips into public/library/ (ART.md): MP4 per sound, a poster, manifest.json, CREDITS.md, sheet.png.

  python3 tools/library/render/pack.py RENDER_ROOT [--ids marimba,snare]

RENDER_ROOT/<id>/frames/0000.png... and RENDER_ROOT/<id>/info.json come from scene.py (--frames all). The sound is
assets-src/audio/<id>.wav, its credits assets-src/audio/credits.json. The manifest keeps entries that are not
from this pack (loops, videos) and replaces this pack's. Needs ffmpeg and Pillow.
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
LIB = os.path.join(REPO, "public", "library")
AUDIO = os.path.join(REPO, "assets-src", "audio")
ART = {"made": "3D render, procedural Blender (tools/library/render/scene.py)", "by": "Bar Builds"}


def run(cmd):
    subprocess.run(cmd, check=True)


def mux(frames, wav, mp4):
    """ART.md's command, plus a BT.709 matrix for the RGB->YUV step (swscale defaults to BT.601) and setparams,
    without which ffmpeg 8 wrote colorspace but left primaries and transfer unknown."""
    run(["ffmpeg", "-v", "error", "-y", "-framerate", "30", "-i", os.path.join(frames, "%04d.png"), "-i", wav,
         "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,"
                "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-color_primaries", "bt709", "-color_trc", "bt709",
         "-colorspace", "bt709", "-color_range", "tv", "-c:a", "aac", "-b:a", "192k", "-shortest",
         "-movflags", "+faststart", mp4])


def poster(png, jpg):
    run(["ffmpeg", "-v", "error", "-y", "-i", png, "-q:v", "3", jpg])


def sheet(ids, out, cols=6, w=320):
    from PIL import Image, ImageDraw
    ims = [Image.open(os.path.join(LIB, f"{i}.jpg")).convert("RGB") for i in ids]
    h = round(w * ims[0].height / ims[0].width)
    rows, pad, lab = -(-len(ims) // cols), 8, 18
    S = Image.new("RGB", (cols * (w + pad) + pad, rows * (h + lab + pad) + pad), "#ECE8DE")
    d = ImageDraw.Draw(S)
    for k, (i, im) in enumerate(zip(ids, ims)):
        r, c = divmod(k, cols)
        x, y = pad + c * (w + pad), pad + r * (h + lab + pad)
        S.paste(im.resize((w, h), Image.LANCZOS), (x, y))
        d.text((x + 2, y + h + 3), i, fill="#2B2B30")
    S.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--ids", default="")
    a = ap.parse_args()
    pack = json.load(open(os.path.join(REPO, "tools", "library", "pack.json")))["sounds"]
    cred = {c["id"]: c for c in json.load(open(os.path.join(AUDIO, "credits.json")))}
    want = [s["id"] for s in pack] if not a.ids else a.ids.split(",")
    os.makedirs(LIB, exist_ok=True)
    done = []
    for sid in want:
        d = os.path.join(a.root, sid)
        if not os.path.isdir(os.path.join(d, "frames")): print(f"skip {sid}: no frames"); continue
        info = json.load(open(os.path.join(d, "info.json")))
        n = len([f for f in os.listdir(os.path.join(d, "frames")) if f.endswith(".png")])
        if n != info["frames"]: print(f"skip {sid}: {n} of {info['frames']} frames"); continue
        mux(os.path.join(d, "frames"), os.path.join(AUDIO, sid + ".wav"), os.path.join(LIB, sid + ".mp4"))
        poster(os.path.join(d, "frames", f"{min(info['peak'], n - 1):04d}.png"), os.path.join(LIB, sid + ".jpg"))
        done.append(sid)
        print(f"ok   {sid}  {os.path.getsize(os.path.join(LIB, sid + '.mp4')) // 1024} KB")
    # manifest: every pack sound that has a clip on disk, plus whatever else was there
    path = os.path.join(LIB, "manifest.json")
    old = json.load(open(path)) if os.path.exists(path) else {}
    old_items = old if isinstance(old, list) else old.get("items", [])
    ids = {s["id"] for s in pack}
    items = []
    for s in pack:
        if not os.path.exists(os.path.join(LIB, s["id"] + ".mp4")): continue
        c = cred[s["id"]]
        items.append({"id": s["id"], "name": s["name"], "kind": s["kind"], "file": s["id"] + ".mp4",
                      "poster": s["id"] + ".jpg", "duration": c["duration"],
                      "credits": {"license": "CC0-1.0", "author": "VCSL contributors", "url": c["url"], "source": c["path"],
                                  "repo": "https://github.com/sgossner/VCSL"},
                      "art": ART})
    items += [i for i in old_items if i.get("id") not in ids]
    json.dump({"about": "The bundled pack (ADR 0770): CC0 recordings from VCSL, each with a 3D-rendered clip made for it.",
               "items": items}, open(path, "w"), indent=1)
    lines = ["# Library credits", "",
             "The bundled sounds are recordings from the **Versilian Community Sample Library (VCSL)**",
             "(https://github.com/sgossner/VCSL), released under **CC0-1.0** (public domain dedication) by the VCSL",
             "contributors. Each sound was trimmed to its first note and levelled. Their pictures are 3D renders made for",
             "this app by Bar Builds (procedural Blender, `tools/library/render/scene.py`).", "",
             "| Sound | Kind | Source file in VCSL | Licence |", "|---|---|---|---|"]
    for it in items:
        if it["id"] not in ids: continue
        lines.append(f"| {it['name']} | {it['kind']} | [{it['credits']['source']}]({it['credits']['url']}) | CC0-1.0 |")
    open(os.path.join(LIB, "CREDITS.md"), "w").write("\n".join(lines) + "\n")
    have = [s["id"] for s in pack if os.path.exists(os.path.join(LIB, s["id"] + ".jpg"))]
    if have: sheet(have, os.path.join(HERE, "sheet.png"))
    total = sum(os.path.getsize(os.path.join(LIB, f)) for f in os.listdir(LIB))
    print(f"{len(items)} items in the manifest, {len(have)} posters, public/library = {total / 1e6:.1f} MB")


if __name__ == "__main__":
    sys.exit(main())
