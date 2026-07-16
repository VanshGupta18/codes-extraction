# Common SAP/automotive engineering shorthand seen in MAKT descriptions.
# Starter set — extend with real abbreviations as they show up in your own data.
ABBREVIATIONS = {
    "RR": "REAR", "FR": "FRONT", "LH": "LEFT HAND", "RH": "RIGHT HAND",
    "BRKT": "BRACKET", "ASSY": "ASSEMBLY", "CYL": "CYLINDER", "HSG": "HOUSING",
    "SHFT": "SHAFT", "BRG": "BEARING", "CVR": "COVER", "PLT": "PLATE",
    "SCR": "SCREW", "WSHR": "WASHER", "GSKT": "GASKET",
}


def expand(text: str) -> str:
    words = text.upper().split()
    return " ".join(ABBREVIATIONS.get(w, w) for w in words)
