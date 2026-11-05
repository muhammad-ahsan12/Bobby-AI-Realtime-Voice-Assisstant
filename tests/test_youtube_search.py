from urllib.parse import parse_qs, urlparse

from apps.agent.tools.youtube import build_youtube_search_url


def test_latest_youtube_search_drops_stale_year_and_sorts_by_upload_date():
    url = urlparse(build_youtube_search_url("Latest Naat 2024"))
    params = parse_qs(url.query)

    assert url.netloc == "www.youtube.com"
    assert params["search_query"] == ["Naat"]
    assert params["sp"] == ["CAI="]


def test_specific_youtube_title_is_preserved_without_recency_filter():
    url = urlparse(build_youtube_search_url("Hasbi Rabbi Jallallah Naat"))
    params = parse_qs(url.query)

    assert params["search_query"] == ["Hasbi Rabbi Jallallah Naat"]
    assert "sp" not in params


def test_non_english_recency_query_is_sorted_by_upload_date():
    params = parse_qs(urlparse(build_youtube_search_url("تازہ نعت 2025")).query)

    assert params["search_query"] == ["نعت"]
    assert params["sp"] == ["CAI="]
