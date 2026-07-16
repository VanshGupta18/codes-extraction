import csv
import os
import re
import zipfile
import xml.etree.ElementTree as ET

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS_DIR = os.path.join(PROJECT_ROOT, "docs")
DATA_DIR = os.path.join(PROJECT_ROOT, "cap", "db", "data")
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

MARA_FILE = os.path.join(DOCS_DIR, "MARA 01.07.2026 TO 07.07.2026.xlsx")
MARC_FILE = os.path.join(DOCS_DIR, "MARC 01.07.2027 TO 07.07.2026.xlsx")
LEGACY_FILE = os.path.join(DOCS_DIR, "MAT LEGACY TABLE CUSTOM 0107.2026 TO 07.07.2026.xlsx")

_COL_RE = re.compile(r"[A-Z]+")


def _col_to_index(cell_ref):
    letters = _COL_RE.match(cell_ref).group()
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch) - ord("A") + 1)
    return idx - 1


def read_sheet(xlsx_path):
    """Reads the first worksheet into a list of dicts keyed by the header row."""
    z = zipfile.ZipFile(xlsx_path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        sst = ET.fromstring(z.read("xl/sharedStrings.xml"))
        shared = ["".join((t.text or "") for t in si.findall(".//m:t", NS)) for si in sst.findall("m:si", NS)]

    def cell_value(c):
        v = c.find("m:v", NS)
        if v is None:
            return ""
        return shared[int(v.text)] if c.attrib.get("t") == "s" else v.text

    sheet_file = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml", n))[0]
    root = ET.fromstring(z.read(sheet_file))
    rows = root.find("m:sheetData", NS).findall("m:row", NS)

    def row_values(row, width):
        values = [""] * width
        for c in row.findall("m:c", NS):
            idx = _col_to_index(c.attrib["r"])
            if idx < width:
                values[idx] = cell_value(c)
        return values

    header_cells = rows[0].findall("m:c", NS)
    width = max(_col_to_index(c.attrib["r"]) for c in header_cells) + 1
    headers = row_values(rows[0], width)

    return [dict(zip(headers, row_values(row, width))) for row in rows[1:]]


def _write_csv(path, fieldnames, rows):
    with open(path, "w", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(fieldnames)
        w.writerows(rows)


def convert_mara():
    records = read_sheet(MARA_FILE)
    seen, mara_rows, makt_rows = set(), [], []
    for r in records:
        material = r["Material"]
        if material in seen:
            continue
        seen.add(material)
        mara_rows.append((material, r["Material Group"], r["Material Type"]))
        description = (r["Material description"] or "").replace("\n", " ").replace("\r", " ")
        makt_rows.append((material, "EN", description))
    _write_csv(os.path.join(DATA_DIR, "hsn-MARA.csv"), ["MaterialNumber", "MaterialGroup", "MaterialType"], mara_rows)
    _write_csv(os.path.join(DATA_DIR, "hsn-MAKT.csv"), ["MaterialNumber", "Language", "Description"], makt_rows)
    print(f"wrote hsn-MARA.csv ({len(mara_rows)} rows) and hsn-MAKT.csv ({len(makt_rows)} rows)")


def convert_marc():
    records = read_sheet(MARC_FILE)
    seen, rows = set(), []
    for r in records:
        key = (r["Material"], r["Plant"])
        if key in seen:
            continue
        seen.add(key)
        rows.append(key)
    _write_csv(os.path.join(DATA_DIR, "hsn-MARC.csv"), ["MaterialNumber", "Plant"], rows)
    print(f"wrote hsn-MARC.csv ({len(rows)} rows)")


def convert_legacy():
    records = read_sheet(LEGACY_FILE)
    seen, rows = set(), []
    for r in records:
        material = r["Material"]
        if material in seen:
            continue
        seen.add(material)
        rows.append((material, "9999"))
    _write_csv(os.path.join(DATA_DIR, "hsn-ZMM_MAT_LEGACY.csv"), ["MaterialNumber", "HSN"], rows)
    print(f"wrote hsn-ZMM_MAT_LEGACY.csv ({len(rows)} rows)")


if __name__ == "__main__":
    os.makedirs(DATA_DIR, exist_ok=True)
    convert_mara()
    convert_marc()
    convert_legacy()
