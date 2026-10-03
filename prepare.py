#!/usr/bin/env python3
"""Fetch immutable source archives and check their hashes before compilation."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
lock = json.loads((ROOT / "versions.json").read_text())
(ROOT / "sources").mkdir(exist_ok=True)
for name, source in lock["sources"].items():
    dest = ROOT / "sources" / (name + ".tar.gz")
    if not dest.exists():
        partial = dest.with_suffix(".download")
        subprocess.run(["curl", "--fail", "--location", "--retry", "3", "--output", str(partial), source["url"]], check=True)
        partial.rename(dest)
    actual = hashlib.sha256(dest.read_bytes()).hexdigest()
    if actual != source["sha256"]:
        raise SystemExit(f"Hash mismatch: {dest}; expected {source['sha256']}, got {actual}")
    print(f"Verified {name} {source['version']}: {actual}")
