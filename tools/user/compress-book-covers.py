#!/usr/bin/env python3
"""Shrink oversized JPEG book covers.

    uv run --group covers tools/user/compress-book-covers.py COVERS_DIR  # dry run, changes nothing
    uv run --group covers tools/user/compress-book-covers.py COVERS_DIR --apply \
        --originals BACKUP_DIR

Without uv, install Pillow (`pip install pillow`) and run the script with Python directly.

By default the script only measures: every candidate is re-encoded into a temporary folder
that is deleted at the end, and the expected saving is printed. With --apply each shrunk file
replaces the original in COVERS_DIR (same name), and the untouched original is first copied to
BACKUP_DIR. An existing backup is never overwritten, so a second run keeps the first original.

Files that already fit in --max-width x --max-height are left alone, so running the script again
is safe. Only .jpg and .jpeg files are handled, which keeps every file name (and every link in
your notes) unchanged. The EXIF orientation is applied to the pixels and the EXIF block is
dropped; an embedded ICC colour profile is kept. Works on macOS, Linux and Windows.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover - depends on the environment
    sys.exit(
        "error: Pillow is not installed. Run the script with "
        "`uv run --group covers tools/user/compress-book-covers.py ...` or `pip install pillow`."
    )

EXTENSIONS = {".jpg", ".jpeg"}
MODES = {"RGB", "L"}  # CMYK and other modes are skipped rather than converted
ORIENTATION_TAG = 0x0112
MB = 1024 * 1024


def display_size(img: Image.Image) -> tuple[int, int]:
    """Size as a viewer shows it: EXIF orientations 5 to 8 swap the sides."""
    width, height = img.size
    if img.getexif().get(ORIENTATION_TAG, 1) in (5, 6, 7, 8):
        return height, width
    return width, height


def shrink(src: Path, dst: Path, max_w: int, max_h: int, quality: int) -> tuple[int, int]:
    """Write a shrunk copy of src to dst and return its size."""
    with Image.open(src) as img:
        icc = img.info.get("icc_profile")
        img = ImageOps.exif_transpose(img)
        img.thumbnail((max_w, max_h), Image.Resampling.LANCZOS)  # keeps the ratio, never enlarges
        img.save(dst, "JPEG", quality=quality, optimize=True, icc_profile=icc)
        return img.size


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Shrink oversized JPEG book covers.")
    parser.add_argument("covers", type=Path, help="folder with the cover images")
    parser.add_argument(
        "--apply", action="store_true", help="replace files (default: only measure, change nothing)"
    )
    parser.add_argument(
        "--originals",
        type=Path,
        help="folder that receives a copy of each original before it is replaced (with --apply)",
    )
    parser.add_argument("--max-width", type=int, default=800, help="default: %(default)s px")
    parser.add_argument("--max-height", type=int, default=1200, help="default: %(default)s px")
    parser.add_argument(
        "--quality",
        type=int,
        default=88,
        choices=range(1, 96),
        metavar="1-95",
        help="JPEG quality, higher is better and larger (default: %(default)s)",
    )
    args = parser.parse_args(argv)
    if args.apply and args.originals is None:
        parser.error("--apply needs --originals so that the original files are kept")
    if args.originals is not None and not args.apply:
        parser.error("--originals only makes sense together with --apply")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")

    covers = args.covers.resolve()
    if not covers.is_dir():
        print(f"error: {args.covers} is not a folder", file=sys.stderr)
        return 2
    originals = args.originals.resolve() if args.originals else None
    if originals is not None and (originals == covers or covers in originals.parents):
        print("error: --originals must be a folder outside the covers folder", file=sys.stderr)
        return 2

    before = after = changed = small = bigger = 0
    problems: list[str] = []
    with tempfile.TemporaryDirectory(prefix="covers-") as tmp_name:
        tmp = Path(tmp_name)
        for path in sorted(covers.iterdir()):
            if not path.is_file() or path.suffix.lower() not in EXTENSIONS:
                continue
            size = path.stat().st_size
            before += size
            after += size  # counted as unchanged until the file proves smaller
            try:
                with Image.open(path) as img:
                    width, height = display_size(img)
                    mode = img.mode
            except (OSError, ValueError, Image.DecompressionBombError) as err:
                problems.append(f"{path.name}: cannot read image ({err})")
                continue
            if width <= args.max_width and height <= args.max_height:
                small += 1
                continue
            if mode not in MODES:
                problems.append(f"{path.name}: colour mode {mode}, skipped")
                continue
            out = tmp / path.name
            try:
                new_width, new_height = shrink(
                    path, out, args.max_width, args.max_height, args.quality
                )
            except (OSError, ValueError, Image.DecompressionBombError) as err:
                problems.append(f"{path.name}: could not re-encode ({err})")
                continue
            if new_width > args.max_width or new_height > args.max_height:
                problems.append(f"{path.name}: unexpected result {new_width}x{new_height}")
                continue
            new_size = out.stat().st_size
            if new_size >= size:
                bigger += 1
                continue
            after += new_size - size
            changed += 1
            if args.apply:
                assert originals is not None
                originals.mkdir(parents=True, exist_ok=True)
                backup = originals / path.name
                if not backup.exists():
                    shutil.copy2(path, backup)
                staging = path.with_name(path.name + ".tmp-cover")
                shutil.copyfile(out, staging)
                staging.replace(path)

    mode_text = "Applied" if args.apply else "Dry run (nothing was changed)"
    print(f"{mode_text}: shrunk {changed}, already small {small}, no gain {bigger}")
    print(f"Before {before / MB:.2f} MB, after {after / MB:.2f} MB")
    if originals is not None and changed:
        print(f"Originals saved in {originals}")
    for line in problems:
        print(f"problem: {line}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
