from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path

from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont


def glyph_signature(font: TTFont, glyph_name: str) -> str:
    glyph_set = font.getGlyphSet()
    pen = RecordingPen()
    glyph_set[glyph_name].draw(pen)
    payload = json.dumps(
        {
            "width": glyph_set[glyph_name].width,
            "commands": pen.value,
        },
        ensure_ascii=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("ascii")).hexdigest()


def codepoint_priority(codepoint: int) -> tuple[int, int]:
    if 0x4E00 <= codepoint <= 0x9FFF:
        return (0, codepoint)
    if 0x3400 <= codepoint <= 0x4DBF:
        return (1, codepoint)
    if codepoint <= 0xFFFF:
        return (2, codepoint)
    return (3, codepoint)


def build_mapping(
    subset_path: Path, source_path: Path, source_index: int = 0
) -> tuple[dict[str, str], dict]:
    subset = TTFont(subset_path)
    source = TTFont(source_path, fontNumber=source_index)

    source_by_signature: dict[str, list[int]] = defaultdict(list)
    for codepoint, glyph_name in source.getBestCmap().items():
        source_by_signature[glyph_signature(source, glyph_name)].append(codepoint)

    mapping: dict[str, str] = {}
    missing: list[str] = []
    ambiguous: dict[str, list[str]] = {}

    for codepoint, glyph_name in subset.getBestCmap().items():
        matches = source_by_signature.get(glyph_signature(subset, glyph_name), [])
        key = f"{codepoint:04X}"
        if not matches:
            missing.append(key)
            continue
        ordered = sorted(set(matches), key=codepoint_priority)
        mapping[key] = chr(ordered[0])
        if len(ordered) > 1:
            ambiguous[key] = [f"U+{match:04X} {chr(match)}" for match in ordered]

    report = {
        "subset_entries": len(subset.getBestCmap()),
        "mapped_entries": len(mapping),
        "missing_entries": missing,
        "ambiguous_entries": ambiguous,
        "subset_family": [
            name.toUnicode()
            for name in subset["name"].names
            if name.nameID in {1, 2, 5}
        ],
        "source_family": [
            name.toUnicode()
            for name in source["name"].names
            if name.nameID in {1, 2, 5}
        ],
    }
    return mapping, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("subset", type=Path)
    parser.add_argument("source", type=Path)
    parser.add_argument("--source-index", type=int, default=0)
    parser.add_argument("--mapping-out", type=Path)
    parser.add_argument("--report-out", type=Path)
    args = parser.parse_args()

    mapping, report = build_mapping(args.subset, args.source, args.source_index)
    mapping_json = json.dumps(mapping, ensure_ascii=False, sort_keys=True, indent=2)
    report_json = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2)

    if args.mapping_out:
        args.mapping_out.parent.mkdir(parents=True, exist_ok=True)
        args.mapping_out.write_text(mapping_json + "\n", encoding="utf-8")
    if args.report_out:
        args.report_out.parent.mkdir(parents=True, exist_ok=True)
        args.report_out.write_text(report_json + "\n", encoding="utf-8")

    print(report_json)


if __name__ == "__main__":
    main()
