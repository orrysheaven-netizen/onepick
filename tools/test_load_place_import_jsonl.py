import json, subprocess, sys, tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
LOADER=ROOT/"tools"/"load_place_import_jsonl.py"

def run(path,*extra,ok=True):
    result=subprocess.run([sys.executable,str(LOADER),str(path),"--dry-run",*extra],capture_output=True,text=True)
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

    connection_tests()
    print("place import loader tests: ok")

def connection_tests():
    import importlib.util
    spec=importlib.util.spec_from_file_location("loader",LOADER)
    loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)

    # psql ignores a URI in PGDATABASE, so the URL must be split into libpq variables.
    env=loader.libpq_env("postgresql://postgres.abcd:p%40ss%3Aword@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres")
    assert env["PGHOST"]=="aws-0-ap-northeast-2.pooler.supabase.com",env
    assert env["PGPORT"]=="6543" and env["PGUSER"]=="postgres.abcd" and env["PGDATABASE"]=="postgres",env
    assert env["PGPASSWORD"]=="p@ss:word","percent-encoded passwords are decoded"
    assert env["PGSSLMODE"]=="require","remote hosts default to TLS"
    assert env["PGCLIENTENCODING"]=="UTF8","Korean payloads are sent as UTF-8"
    local=loader.libpq_env("postgresql://postgres:postgres@127.0.0.1:54322/postgres")
    assert "PGSSLMODE" not in local,"local Docker databases keep libpq's default"
    assert loader.libpq_env("postgres://u:p@db.example/app?sslmode=verify-full")["PGSSLMODE"]=="verify-full"
    for bad in ("not a url","mysql://u:p@h/db","postgresql:///nohost"):
        try:
            loader.libpq_env(bad)
        except SystemExit:
            pass
        else:
            raise AssertionError(bad)

    cmd=loader.psql_command(True,None)
    assert cmd[0]=="psql" and "-t" in cmd and not any("postgres" in part for part in cmd)
    docker=loader.psql_command(False,"supabase_db_onepick")
    assert docker[:3]==["docker","exec","-i"] and "supabase_db_onepick" in docker and "-t" not in docker
    forwarded=[docker[i+1] for i,part in enumerate(docker) if part=="-e"]
    assert set(forwarded)==set(loader.LIBPQ_VARS),forwarded
    assert all("=" not in name for name in forwarded),"secrets are forwarded by name, never in argv"

if __name__=="__main__":
    main()
