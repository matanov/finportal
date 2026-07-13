#!/usr/bin/env python3

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
        print("    python excel_to_json.py paytable.xlsx")
        print("    python excel_to_json.py paytable.xls output.json")
        sys.exit(1)

    infile = sys.argv[1]
    outfile = sys.argv[2] if len(sys.argv) > 2 else None

    convert_excel(infile, outfile)