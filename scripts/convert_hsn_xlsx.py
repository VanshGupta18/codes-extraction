import csv
import zipfile
import xml.etree.ElementTree as ET

XLSX = "docs/HSN_SAC.xlsx"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _load_sheet(z, sheetfile, shared):
    def cell_value(c):
        v = c.find("m:v", NS)
        if v is None:
            return None
        return shared[int(v.text)] if c.attrib.get("t") == "s" else v.text

    root = ET.fromstring(z.read(sheetfile))
    rows = []
    for row in root.find("m:sheetData", NS).findall("m:row", NS)[1:]:
        vals = [cell_value(c) for c in row.findall("m:c", NS)]
        if len(vals) >= 2 and vals[0]:
            rows.append((vals[0], vals[1]))
    return rows


def _enrich(rows, ancestor_lengths, leaf_length):
    by_code = dict(rows)

    def ancestors(code):
        return [code[:n] for n in ancestor_lengths if len(code) > n and code[:n] in by_code]

    def text_for(code, desc):
        chain, seen = [by_code[a] for a in ancestors(code)] + [desc], []
        for p in chain:
            if p not in seen:
                seen.append(p)
        return " ".join(seen)

    return [(c, text_for(c, d)) for c, d in rows if len(c) == leaf_length]


def _write_csv(path, rows):
    with open(path, "w", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["Code", "Description"])
        w.writerows(rows)


if __name__ == "__main__":
    z = zipfile.ZipFile(XLSX)
    sst = ET.fromstring(z.read("xl/sharedStrings.xml"))
    shared = ["".join((t.text or "") for t in si.findall(".//m:t", NS)) for si in sst.findall("m:si", NS)]

    hsn_rows = _load_sheet(z, "xl/worksheets/sheet1.xml", shared)
    sac_rows = _load_sheet(z, "xl/worksheets/sheet2.xml", shared)

    _write_csv("cap/db/data/hsn-GovtHSNMaster.csv", _enrich(hsn_rows, (2, 4, 6), 8))
    _write_csv("cap/db/data/hsn-GovtSACMaster.csv", _enrich(sac_rows, (2, 4), 6))
    print("wrote hsn-GovtHSNMaster.csv and hsn-GovtSACMaster.csv (ancestor-enriched)")
