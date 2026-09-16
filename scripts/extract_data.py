#!/usr/bin/env python3
"""Extract searchable NEET-PG allotment ranges from the MCC result PDF.

The source PDF is a fixed-width table produced by iText.  This parser derives
column boundaries from the header on every page, then joins wrapped cell text
before grouping allotments into opening/closing-rank ranges.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path


ROW_START = re.compile(r"^\s*(\d+)\s+(\d+)\s+")
WHITESPACE = re.compile(r"\s+")
SEGMENT = re.compile(r"\S(?:.*?\S)?(?=\s{2,}|$)")
COURSE_START = re.compile(
    r"(?<!\w)(?:M\.D\.|M\.S\.|\(NBEMS(?:-DIPLOMA)?\)|MD/MS|DIPLOMA|"
    r"DIP\.IN|DIP\.|Diploma-Emergency|DIP\b|PG Diploma|M\.P\.H\.|M\.Ch\.)"
)
CATEGORY = r"(?:Open(?: PwD)?|OBC(?: PwD)?|EWS(?: PwD)?|SC(?: PwD)?|ST(?: PwD)?)"
CANDIDATE_CATEGORY = r"(?:General|OBC|EWS|SC|ST)"
TAIL = re.compile(
    rf"\s+({CATEGORY})\s+({CANDIDATE_CATEGORY})\s+(Allotted.*)$"
)
QUOTA_PREFIXES = sorted(
    [
        "Aligarh Muslim University",
        "Banaras Hindu University",
        "Delhi University Quota",
        "DNB Quota",
        "IP University Quota",
        "Jain Minority Quota",
        "Muslim Minority Quota",
        "Non-Resident Indian",
        "Self-Financed Merit",
        "All India",
    ],
    key=len,
    reverse=True,
)

STATE_ALIASES = {
    "Andaman and Nicobar Islands": ["Andaman and Nicobar Islands"],
    "Andhra Pradesh": ["Andhra Pradesh"],
    "Arunachal Pradesh": ["Arunachal Pradesh"],
    "Assam": ["Assam"],
    "Bihar": ["Bihar"],
    "Chandigarh": ["Chandigarh"],
    "Chhattisgarh": ["Chhattisgarh"],
    "Dadra and Nagar Haveli and Daman and Diu": [
        "Dadra and Nagar Haveli and Daman and Diu",
        "Dadra & Nagar Haveli",
        "Daman and Diu",
    ],
    "Delhi (NCT)": ["Delhi (NCT)", "New Delhi", "Delhi,"],
    "Goa": ["Goa"],
    "Gujarat": ["Gujarat"],
    "Haryana": ["Haryana"],
    "Himachal Pradesh": ["Himachal Pradesh"],
    "Jammu and Kashmir": ["Jammu and Kashmir", "Jammu & Kashmir"],
    "Jharkhand": ["Jharkhand"],
    "Karnataka": ["Karnataka"],
    "Kerala": ["Kerala"],
    "Ladakh": ["Ladakh"],
    "Lakshadweep": ["Lakshadweep"],
    "Madhya Pradesh": ["Madhya Pradesh"],
    "Maharashtra": ["Maharashtra"],
    "Manipur": ["Manipur"],
    "Meghalaya": ["Meghalaya"],
    "Mizoram": ["Mizoram"],
    "Nagaland": ["Nagaland"],
    "Odisha": ["Odisha", "Orissa"],
    "Puducherry": ["Puducherry", "Pondicherry"],
    "Punjab": ["Punjab"],
    "Rajasthan": ["Rajasthan"],
    "Sikkim": ["Sikkim"],
    "Tamil Nadu": ["Tamil Nadu"],
    "Telangana": ["Telangana"],
    "Tripura": ["Tripura"],
    "Uttar Pradesh": ["Uttar Pradesh"],
    "Uttarakhand": ["Uttarakhand", "Uttaranchal"],
    "West Bengal": ["West Bengal"],
}


def clean(value: str) -> str:
    return WHITESPACE.sub(" ", value).strip(" ,")


def state_from_institute(value: str) -> str:
    haystack = value.casefold()
    matches: list[tuple[int, int, str]] = []
    for canonical, aliases in STATE_ALIASES.items():
        for alias in aliases:
            index = haystack.rfind(alias.casefold())
            if index >= 0:
                matches.append((index, len(alias), canonical))
    if not matches:
        return "State not identified"
    return max(matches)[2]


def institute_name(value: str) -> str:
    first = clean(value.split(",", 1)[0])
    return first or clean(value)


def spans(line: str) -> list[tuple[str, float]]:
    return [(match.group(), (match.start() + match.end()) / 2) for match in SEGMENT.finditer(line)]


def first_line_cells(line: str) -> tuple[list[str], list[float]] | None:
    pieces = spans(line)
    if len(pieces) == 8 and pieces[0][0].isdigit() and pieces[1][0].isdigit():
        return [part for part, _ in pieces], [center for _, center in pieces]

    start = ROW_START.match(line)
    tail = TAIL.search(line.rstrip())
    if not start or not tail:
        return None

    serial, rank = start.group(1), start.group(2)
    body = line[start.end() : tail.start()].strip()
    quota = next((value for value in QUOTA_PREFIXES if body.startswith(value)), None)
    if not quota:
        return None
    institute_course = body[len(quota) :].strip()
    course_match = COURSE_START.search(institute_course)
    if not course_match:
        return None
    institute = institute_course[: course_match.start()].strip()
    course = institute_course[course_match.start() :].strip()
    values = [serial, rank, quota, institute, course, tail.group(1), tail.group(2), tail.group(3)]

    # Approximate centres from each value's position. These are used only to
    # route wrapped continuation text into the correct cell.
    centers: list[float] = []
    cursor = 0
    for value in values:
        index = line.find(value, cursor)
        if index < 0:
            index = cursor
        centers.append(index + len(value) / 2)
        cursor = index + len(value)
    return values, centers


def parse_record(lines: list[str]) -> dict | None:
    parsed = first_line_cells(lines[0])
    if not parsed:
        return None
    values, centers = parsed
    cells = [[value] if value else [] for value in values]

    for line in lines[1:]:
        if (
            not line.strip()
            or "Page No." in line
            or "NEET-PG Counselling" in line
            or line.lstrip().startswith("SNo")
        ):
            continue
        for value, center in spans(line):
            if value == "PwD":
                column = min((5, 6), key=lambda idx: abs(center - centers[idx]))
            elif "Priority" in value:
                column = 7
            else:
                column = min(range(2, 5), key=lambda idx: abs(center - centers[idx]))
            cells[column].append(value)

    values = [clean(" ".join(parts)) for parts in cells]

    return {
        "serial": int(values[0]),
        "rank": int(values[1]),
        "quota": values[2],
        "institute_raw": values[3],
        "institute": institute_name(values[3]),
        "state": state_from_institute(values[3]),
        "course": values[4],
        "allotted_category": values[5],
        "candidate_category": values[6],
        "remarks": values[7],
    }


def parse_text(text: str) -> list[dict]:
    records: list[dict] = []
    for page in text.split("\f"):
        lines = page.splitlines()
        current: list[str] = []
        for line in lines:
            if ROW_START.match(line):
                if current:
                    record = parse_record(current)
                    if record:
                        records.append(record)
                current = [line]
            elif current:
                current.append(line)
        if current:
            record = parse_record(current)
            if record:
                records.append(record)
    return records


def summarize(records: list[dict]) -> dict:
    grouped: dict[tuple[str, ...], list[dict]] = defaultdict(list)
    for row in records:
        key = (
            row["institute_raw"],
            row["course"],
            row["quota"],
            row["allotted_category"],
        )
        grouped[key].append(row)

    ranges = []
    for rows in grouped.values():
        rows.sort(key=lambda row: row["rank"])
        first = rows[0]
        ranges.append(
            {
                "institute": first["institute"],
                "instituteFull": first["institute_raw"],
                "state": first["state"],
                "course": first["course"],
                "quota": first["quota"],
                "category": first["allotted_category"],
                "candidateCategories": sorted({row["candidate_category"] for row in rows}),
                "openingRank": rows[0]["rank"],
                "closingRank": rows[-1]["rank"],
                "allotments": len(rows),
                "ranks": [row["rank"] for row in rows],
            }
        )

    ranges.sort(key=lambda row: (row["closingRank"], row["openingRank"], row["institute"]))
    states = sorted({row["state"] for row in ranges})
    courses = sorted({row["course"] for row in ranges})
    quotas = sorted({row["quota"] for row in ranges})
    categories = sorted({row["category"] for row in ranges})
    return {
        "meta": {
            "title": "NEET-PG Counselling Seats Allotment",
            "sourceRows": len(records),
            "rangeRows": len(ranges),
            "states": states,
            "courses": courses,
            "quotas": quotas,
            "categories": categories,
        },
        "ranges": ranges,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    if args.pdf.suffix.casefold() == ".txt":
        source_text = args.pdf.read_text(encoding="utf-8", errors="replace")
    else:
        completed = subprocess.run(
            ["pdftotext", "-layout", str(args.pdf), "-"],
            check=True,
            capture_output=True,
            text=True,
        )
        source_text = completed.stdout
    records = parse_text(source_text)
    if not records:
        raise SystemExit("No allotment rows were parsed")

    serials = [row["serial"] for row in records]
    if len(serials) != len(set(serials)):
        raise SystemExit("Duplicate serial numbers detected")

    payload = summarize(records)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(payload["meta"], indent=2))


if __name__ == "__main__":
    main()
