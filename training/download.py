"""Download the Columbia Gaze dataset (Kaggle mirror) into data/datasets/columbia_gaze.

Kaggle throttles each connection (~50-100 KB/s here), so the 2.4 GB zip would take hours.
Instead we list the files and fetch images in parallel, subject by subject; that is ~10x
faster and lets training start on the first subjects while the rest keep downloading.

Credentials: KAGGLE_USERNAME / KAGGLE_KEY in backend/.env (or ~/.kaggle/kaggle.json).
Dataset: Smith et al., "Gaze Locking: Passive Eye Contact Detection for Human-Object
Interaction", UIST 2013. Non-commercial research use only.

Usage: python training/download.py [--subjects N] [--workers 16]
"""
from __future__ import annotations

import argparse
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "backend" / ".env")  # must happen before `import kaggle` (it authenticates on import)

OUT = ROOT / "data" / "datasets" / "columbia_gaze"
REF = "muhammadmubeenxt/colombia-gaze"
NAME = re.compile(r"^(\d{4})_2m_(-?\d+)P_(-?\d+)V_(-?\d+)H\.jpg$", re.I)


def list_images(api) -> list[str]:
    names, token = [], None
    while True:
        res = api.dataset_list_files(REF, page_token=token, page_size=200)
        names += [f.name for f in res.files if NAME.match(Path(f.name).name)]
        token = getattr(res, "next_page_token", None) or getattr(res, "nextPageToken", None)
        if not token:
            return names


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--subjects", type=int, default=0, help="only the first N subjects (0 = all 56)")
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()

    import kaggle  # noqa: E402

    api = kaggle.api
    names = list_images(api)
    subjects = sorted({NAME.match(Path(n).name).group(1) for n in names})
    if args.subjects:
        subjects = subjects[: args.subjects]
    wanted = [n for n in names if NAME.match(Path(n).name).group(1) in subjects]
    todo = [n for n in wanted if not (OUT / n).exists()]
    print(f"{len(wanted)} images for {len(subjects)} subjects; {len(wanted) - len(todo)} already present")

    # kaggle's downloader races on makedirs when threads share a folder, so create them first.
    for d in {(OUT / n).parent for n in todo}:
        d.mkdir(parents=True, exist_ok=True)

    def fetch(name: str) -> str:
        for attempt in range(4):
            try:
                api.dataset_download_file(REF, name, path=str(OUT), quiet=True)
                return name
            except Exception:
                time.sleep(2 * (attempt + 1))
        raise RuntimeError(f"failed: {name}")

    t0, done, failed = time.time(), 0, []
    # Subject order, so early subjects complete first and can be used for a smoke test.
    with ThreadPoolExecutor(args.workers) as ex:
        futures = {ex.submit(fetch, n): n for n in todo}
        for fut in as_completed(futures):
            try:
                fut.result()
                done += 1
            except Exception as e:
                failed.append(str(e))
            if done % 100 == 0 and done:
                rate = done / (time.time() - t0)
                print(f"  {done}/{len(todo)} ({rate:.1f} img/s, ~{(len(todo) - done) / rate / 60:.0f} min left)", flush=True)
    have = sum(1 for n in wanted if (OUT / n).exists())
    print(f"Done: {have}/{len(wanted)} images in {OUT} ({len(failed)} failed)")


if __name__ == "__main__":
    main()
