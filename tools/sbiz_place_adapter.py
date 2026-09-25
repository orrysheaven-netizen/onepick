#!/usr/bin/env python3
"""Offline SBIZ CSV validator/normalizer for OnePick place staging."""
import argparse, csv, hashlib, json, os, tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ALIASES={"provider_place_id":["상가업소번호"],"name":["상호명"],"branch_name":["지점명"],"road_address":["도로명주소"],"address":["지번주소"],"region_1":["시도명"],"region_2":["시군구명"],"longitude":["경도"],"latitude":["위도"],"provider_category":["상권업종소분류명","상권업종중분류명"],"provider_category_large":["상권업종대분류명","indsLclsNm"]}
REQUIRED={"provider_place_id","name","longitude","latitude"}
def sha256_file(p):
    h=hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""): h.update(chunk)
    return h.hexdigest()
def resolved(headers): return {k:next((a for a in v if a in headers),None) for k,v in ALIASES.items()}
def val(row,col):
    x=row.get(col) if col else None
    return x.strip() if isinstance(x,str) and x.strip() else None
def coord(raw,lo,hi):
    if raw is None:return None,"blank"
    try:n=float(raw)
    except ValueError:return None,"invalid"
    return (n,"ok") if lo<=n<=hi else (None,"invalid")
def score(c):
    p=c["payload"]; return sum((p["latitude"] is not None,p["road_address"] is not None,p["address"] is not None,p["region_1"] is not None,p["region_2"] is not None,p["provider_category"] is not None,p["branch_name"] is not None))
def timestamp(raw):
    try:t=datetime.fromisoformat(raw.replace("Z","+00:00"))
    except ValueError as e:raise SystemExit(f"invalid --source-updated-at: {e}")
    if t.tzinfo is None:raise SystemExit("--source-updated-at must include timezone")
    t=t.astimezone(timezone.utc)
    if t>datetime.now(timezone.utc):raise SystemExit("--source-updated-at cannot be in the future")
    return t
def header(path,enc):
    try:
        with path.open("r",encoding=enc,newline="") as f:return next(csv.reader(f),[])
    except UnicodeDecodeError as e:raise SystemExit(f"decode failed at byte {e.start} using {enc}; try --encoding cp949")
def main():
    a=argparse.ArgumentParser(); a.add_argument("input_csv"); a.add_argument("--output"); a.add_argument("--report"); a.add_argument("--encoding",default="utf-8-sig"); a.add_argument("--source-updated-at"); a.add_argument("--print-header",action="store_true"); a.add_argument("--max-missing-ratio",type=float,default=.2); a.add_argument("--max-duplicate-ratio",type=float,default=0); a.add_argument("--limit",type=int); a.add_argument("--region-1"); a.add_argument("--large-category"); a.add_argument("--force",action="store_true"); args=a.parse_args()
    inp=Path(args.input_csv); headers=header(inp,args.encoding)
    if args.print_header: print(json.dumps(headers,ensure_ascii=False)); return
    if not args.output or not args.report or not args.source_updated_at:raise SystemExit("--output, --report and --source-updated-at are required")
    if not 0<=args.max_missing_ratio<=1 or not 0<=args.max_duplicate_ratio<=1:raise SystemExit("ratio thresholds must be between 0 and 1")
    if args.limit is not None and args.limit<1:raise SystemExit("--limit must be >= 1")
    for p in map(Path,(args.output,args.report)):
        if p.exists() and not args.force:raise SystemExit(f"refusing to overwrite {p}; pass --force")
    ts=timestamp(args.source_updated_at); cols=resolved(headers)
    missing=sorted(k for k in REQUIRED if not cols[k])
    if missing:raise SystemExit("missing required SBIZ columns: "+", ".join(missing))
    if args.large_category and not cols["provider_category_large"]:raise SystemExit("missing SBIZ large-category column required by --large-category")
    counts,ids,cats,churn=Counter(),Counter(),Counter(),{}; winners={}
    try:
      with inp.open("r",encoding=args.encoding,newline="") as f:
        sentinel=object()
        reader=csv.DictReader(f,restval=sentinel)
        for idx,row in enumerate(reader,start=2):
          if args.limit is not None and counts["rows"]>=args.limit:break
          counts["rows"]+=1
          if None in row or sentinel in row.values():counts["malformed_rows"]+=1;continue
          r1_raw=val(row,cols["region_1"]); large_cat=val(row,cols["provider_category_large"])
          if args.region_1 and r1_raw!=args.region_1:counts["filtered_region"]+=1;continue
          if args.large_category and large_cat!=args.large_category:counts["filtered_large_category"]+=1;continue
          pid,name=val(row,cols["provider_place_id"]),val(row,cols["name"])
          if pid:ids[pid]+=1
          if not pid or not name or len(pid)>200 or len(name)>200:counts["rejected_identity"]+=1;continue
          rawlon,rawlat=val(row,cols["longitude"]),val(row,cols["latitude"])
          lon,ls=coord(rawlon,124,132); lat,ts_=coord(rawlat,33,39)
          if ls=="blank" and ts_=="blank":counts["blank_coordinates"]+=1
          elif ls!="ok" or ts_!="ok":counts["invalid_coordinates"]+=1;lon=lat=None
          road,addr=val(row,cols["road_address"]),val(row,cols["address"]); r1,r2=r1_raw,val(row,cols["region_2"]); cat=val(row,cols["provider_category"])
          if not road and not addr:counts["missing_address"]+=1
          if not r1 or not r2:counts["missing_region"]+=1
          if not cat:counts["missing_category"]+=1
          else:cats[cat]+=1
          payload={"name":name,"branch_name":val(row,cols["branch_name"]),"road_address":road,"address":addr,"region_1":r1,"region_2":r2,"latitude":lat,"longitude":lon,"provider_category":cat,"business_status":"open"}
          cand={"place_provider":"sbiz","provider_place_id":pid,"source_updated_at":ts.isoformat(),"payload":payload,"_row":idx}
          old=winners.get(pid)
          if old is None or score(cand)>score(old):winners[pid]=cand
          if lat is not None and lon is not None:
            key=(name.casefold().replace(" ",""),round(lat,4),round(lon,4))
            churn.setdefault(key,set()).add(pid)
    except UnicodeDecodeError as e:raise SystemExit(f"decode failed at byte {e.start} using {args.encoding}; try --encoding cp949")
    dup={k:n for k,n in ids.items() if n>1}; accepted_candidates=counts["rows"]-counts["rejected_identity"]-counts["malformed_rows"]
    out_path=Path(args.output); out_path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=".sbiz-",suffix=".jsonl",dir=out_path.parent); os.close(fd); tmp=Path(tmp)
    try:
      with tmp.open("w",encoding="utf-8") as out:
        for c in sorted(winners.values(),key=lambda x:x["_row"]): c.pop("_row",None); out.write(json.dumps(c,ensure_ascii=False)+"\n")
      denom=max(1,counts["rows"])
      report={"input":str(inp),"output":str(Path(args.output)),"sha256":sha256_file(inp),"source_updated_at":ts.isoformat(),"filters":{"region_1":args.region_1,"large_category":args.large_category},"headers":headers,"resolved_columns":cols,"rows":counts["rows"],"accepted":len(winners),"filtered_region":counts["filtered_region"],"filtered_large_category":counts["filtered_large_category"],"rejected_identity":counts["rejected_identity"],"malformed_rows":counts["malformed_rows"],"missing_address":counts["missing_address"],"missing_region":counts["missing_region"],"missing_category":counts["missing_category"],"blank_coordinates":counts["blank_coordinates"],"invalid_coordinates":counts["invalid_coordinates"],"duplicate_provider_id_count":len(dup),"duplicate_row_count":sum(n-1 for n in dup.values()),"dropped_duplicate_rows":max(0,accepted_candidates-len(winners)),"max_occurrences":max(ids.values(),default=0),"duplicate_provider_id_samples":sorted(dup)[:10],"identity_churn_collision_count":sum(1 for s in churn.values() if len(s)>1),"distinct_provider_categories":len(cats),"top_provider_categories":cats.most_common(20)}
      Path(args.report).write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
      ratios=[report["missing_address"]/denom,report["missing_region"]/denom,report["missing_category"]/denom,(report["blank_coordinates"]+report["invalid_coordinates"])/denom]
      gate_errors=[]
      if max(ratios)>args.max_missing_ratio:gate_errors.append("quality gate failed: missing-field ratio exceeds --max-missing-ratio")
      if report["duplicate_row_count"]/denom>args.max_duplicate_ratio:gate_errors.append("quality gate failed: duplicate-row ratio exceeds --max-duplicate-ratio")
      if gate_errors:
        raise SystemExit("; ".join(gate_errors))
      os.replace(tmp,out_path)
    finally:
      if tmp.exists():tmp.unlink()
if __name__=="__main__":main()
