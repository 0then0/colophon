#!/usr/bin/env python3
"""Generate the neutral placeholder covers used by example-vault.

The covers are abstract shapes drawn from scratch, with no text and no third-party artwork, so
they can be published under the repository licence. Output is deterministic.

    python3 tools/dev/generate-demo-covers.py [output_dir]
"""

from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

WIDTH, HEIGHT = 400, 600

# slug -> (background, shape, accent, pattern)
COVERS = {
    "pride-and-prejudice": ((236, 222, 214), (178, 98, 110), (84, 52, 62), "circle"),
    "a-study-in-scarlet": ((60, 36, 42), (168, 52, 52), (232, 214, 190), "bands"),
    "the-sign-of-the-four": ((38, 52, 70), (86, 128, 168), (230, 224, 206), "squares"),
    "the-hound-of-the-baskervilles": ((44, 58, 52), (104, 134, 96), (222, 226, 206), "diagonal"),
    "meditations": ((226, 224, 214), (110, 122, 132), (52, 60, 70), "squares"),
    "walden": ((214, 228, 214), (74, 122, 90), (36, 66, 52), "bands"),
    "moby-dick": ((24, 44, 72), (62, 112, 156), (214, 226, 232), "circle"),
    "around-the-world-in-eighty-days": ((232, 214, 168), (196, 128, 52), (88, 52, 28), "diagonal"),
    "dracula": ((30, 24, 30), (122, 24, 40), (214, 198, 190), "dots"),
    "the-time-machine": ((28, 34, 56), (112, 98, 176), (226, 214, 150), "dots"),
}


def pixel(pattern, x, y, bg, shape, accent):
    nx, ny = x / WIDTH, y / HEIGHT
    if pattern == "circle":
        d = ((nx - 0.5) ** 2 + (ny - 0.42) ** 2) ** 0.5
        if d < 0.16:
            return accent
        if d < 0.30:
            return shape
    elif pattern == "bands":
        if 0.58 < ny < 0.66:
            return accent
        if 0.18 < ny < 0.54 and (int(nx * 10) % 2 == 0):
            return shape
    elif pattern == "squares":
        edge = max(abs(nx - 0.5), abs(ny - 0.4))
        if edge < 0.10:
            return accent
        if edge < 0.30 and int(edge * 40) % 2 == 0:
            return shape
    elif pattern == "diagonal":
        if ny < 0.62 and (nx + ny) % 0.25 < 0.08:
            return shape
        if 0.72 < ny < 0.76:
            return accent
    elif pattern == "dots":
        gx, gy = (nx * 8) % 1, (ny * 12) % 1
        if ((gx - 0.5) ** 2 + (gy - 0.5) ** 2) ** 0.5 < 0.22 and ny < 0.72:
            return shape if int(nx * 8 + ny * 12) % 3 else accent
    return bg


def png(rows):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + bytes(row) for row in rows)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "example-vault/Books/covers")
    out.mkdir(parents=True, exist_ok=True)
    for slug, (bg, shape, accent, pattern) in COVERS.items():
        rows = []
        for y in range(HEIGHT):
            row = bytearray()
            for x in range(WIDTH):
                row.extend(pixel(pattern, x, y, bg, shape, accent))
            rows.append(row)
        (out / f"{slug}.png").write_bytes(png(rows))
        print(f"wrote {out / (slug + '.png')}")


if __name__ == "__main__":
    main()
