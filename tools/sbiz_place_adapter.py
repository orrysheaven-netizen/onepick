#!/usr/bin/env python3
"""Validate and normalize an SBIZ CSV into OnePick place staging rows.

No network or database writes. Input/output are explicit files so the report is
repeatable and can be reviewed before anything reaches Supabase.
"""
import argparse, csv, hashlib, json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ALIASES = {
    "provider_place_id": ["상가업소번호"],
    "name": ["상호명"],
    "branch_name": ["지점명"],
    "road_address": ["도로명주소"],
    "address": ["지번주소"],
    "region_1": ["시도명"],
    "region_2": ["시군구명"],
    "longitude": ["경도"],
    "latitude": ["위도"],
    "provider_category": ["상권업종소분류명", "상권업종중분류명"],
}

def pick(row, keys):
    for key in keys:
        value=(row.get(key) or "").strip()
        if value:
            return value
    return None

def parse_coord(value, low, high):
    if value is None: return None
    try: number=float(value)
    except ValueError: return None
    return number if low <= number <= high else None

def main():
    p=argparse.ArgumentParser()
    p.add_argument("input_csv")
    p.add_argument("--output", required=True)
    p.add_argument("--report", required=True)
    p.add_argument("--encoding", default="utf-8-sig")
    p.add_argument("--source-updated-at", required=True,
                   help="ISO-8601 timestamp for the source snapshot")
    args=p.parse_args()
    source_ts=datetime.fromisoformat(args.source_updated_at.replace("Z","+00:00"))
    if source_ts.tzinfo is None: raise SystemExit("--source-updated-at must include timezone")

    inp=Path(args.input_csv)
    digest=hashlib.sha256(inp.read_bytes()).hexdigest()
    counts=Counter()
    ids=Counter()
    categories=Counter()
    output=[]

    with inp.open("r",encoding=args.encoding,newline="") as f:
        reader=csv.DictReader(f)
        headers=set(reader.fieldnames or [])
        missing=[name for name,aliases in ALIASES.items()
                 if name in {"provider_place_id","name","longitude","latitude"}
                 and not any(a in headers for a in aliases)]
        if missing:
            raise SystemExit("missing required SBIZ columns: "+", ".join(missing))
        for row in reader:
            counts["rows"]+=1
            pid=pick(row,ALIASES["provider_place_id"])
            name=pick(row,ALIASES["name"])
            if not pid or not name:
                counts["rejected_missing_identity"]+=1; continue
            lon=parse_coord(pick(row,ALIASES["longitude"]),-180,180)
            lat=parse_coord(pick(row,ALIASES["latitude"]),-90,90)
            if (lon is None) != (lat is None):
                lon=lat=None
            if lon is None: counts["missing_coordinates"]+=1
            road=pick(row,ALIASES["road_address"])
            addr=pick(row,ALIASES["address"])
            if not road and not addr: counts["missing_address"]+=1
            cat=pick(row,ALIASES["provider_category"])
            if cat: categories[cat]+=1
            ids[pid]+=1
            payload={
                "name":name,
                "branch_name":pick(row,ALIASES["branch_name"]),
                "road_address":road,
                "address":addr,
                "region_1":pick(row,ALIASES["region_1"]),
                "region_2":pick(row,ALIASES["region_2"]),
                "latitude":lat,
                "longitude":lon,
                "provider_category":cat,
                "business_status":"open",
            }
            output.append({"place_provider":"sbiz","provider_place_id":pid,
                           "source_updated_at":source_ts.astimezone(timezone.utc).isoformat(),
                           "payload":payload})
            counts["accepted"]+=1

    duplicate_ids=sum(1 for n in ids.values() if n>1)
    report={
        "input":inp.name,"sha256":digest,"rows":counts["rows"],
        "accepted":counts["accepted"],
        "rejected_missing_identity":counts["rejected_missing_identity"],
        "missing_address":counts["missing_address"],
        "missing_coordinates":counts["missing_coordinates"],
        "duplicate_provider_ids":duplicate_ids,
        "distinct_provider_categories":len(categories),
        "top_provider_categories":categories.most_common(20),
    }
    Path(args.output).write_text("\n".join(json.dumps(x,ensure_ascii=False) for x in output)+"\n",encoding="utf-8")
    Path(args.report).write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

if __name__=="__main__": main()
