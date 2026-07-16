"""
Shared text preprocessing for both corpus indexing and query tokenization.

Using the same function on both sides ensures BM25 sees identical token forms
and avoids zero-overlap issues like "CABLE," (comma attached) vs "cable" (clean).
"""
import re
from abbreviations import expand


def tokenize(text: str) -> list[str]:
    """
    Lowercase → expand abbreviations → strip punctuation → split → drop empties.

    Applied to both corpus descriptions at index-build time and to query descriptions
    at rank time so token forms always match.
    """
    if not text:
        return []
    # expand() works on uppercase input
    expanded = expand(text.upper())
    lower = expanded.lower()
    # Replace any non-alphanumeric, non-space character with a space
    cleaned = re.sub(r"[^\w\s]", " ", lower)
    return [t for t in cleaned.split() if t]
