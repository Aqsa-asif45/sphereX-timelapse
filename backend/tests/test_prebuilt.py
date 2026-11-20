"""The pre-built demo data is copied into the cache on start-up, without overwriting anything."""

from app.config import settings
from app.services import prebuilt


def test_seed_copies_only_missing_files(monkeypatch, tmp_path):
    src, cache = tmp_path / "prebuilt", tmp_path / "cache"
    (src / "cutouts").mkdir(parents=True)
    (src / "cutouts" / "a.bin").write_bytes(b"new")
    (src / "searches").mkdir()
    (src / "searches" / "s.json").write_text("{}")
    (cache / "cutouts").mkdir(parents=True)
    (cache / "cutouts" / "a.bin").write_bytes(b"kept")  # already in the cache: must not be overwritten
    monkeypatch.setattr(prebuilt, "PREBUILT", src)
    monkeypatch.setattr(settings, "cache_dir", cache)
    assert prebuilt.seed_cache() == 1
    assert (cache / "cutouts" / "a.bin").read_bytes() == b"kept"
    assert (cache / "searches" / "s.json").read_text() == "{}"
    assert prebuilt.seed_cache() == 0  # second start: nothing to do


def test_shipped_prebuilt_data_is_present():
    files = [p for p in prebuilt.PREBUILT.rglob("*") if p.is_file()]
    assert len(files) > 2000  # 5 searches, ~2200 cutouts, 5 previews, 10 catalogue lists
    assert {p.parent.name for p in files} >= {"searches", "cutouts", "previews", "catalogs"}
