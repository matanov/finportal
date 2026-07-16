#!/usr/bin/env python3
"""
opm-convert.py

Converts an OPM-published General Schedule pay table (an Excel workbook,
.xlsx/.xls, downloaded from OPM's pay & leave site) into the JSON shape
build-pay-lookup.mjs expects in src/data/pay-scales/. This is the missing
first step in the "GS Pay Scales" update process documented in the
project README: OPM publishes each year's rates as Excel, not JSON, and
this script is the one-time manual conversion between "download the
year's file from OPM" and "drop the JSON into src/data/pay-scales/".

Usage:
    python3 scripts/opm-convert.py paytable.xlsx
    python3 scripts/opm-convert.py paytable.xlsx output.json

Requires pandas and an Excel engine: pip install pandas openpyxl

Output shape:
    { "<worksheet name>": [
        { "location": "AK", "grade": 1, "steps": [{"step": 1, "annual": 29892}, ...] },
        ...
    ] }

Only the FIRST worksheet's data ends up used — build-pay-lookup.mjs reads
Object.keys(raw)[0] and ignores any other top-level keys. OPM's published
file has only ever had the one relevant sheet ("ALL_GS") in practice, but
if that ever changes, either re-export just the sheet that matters or
merge the sheets before dropping the JSON in.

After conversion:
    1. Rename/move the output to
       src/data/pay-scales/YYYY-general-schedule-pay-rates.json
       (the leading year is how build-pay-lookup.mjs discovers new years).
    2. Run `npm run generate:pay` (or just `npm run build`, which runs it
       automatically) to regenerate public/pay-scales/.
"""

import json
import sys
from pathlib import Path

import pandas as pd


def clean_number(value):
    """Convert Excel values to int, float, or None."""
    if pd.isna(value):
        return None

    # Already numeric
    if isinstance(value, (int, float)):
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return value

    # Remove commas and dollar signs
    if isinstance(value, str):
        value = value.strip().replace(",", "").replace("$", "")

        if value == "":
            return None

        try:
            f = float(value)
            if f.is_integer():
                return int(f)
            return f
        except ValueError:
            return value

    return value


def normalize_sheet(df):
    """Convert one worksheet into normalized records."""

    # Replace NaN with None
    df = df.where(pd.notna(df), None)

    records = []

    for _, row in df.iterrows():

        record = {
            "location": row.get("LOCNAME"),
            "grade": clean_number(row.get("GRADE")),
            "steps": []
        }

        for step in range(1, 11):
            annual = clean_number(row.get(f"ANNUAL{step}"))
            hourly = clean_number(row.get(f"HOURLY{step}"))
            overtime = clean_number(row.get(f"OVERTIME{step}"))

            # Skip empty steps
            if annual is None and hourly is None and overtime is None:
                continue

            record["steps"].append({
                "step": step,
                "annual": annual
            })

        records.append(record)

    return records


def convert_excel(input_file, output_file=None):
    input_file = Path(input_file)

    if output_file is None:
        output_file = input_file.with_suffix(".json")

    # Read every worksheet
    workbook = pd.read_excel(
        input_file,
        sheet_name=None,
        dtype=object
    )

    output = {}

    for sheet_name, df in workbook.items():
        output[sheet_name] = normalize_sheet(df)

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Created {output_file}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("    python3 scripts/opm-convert.py paytable.xlsx")
        print("    python3 scripts/opm-convert.py paytable.xls output.json")
        sys.exit(1)

    infile = sys.argv[1]
    outfile = sys.argv[2] if len(sys.argv) > 2 else None

    convert_excel(infile, outfile)