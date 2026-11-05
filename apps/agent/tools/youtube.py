import re
from urllib.parse import urlencode

_RECENCY_TERMS = re.compile(
    r"\b(?:latest|newest|most\s+recent|recent|today|this\s+year|current|naya|nayi)\b"
    r"|नवीनतम|नया|नई|تازہ|نیا|نئی",
    re.IGNORECASE,
)
_YEAR = re.compile(r"\b(?:19|20)\d{2}\b")


def build_youtube_search_url(query: str) -> str:
    """Build a YouTube search URL, applying upload-date sorting for recency requests."""
    trimmed_query = query.strip()
    wants_latest = bool(_RECENCY_TERMS.search(trimmed_query))
    search_query = _RECENCY_TERMS.sub(" ", trimmed_query)
    if wants_latest:
        search_query = _YEAR.sub(" ", search_query)
    search_query = " ".join(search_query.split()) or trimmed_query
    params = {"search_query": search_query}
    if wants_latest:
        params["sp"] = "CAI="
    return f"https://www.youtube.com/results?{urlencode(params)}"
