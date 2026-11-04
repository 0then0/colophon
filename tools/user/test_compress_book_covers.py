"""Tests for compress-book-covers.py. They work in temporary folders only.

uv run --group covers python -m unittest discover -s tools -p "test_*.py"
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import tempfile
import unittest
from pathlib import Path

from PIL import Image

SCRIPT = Path(__file__).with_name("compress-book-covers.py")
spec = importlib.util.spec_from_file_location("compress_book_covers", SCRIPT)
covers_tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(covers_tool)

ORIENTATION_TAG = 0x0112


def make_jpeg(path: Path, width: int, height: int, mode: str = "RGB", orientation: int = 0) -> None:
    """Noise compresses badly, so the file is big enough to shrink."""
    channels = len(Image.new(mode, (1, 1)).getbands())
    img = Image.frombytes(mode, (width, height), os.urandom(width * height * channels))
    exif = Image.Exif()
    if orientation:
        exif[ORIENTATION_TAG] = orientation
    img.save(path, "JPEG", quality=95, exif=exif)


def size_of(path: Path) -> tuple[int, int]:
    with Image.open(path) as img:
        return img.size


def run(*argv: str) -> tuple[int, str]:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = covers_tool.main(list(argv))
    return code, out.getvalue()


class CompressCoversTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        root = Path(self._tmp.name)
        self.covers = root / "covers"
        self.originals = root / "originals"
        self.covers.mkdir()
        self.big = self.covers / "big.jpg"
        self.small = self.covers / "small.jpg"
        make_jpeg(self.big, 1600, 2400)
        make_jpeg(self.small, 400, 600)

    def test_dry_run_changes_nothing(self):
        big_before, small_before = self.big.read_bytes(), self.small.read_bytes()
        code, output = run(str(self.covers))
        self.assertEqual(code, 0)
        self.assertIn("Dry run", output)
        self.assertIn("shrunk 1", output)
        self.assertEqual(self.big.read_bytes(), big_before)
        self.assertEqual(self.small.read_bytes(), small_before)
        self.assertFalse(self.originals.exists())
        self.assertEqual(sorted(p.name for p in self.covers.iterdir()), ["big.jpg", "small.jpg"])

    def test_apply_shrinks_big_file_and_keeps_original(self):
        original = self.big.read_bytes()
        small_before = self.small.read_bytes()
        code, _ = run(str(self.covers), "--apply", "--originals", str(self.originals))
        self.assertEqual(code, 0)
        self.assertEqual((self.originals / "big.jpg").read_bytes(), original)
        self.assertLess(self.big.stat().st_size, len(original))
        self.assertEqual(size_of(self.big), (800, 1200))
        self.assertEqual(self.small.read_bytes(), small_before)
        self.assertFalse((self.originals / "small.jpg").exists())
        self.assertEqual(sorted(p.name for p in self.covers.iterdir()), ["big.jpg", "small.jpg"])

    def test_second_run_is_a_no_op_and_keeps_first_original(self):
        original = self.big.read_bytes()
        run(str(self.covers), "--apply", "--originals", str(self.originals))
        shrunk = self.big.read_bytes()
        code, output = run(str(self.covers), "--apply", "--originals", str(self.originals))
        self.assertEqual(code, 0)
        self.assertIn("shrunk 0", output)
        self.assertEqual(self.big.read_bytes(), shrunk)
        self.assertEqual((self.originals / "big.jpg").read_bytes(), original)

    def test_exif_rotation_is_applied_to_the_pixels(self):
        rotated = self.covers / "rotated.jpg"
        make_jpeg(rotated, 2400, 1600, orientation=6)  # displayed as 1600 x 2400
        run(str(self.covers), "--apply", "--originals", str(self.originals))
        self.assertEqual(size_of(rotated), (800, 1200))
        with Image.open(rotated) as img:
            self.assertNotIn(ORIENTATION_TAG, img.getexif())

    def test_cmyk_file_is_reported_and_left_alone(self):
        cmyk = self.covers / "cmyk.jpg"
        make_jpeg(cmyk, 1600, 2400, mode="CMYK")
        before = cmyk.read_bytes()
        code, output = run(str(self.covers), "--apply", "--originals", str(self.originals))
        self.assertEqual(code, 1)
        self.assertIn("cmyk.jpg: colour mode CMYK, skipped", output)
        self.assertEqual(cmyk.read_bytes(), before)

    def test_broken_file_is_reported(self):
        (self.covers / "broken.jpg").write_bytes(b"not an image")
        code, output = run(str(self.covers))
        self.assertEqual(code, 1)
        self.assertIn("broken.jpg: cannot read image", output)

    def test_apply_requires_originals(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
            run(str(self.covers), "--apply")
        self.assertEqual(raised.exception.code, 2)

    def test_originals_inside_covers_folder_is_refused(self):
        inside = self.covers / "originals"
        with contextlib.redirect_stderr(io.StringIO()):
            code, _ = run(str(self.covers), "--apply", "--originals", str(inside))
        self.assertEqual(code, 2)
        self.assertFalse(inside.exists())


if __name__ == "__main__":
    unittest.main()
