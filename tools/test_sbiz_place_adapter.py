import csv, json, subprocess, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; ADAPTER=ROOT/"tools"/"sbiz_place_adapter.py"
FIELDS=["상가업소번호","상호명","지점명","도로명주소","지번주소","시도명","시군구명","경도","위도","상권업종소분류명"]
def write(path,rows,encoding="utf-8-sig",fields=FIELDS):
    with path.open("w",encoding=encoding,newline="") as f:
        w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
def run(src,out,rep,*extra,ok=True):
    cmd=["python3",str(ADAPTER),str(src),"--output",str(out),"--report",str(rep),"--source-updated-at","2026-09-01T00:00:00Z","--max-duplicate-ratio","1",*extra]
    r=subprocess.run(cmd,capture_output=True,text=True)
    assert (r.returncode==0)==ok,(r.stdout,r.stderr);return r
def base(pid="S1",**kw):
    r={"상가업소번호":pid,"상호명":"원픽곱창","지점명":"","도로명주소":"서울 강남구 테스트로 1","지번주소":"","시도명":"서울특별시","시군구명":"강남구","경도":"127.01","위도":"37.50","상권업종소분류명":"한식"};r.update(kw);return r
def main():
  with tempfile.TemporaryDirectory() as td:
    d=Path(td);src=d/"s.csv";out=d/"o.jsonl";rep=d/"r.json"
    write(src,[base(),base(도로명주소="",경도="",위도=""),base(pid="",상호명="없음")])
    run(src,out,rep,"--max-missing-ratio","1")
    data=[json.loads(x) for x in out.read_text().splitlines()];r=json.loads(rep.read_text())
    assert len(data)==1 and data[0]["payload"]["latitude"]==37.5
    assert r["duplicate_provider_id_count"]==1 and r["duplicate_row_count"]==1 and r["dropped_duplicate_rows"]==1
    assert "headers" in r and r["resolved_columns"]["provider_category"]=="상권업종소분류명"
    # Korean bbox: 0,0 is invalid, not blank.
    out.unlink();rep.unlink();write(src,[base(경도="0",위도="0")]);run(src,out,rep,"--max-missing-ratio","1");assert json.loads(rep.read_text())["invalid_coordinates"]==1
    # cp949 is supported explicitly.
    out.unlink();rep.unlink();write(src,[base()],encoding="cp949");run(src,out,rep,"--encoding","cp949")
    # missing logical required header fails.
    bad=d/"bad.csv";write(bad,[{k:v for k,v in base().items() if k!="경도"}],fields=[x for x in FIELDS if x!="경도"])
    subprocess.run(["python3",str(ADAPTER),str(bad),"--print-header"],check=True,capture_output=True,text=True)
    rr=subprocess.run(["python3",str(ADAPTER),str(bad),"--output",str(d/"x"),"--report",str(d/"y"),"--source-updated-at","2026-09-01T00:00:00Z"],capture_output=True,text=True);assert rr.returncode!=0
    # future source timestamp fails.
    rr=subprocess.run(["python3",str(ADAPTER),str(src),"--output",str(d/"f"),"--report",str(d/"fr"),"--source-updated-at","2099-01-01T00:00:00Z"],capture_output=True,text=True);assert rr.returncode!=0
    # default quality gate rejects missing category/address/region.
    q=d/"q.csv";write(q,[base(도로명주소="",지번주소="",시도명="",시군구명="",상권업종소분류명="")])
    rr=run(q,d/"qo",d/"qr",ok=False);assert "quality gate failed" in rr.stderr
    # limit keeps original hash/report but emits only N rows.
    l=d/"l.csv";write(l,[base("L1"),base("L2")]);run(l,d/"lo",d/"lr","--limit","1");assert len((d/"lo").read_text().splitlines())==1
    print("sbiz adapter tests: ok")
if __name__=="__main__":main()
