import json, subprocess, tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
LOADER=ROOT/"tools"/"load_place_import_jsonl.py"

def run(path,*extra,ok=True):
    result=subprocess.run(["python3",str(LOADER),str(path),"--dry-run",*extra],capture_output=True,text=True)
    assert (result.returncode==0)==ok,(result.stdout,result.stderr)
    return result

def write(path,rows):
    path.write_text("".join(json.dumps(row,ensure_ascii=False)+"\n" for row in rows),encoding="utf-8")

def main():
    with tempfile.TemporaryDirectory() as td:
        d=Path(td)
        good=d/"good.jsonl"
        write(good,[
            {"place_provider":"sbiz","provider_place_id":"A1","source_updated_at":"2026-09-01T00:00:00+00:00","payload":{"name":"원픽대창"}},
            {"place_provider":"sbiz","provider_place_id":"A2","source_updated_at":"2026-09-01T00:00:00+00:00","payload":{"name":"원픽국밥"}},
        ])
        result=run(good,"--batch-size","1","--promote")
        data=json.loads(result.stdout)
        assert data=={
            "provider":"sbiz",
            "source_updated_at":"2026-09-01T00:00:00+00:00",
            "rows":2,
            "batches":2,
            "promote":True,
        }

        mixed=d/"mixed.jsonl"
        write(mixed,[
            {"place_provider":"sbiz","provider_place_id":"A1","source_updated_at":"2026-09-01T00:00:00+00:00","payload":{"name":"a"}},
            {"place_provider":"sbiz","provider_place_id":"A2","source_updated_at":"2026-09-02T00:00:00+00:00","payload":{"name":"b"}},
        ])
        assert "mixed source_updated_at" in run(mixed,ok=False).stderr

        wrong=d/"wrong.jsonl"
        write(wrong,[{"place_provider":"other","provider_place_id":"A1","source_updated_at":"2026-09-01T00:00:00+00:00","payload":{"name":"a"}}])
        assert "expected place_provider" in run(wrong,ok=False).stderr

        invalid=d/"invalid.jsonl"
        invalid.write_text("{not json}\n",encoding="utf-8")
        assert "invalid JSON" in run(invalid,ok=False).stderr

        empty=d/"empty.jsonl";empty.write_text("",encoding="utf-8")
        assert "contained no rows" in run(empty,ok=False).stderr

        assert "--batch-size must be between 1 and 500" in run(good,"--batch-size","501",ok=False).stderr

    print("place import loader tests: ok")

if __name__=="__main__":
    main()
