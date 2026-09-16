#!/usr/bin/env python3
"""
yelp_layer.py — Local SMB discovery layer for InsureFlow (insurance lane)
=================================================================
Zero Apollo credits. Uses HasData Yelp Search + Reviews APIs to build a
qualified local SMB lead list, tagged lane='EMAIL', ready for the Apollo
reveal step (which is the ONLY paid meter downstream).

Usage:
  export HASDATA_API_KEY=your_key
  python yelp_layer.py --niche trucking --metro "Detroit, MI" --pages 3
  python yelp_layer.py --config niches.json --export apollo_upload.csv

Outputs:
  yelp_leads.db      SQLite (leads table, dedupe, lane tags, signals)
  apollo_upload.csv  Qualified leads formatted for Apollo list import
"""
import argparse, json, os, re, sqlite3, sys, time
from datetime import datetime, timezone

import requests

HASDATA = "https://api.hasdata.com/scrape"
H = lambda: {"x-api-key": os.environ["HASDATA_API_KEY"],
             "Content-Type": "application/json"}

# Niches where commercial insurance / business insurance prospects live.
# Add/remove freely — this is the whole targeting dial.
DEFAULT_NICHES = ["trucking company", "trucking", "logistics", "freight",
                  "contractor", "construction company", "moving company",
                  "restaurant", "auto repair", "landscaping", "plumber",
                  "electrician", "roofing contractor", "warehouse"]

# Review-text growth signals: businesses complaining/glowing about being
# busy = they are growing = insurance needs change (fleet, workers comp,
# GL limits, new location). This is the warm-intent layer.
GROWTH_SIGNALS = re.compile(
    r"\b(hiring|expanding|expanded|new location|new location|grew|growth|"
    r"busy|slammed|booked out|backed up|new trucks?|added .*(trucks?|vans?|"
    r"drivers?|staff|employees?)|fleet|understaffed|short.?staffed|"
    r"we'?re growing|just opened|second location)\b", re.I)

RISK_SIGNALS = re.compile(
    r"\b(terrible insurance|liability|lawsuit|sued|workers? comp|"
    r"injured on the job|accident|damaged|stolen|break.?in|fire)\b", re.I)


# ---------------------------------------------------------------- client --
def yelp_search(keyword: str, location: str, start: int = 0) -> list[dict]:
    """One page of Yelp business listings (~10-20 per request)."""
    r = requests.get(f"{HASDATA}/yelp/search",
                     headers=H(), params={"keyword": keyword,
                                          "location": location, "start": start},
                     timeout=60)
    r.raise_for_status()
    return r.json().get("businesses", r.json().get("results", []))


def yelp_reviews(place_id: str, query: str | None = None,
                 domain: str = "www.yelp.com") -> list[dict]:
    """Reviews for a single place. Pass `query` to search INSIDE the
    reviews (e.g. query="hiring") — same 10-credit price, but returns
    only matching reviews, so one call confirms/denies a signal."""
    params = {"placeId": place_id, "domain": domain}
    if query:
        params["query"] = query
    r = requests.get(f"{HASDATA}/yelp/reviews",
                     headers=H(), params=params, timeout=60)
    if r.status_code != 200:
        return []
    data = r.json()
    # Verified 2026-09-17: Yelp Reviews returns a requestMetadata envelope
    # {id,status,html,json,preview,url}; review objects live behind the
    # stored JSON link (unlike Google Maps reviews which are inline).
    reviews = data.get("reviews")
    if reviews is None:
        link = (data.get("requestMetadata") or {}).get("json")
        if link:
            try:
                j = requests.get(link, timeout=60)
                if j.ok:
                    reviews = j.json().get("reviews", [])
            except requests.RequestException:
                reviews = None
    return reviews or []


def call_with_retry(fn, *a, **kw):
    for attempt in range(4):
        try:
            return fn(*a, **kw)
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code in (429, 500, 502, 503):
                time.sleep(2 ** attempt + 1)
                continue
            raise
        except requests.RequestException:
            time.sleep(2 ** attempt + 1)
    raise RuntimeError("HasData unreachable after retries")


# ----------------------------------------------------------------- scoring --
def qualify(biz: dict, reviews: list[dict],
            already_targeted: bool = False) -> tuple[bool, dict]:
    """Return (qualified, signals). Tune the dials here — this is strategy.
    already_targeted=True when reviews came from a query search — every
    returned review IS a signal hit, skip the regex pass."""
    sig = {"growth_hits": 0, "risk_hits": 0, "recent_reviews": 0,
           "samples": []}
    rating = biz.get("rating") or 0
    review_count = biz.get("reviewCount") or biz.get("reviews") or 0
    # Established but not huge: 5+ reviews = real business, < 500 = SMB not chain
    established = 5 <= review_count <= 500
    for rv in reviews:
        text = f"{rv.get('text','')} {rv.get('snippet','')}"
        if already_targeted or GROWTH_SIGNALS.search(text):
            sig["growth_hits"] += 1
            if len(sig["samples"]) < 3:
                sig["samples"].append(text[:140])
        if RISK_SIGNALS.search(text):
            sig["risk_hits"] += 1
        try:
            d = datetime.fromisoformat(str(rv.get("date", "")).replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - d).days <= 180:
                sig["recent_reviews"] += 1
        except ValueError:
            pass
    qualified = established and rating >= 3.2 and \
        (sig["growth_hits"] >= 1 or sig["risk_hits"] >= 1)
    return qualified, sig


# ------------------------------------------------------------------ store --
DDL = """CREATE TABLE IF NOT EXISTS leads(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  yelp_place_id TEXT, name TEXT, address TEXT, city TEXT, phone TEXT,
  rating REAL, review_count INT, website TEXT, categories TEXT,
  lane TEXT DEFAULT 'EMAIL', status TEXT DEFAULT 'new',
  growth_hits INT DEFAULT 0, risk_hits INT DEFAULT 0,
  signal_samples TEXT, source TEXT DEFAULT 'yelp',
  first_seen TEXT, qualified INT DEFAULT 0,
  UNIQUE(name, address))"""


def upsert_lead(db, biz, metro, qualified, sig):
    db.execute(DDL)
    db.execute("""INSERT INTO leads(yelp_place_id,name,address,city,phone,rating,
                  review_count,website,categories,growth_hits,risk_hits,
                  signal_samples,first_seen,qualified)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(name,address) DO UPDATE SET
                    growth_hits=excluded.growth_hits,
                    risk_hits=excluded.risk_hits,
                    qualified=excluded.qualified""",
               (biz.get("placeId") or biz.get("id"), biz.get("name"),
                biz.get("address"), metro, biz.get("phone"), biz.get("rating"),
                biz.get("reviewCount") or biz.get("reviews"), biz.get("website"),
                json.dumps(biz.get("categories", [])),
                sig["growth_hits"], sig["risk_hits"],
                json.dumps(sig["samples"]), datetime.now(timezone.utc).isoformat(),
                int(qualified)))
    db.commit()


# ---------------------------------------------------------------- pipeline --
PRICE_SEARCH = 5    # credits/request — VERIFY on the Yelp Search API page
PRICE_REVIEWS = 10  # confirmed from your dashboard screenshot

def run(niches, metros, pages, deep_qualify, db_path, export_path,
        deep_limit=40, signal_query=None, min_reviews=10, max_reviews=300):
    est = len(niches) * len(metros) * pages * PRICE_SEARCH
    if deep_qualify:
        est += len(niches) * len(metros) * min(deep_limit, 25) * PRICE_REVIEWS
    print(f"[budget] estimated worst-case spend: ~{est} HasData credits")
    db = sqlite3.connect(db_path)
    db.execute(DDL)
    seen_new = seen_qual = deep_spent = 0
    for metro in metros:
        for niche in niches:
            for page in range(pages):
                try:
                    businesses = call_with_retry(yelp_search, niche, metro,
                                                 page * 10)
                except Exception as e:
                    print(f"[warn] {niche} @ {metro} page {page}: {e}")
                    continue
                if not businesses:
                    break
                for biz in businesses:
                    # Cheap gate first: only spend a Reviews call when the
                    # listing itself looks qualified (established SMB).
                    rc = biz.get("reviewCount") or biz.get("reviews") or 0
                    if not (min_reviews <= rc <= max_reviews) \
                            or (biz.get("rating") or 0) < 3.2:
                        continue
                    if deep_qualify and deep_spent >= deep_limit:
                        reviews, qualified, sig = [], False, \
                            {"growth_hits": 0, "risk_hits": 0,
                             "recent_reviews": 0, "samples": []}
                    elif deep_qualify:
                        reviews = call_with_retry(yelp_reviews,
                            biz.get("placeId") or biz.get("id"),
                            query=signal_query)
                        deep_spent += 1
                        qualified, sig = qualify(biz, reviews,
                                                 already_targeted=bool(signal_query))
                    else:
                        reviews, qualified, sig = [], False, \
                            {"growth_hits": 0, "risk_hits": 0,
                             "recent_reviews": 0, "samples": []}
                    if qualified:
                        seen_qual += 1
                        upsert_lead(db, biz, metro, True, sig)
                        seen_new += db.total_changes > 0
                    time.sleep(1.1)  # be polite to the meter
                time.sleep(1.1)
            print(f"  [{metro} / {niche}] deep-calls spent: {deep_spent}")
    print(f"done. {seen_qual} qualified businesses, "
          f"{db.execute('SELECT COUNT(*) FROM leads WHERE qualified=1').fetchone()[0]} in db")
    if export_path:
        rows = db.execute("""SELECT name,address,city,phone,website,categories,
                             growth_hits,risk_hits FROM leads
                             WHERE qualified=1 AND status='new'""").fetchall()
        with open(export_path, "w") as f:
            f.write("company,address,city,phone,website,categories,growth_hits,risk_hits\n")
            for r in rows:
                f.write(",".join(str(x or "") for x in r) + "\n")
        print(f"exported {len(rows)} -> {export_path}")
        print("NEXT: import to Apollo as a list, then reveal emails (1 credit) "
              "only for the ones you keep.")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--niche", action="append", help="e.g. 'trucking company'")
    p.add_argument("--metro", action="append", required=True, help="'Detroit, MI'")
    p.add_argument("--pages", type=int, default=2)
    p.add_argument("--no-deep", action="store_true",
                   help="skip review-content calls (fast listing-only mode)")
    p.add_argument("--deep-limit", type=int, default=40,
                   help="max 10-credit review calls per niche+metro")
    p.add_argument("--signal-query", default=None,
                   help='e.g. "hiring" — one targeted 10cr call per candidate '
                        "returns only matching reviews")
    p.add_argument("--min-reviews", type=int, default=10)
    p.add_argument("--max-reviews", type=int, default=300)
    p.add_argument("--db", default="yelp_leads.db")
    p.add_argument("--export", default="apollo_upload.csv")
    a = p.parse_args()
    if not os.environ.get("HASDATA_API_KEY"):
        sys.exit("export HASDATA_API_KEY first")
    run(a.niche or DEFAULT_NICHES, a.metro, a.pages,
        not a.no_deep, a.db, a.export,
        deep_limit=a.deep_limit, signal_query=a.signal_query,
        min_reviews=a.min_reviews, max_reviews=a.max_reviews)
