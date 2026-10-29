import hashlib
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(shutil.which("gcc"), "Linux package smoke requires gcc")
class PackageInstallerTests(unittest.TestCase):
    def test_ubuntu_package_uses_current_assets_and_excludes_retired_demo_files(self):
        with tempfile.TemporaryDirectory(dir=ROOT / ".local/yaplix-release-007f") as temporary:
            work = Path(temporary)
            payload = work / "payload"
            payload.mkdir()
            retired = {
                "assets/demo.html": b"obsolete demo page",
                "assets/games/demo.html": b"obsolete game gallery",
                "assets/visual-library/demo.html": b"obsolete visual gallery",
                "src/demo.ts": b"obsolete demo route",
                "src/gallery.ts": b"obsolete gallery route",
            }
            entries = {}
            for name, contents in {"assets/index.html": b"obsolete homepage", **retired}.items():
                path = payload / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(contents)
                entries[name] = hashlib.sha256(contents).hexdigest()
            (payload / "integrity.json").write_text(json.dumps(entries), encoding="utf-8")

            output = work / "packages"
            result = subprocess.run(
                [sys.executable, "scripts/package-installer.py", "--payload", str(payload),
                 "--mode", "lite", "--output", str(output)],
                cwd=ROOT, capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            evidence = json.loads(result.stdout)
            artifact = Path(evidence["artifact"])
            data = artifact.read_bytes()
            archive_offset = data.index(b"\xfd7zXZ\x00")
            with tarfile.open(fileobj=BytesIO(data[archive_offset:]), mode="r:xz") as archive:
                names = set(archive.getnames())
                self.assertIn("payload/assets/index.html", names)
                self.assertEqual(
                    archive.extractfile("payload/assets/index.html").read(),
                    (ROOT / "assets/index.html").read_bytes(),
                )
                for current_source in [
                    "payload/src/model-catalog.ts",
                    "payload/build/src/model-catalog.js",
                    "payload/build/src/server.js",
                    "payload/build/public/ui.js",
                ]:
                    self.assertIn(current_source, names)
                for name in retired:
                    self.assertNotIn("payload/" + name, names)


if __name__ == "__main__":
    unittest.main()
