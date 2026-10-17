"""Offline NL-000 integrity checks; no generator imports or network calls."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCES = {"EXPLICIT", "INFERRED", "DEFAULT", "UNKNOWN"}
FEATURES = {"genre", "audience", "mechanics", "numeric_conditions", "input_status", "platform_controls"}

def normalized(text):
    return " ".join(text.casefold().replace("ё", "е").split())

def main():
    groups = []
    for name, count, prefix in [("dev-prompts.json", 5, "DEV-"), ("held-out-prompts.json", 3, "HOLD-"), ("intent-corpus.json", 40, "INT-")]:
        raw = (ROOT / name).read_bytes()
        assert b"\r" not in raw and raw.endswith(b"\n"), name
        data = json.loads(raw.decode("utf-8"))
        assert isinstance(data, list) and len(data) == count, name
        assert len({r["id"] for r in data}) == count, name
        for row in data:
            assert row["id"].startswith(prefix) and isinstance(row["text"], str)
            if prefix == "INT-":
                assert set(row["expected"]) == FEATURES
                assert isinstance(row["tags"], list) and row["tags"] and row["notes"]
                for feature in row["expected"].values():
                    assert set(feature) == {"value", "source", "evidence"}
                    assert feature["source"] in SOURCES
                    if feature["source"] == "UNKNOWN":
                        assert feature["value"] is None and feature["evidence"] is None
                    else:
                        assert feature["value"] is not None and feature["evidence"]
            else:
                assert set(row) == {"id", "text", "expected_genre", "expected_audience", "core_mechanics", "explicit_requirements", "verifiable_result"}
                assert row["text"].strip() and len(row["text"]) <= 500
                for field in ["core_mechanics", "explicit_requirements", "verifiable_result"]:
                    assert isinstance(row[field], list) and row[field] and all(isinstance(v, str) and v for v in row[field])
                assert row["expected_genre"] and row["expected_audience"] in {"default", "kids", "elderly", "hardcore", "UNKNOWN"}
        groups.append(data)
    all_rows = sum(groups, [])
    assert len({r["id"] for r in all_rows}) == 48
    assert len({r["text"] for r in all_rows}) == 48, "Duplicate exact phrase"
    texts = [normalized(r["text"]) for r in all_rows if r["text"].strip()]
    assert len(set(texts)) == len(texts), "Duplicate normalized nonblank phrase"
    assert {r["expected_genre"] for r in groups[0]} >= {"arcade", "platformer", "puzzle", "clicker"}
    assert len({r["expected_genre"] for r in groups[1]}) >= 2
    assert {f["source"] for r in groups[2] for f in r["expected"].values()} == SOURCES
    assert {tag for r in groups[2] for tag in r["tags"]} >= {"short", "detailed", "slang", "typo", "ambiguous", "numeric", "incomplete", "contradictory", "invalid", "injection"}
    digest = hashlib.sha256((ROOT / "held-out-prompts.json").read_bytes()).hexdigest()
    readme = ROOT / "README.md"
    if readme.exists():
        expected = re.search(r"HELD_OUT_SHA256: `([0-9a-f]{64})`", readme.read_text(encoding="utf-8"))
        assert expected and expected[1] == digest, "Frozen HELD-OUT hash mismatch"
    print(f"PASS: 5 DEV + 3 HELD-OUT + 40 intents; 48 unique IDs/texts; SHA-256 {digest}")

if __name__ == "__main__":
    main()
