import csv, json, subprocess, tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ADAPTER=ROOT/"tools"/"sbiz_place_adapter.py"

def main():
    with tempfile.TemporaryDirectory() as d:
        d=Path(d); src=d/"sample.csv"; out=d/"out.jsonl"; report=d/"report.json"
        rows=[
          {"상가업소번호":"S1","상호명":"원픽곱창","지점명":"강남점","도로명주소":"서울 강남구 테스트로 1","지번주소":"","시도명":"서울특별시","시군구명":"강남구","경도":"127.01","위도":"37.50","상권업종소분류명":"한식"},
          {"상가업소번호":"S1","상호명":"원픽곱창","지점명":"강남점","도로명주소":"","지번주소":"","시도명":"서울특별시","시군구명":"강남구","경도":"","위도":"","상권업종소분류명":"한식"},
          {"상가업소번호":"","상호명":"식별자없음","지점명":"","도로명주소":"","지번주소":"","시도명":"서울특별시","시군구명":"","경도":"127","위도":"37","상권업종소분류명":""},
        ]
        with src.open("w",encoding="utf-8-sig",newline="") as f:
            w=csv.DictWriter(f,fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
        subprocess.run(["python3",str(ADAPTER),str(src),"--output",str(out),"--report",str(report),"--source-updated-at","2026-09-22T00:00:00Z"],check=True)
        data=[json.loads(x) for x in out.read_text(encoding="utf-8").splitlines()]
        r=json.loads(report.read_text(encoding="utf-8"))
        assert len(data)==2 and data[0]["place_provider"]=="sbiz"
        assert data[0]["payload"]["latitude"]==37.5
        assert r["rows"]==3 and r["accepted"]==2
        assert r["rejected_missing_identity"]==1
        assert r["duplicate_provider_ids"]==1
        assert r["missing_address"]==1 and r["missing_coordinates"]==1
        print("sbiz adapter tests: ok")
if __name__=="__main__": main()
