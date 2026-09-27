#!/usr/bin/env python3
"""Load validated place JSONL into OnePick staging via psql.

This tool intentionally reuses the database's service_role-only staging and
promotion functions. It never accepts a Supabase service-role key and never
prints database credentials.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

MAX_BATCH = 500


def sql_literal(value):
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


LIBPQ_VARS = ("PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE", "PGCLIENTENCODING")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "host.docker.internal"}


def libpq_env(database_url):
    """Split a postgres:// URL into libpq variables.

    psql does not expand a connection URI given through PGDATABASE (it silently
    falls back to the local socket), and putting the URL in argv would expose
    the password in process listings, so the parts travel as PG* variables.
    """
    parts = urlsplit(database_url.strip())
    if parts.scheme not in ("postgres", "postgresql") or not parts.hostname:
        raise SystemExit("database URL must look like postgresql://user:password@host:port/dbname")
    query = parse_qs(parts.query)
    env = {
        "PGHOST": parts.hostname,
        "PGPORT": str(parts.port or 5432),
        "PGUSER": unquote(parts.username or "postgres"),
        "PGDATABASE": unquote(parts.path.lstrip("/")) or "postgres",
        "PGCLIENTENCODING": "UTF8",
    }
    if parts.password is not None:
        env["PGPASSWORD"] = unquote(parts.password)
    sslmode = query.get("sslmode", [None])[0]
    if sslmode or parts.hostname not in LOCAL_HOSTS:
        env["PGSSLMODE"] = sslmode or "require"
    return env


def psql_command(tuples_only=True, docker_container=None):
    """psql argv; with a container, runs the container's psql and forwards PG* by name only."""
    psql = ["psql", "-v", "ON_ERROR_STOP=1", "-X", "-q"]
    if tuples_only:
        psql += ["-A", "-t"]
    if not docker_container:
        return psql
    forward = [arg for name in LIBPQ_VARS for arg in ("-e", name)]
    return ["docker", "exec", "-i", *forward, docker_container, *psql]


PSQL_DOCKER_CONTAINER = None


def run_psql(database_url, sql, tuples_only=True):
    cmd = psql_command(tuples_only, PSQL_DOCKER_CONTAINER)
    if not shutil.which(cmd[0]):
        raise SystemExit(
            f"{cmd[0]} is required and was not found on PATH"
            + ("" if PSQL_DOCKER_CONTAINER else " (or use --psql-docker <container> to run psql inside a container)")
        )
    env = {key: value for key, value in os.environ.items() if key not in LIBPQ_VARS}
    env.update(libpq_env(database_url))
    result = subprocess.run(cmd, input=sql, text=True, encoding="utf-8", capture_output=True, env=env)
    if result.returncode:
        message = (result.stderr or result.stdout).strip()
        raise RuntimeError(message or f"psql exited with {result.returncode}")
    return result.stdout.strip()


def parse_jsonl(path, expected_provider):
    rows = []
    source_updated_at = None
    with path.open("r", encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"{path}:{lineno}: invalid JSON: {exc}") from exc
            if row.get("place_provider") != expected_provider:
                raise SystemExit(
                    f"{path}:{lineno}: expected place_provider={expected_provider!r}"
                )
            provider_place_id = row.get("provider_place_id")
            payload = row.get("payload")
            ts = row.get("source_updated_at")
            if not isinstance(provider_place_id, str) or not provider_place_id.strip():
                raise SystemExit(f"{path}:{lineno}: provider_place_id is required")
            if not isinstance(payload, dict):
                raise SystemExit(f"{path}:{lineno}: payload must be an object")
            if not isinstance(ts, str):
                raise SystemExit(f"{path}:{lineno}: source_updated_at is required")
            if source_updated_at is None:
                source_updated_at = ts
            elif ts != source_updated_at:
                raise SystemExit(
                    f"{path}:{lineno}: mixed source_updated_at values are not allowed"
                )
            rows.append(
                {"provider_place_id": provider_place_id.strip(), "payload": payload}
            )
    if not rows:
        raise SystemExit("input JSONL contained no rows")
    try:
        datetime.fromisoformat(source_updated_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SystemExit(f"invalid source_updated_at: {source_updated_at}") from exc
    return rows, source_updated_at


def stage_batch(database_url, provider, source_updated_at, batch):
    payload = json.dumps(batch, ensure_ascii=False, separators=(",", ":"))
    sql = f"""
set role service_role;
select private.stage_place_import_batch(
  {sql_literal(provider)},
  {sql_literal(source_updated_at)}::timestamptz,
  {sql_literal(payload)}::jsonb
)::text;
"""
    raw = run_psql(database_url, sql)
    return json.loads(raw.splitlines()[-1])


def create_run(database_url, provider, source_updated_at, fetched_count, source_file):
    source_date = source_updated_at[:10]
    checkpoint = json.dumps(
        {
            "phase": "staging",
            "source_file": source_file,
            "source_updated_at": source_updated_at,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    sql = f"""
set role service_role;
insert into private.place_import_runs(
  provider,window_start,window_end,fetched_count,status,checkpoint
) values (
  {sql_literal(provider)},
  {sql_literal(source_date)}::date,
  {sql_literal(source_date)}::date,
  {fetched_count},
  'running',
  {sql_literal(checkpoint)}::jsonb
)
returning id;
"""
    return int(run_psql(database_url, sql).splitlines()[-1])


def finish_run(database_url, run_id, status, promoted_count, checkpoint, error=None):
    sql = f"""
set role service_role;
update private.place_import_runs
set status={sql_literal(status)},
    promoted_count={int(promoted_count)},
    checkpoint={sql_literal(json.dumps(checkpoint, ensure_ascii=False, separators=(",", ":")))}::jsonb,
    error_message={sql_literal(error)},
    finished_at=now()
where id={int(run_id)};
"""
    run_psql(database_url, sql, tuples_only=False)


def promote(database_url, provider):
    sql = f"""
set role service_role;
select private.promote_place_imports({sql_literal(provider)});
"""
    return int(run_psql(database_url, sql).splitlines()[-1])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_jsonl", type=Path)
    parser.add_argument("--provider", default="sbiz")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--database-url-env", default="SUPABASE_DB_URL")
    parser.add_argument(
        "--psql-docker",
        metavar="CONTAINER",
        help="run psql inside this Docker container (e.g. supabase_db_onepick) when psql is not installed",
    )
    parser.add_argument(
        "--promote",
        action="store_true",
        help="promote staged rows to public.place_catalog after all batches succeed",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="validate JSONL and print the planned batch count without connecting",
    )
    args = parser.parse_args()

    global PSQL_DOCKER_CONTAINER
    PSQL_DOCKER_CONTAINER = args.psql_docker

    if not 1 <= args.batch_size <= MAX_BATCH:
        raise SystemExit(f"--batch-size must be between 1 and {MAX_BATCH}")

    rows, source_updated_at = parse_jsonl(args.input_jsonl, args.provider)
    batches = [
        rows[i : i + args.batch_size] for i in range(0, len(rows), args.batch_size)
    ]
    if args.dry_run:
        print(
            json.dumps(
                {
                    "provider": args.provider,
                    "source_updated_at": source_updated_at,
                    "rows": len(rows),
                    "batches": len(batches),
                    "promote": args.promote,
                },
                ensure_ascii=False,
            )
        )
        return

    database_url = os.environ.get(args.database_url_env)
    if not database_url:
        raise SystemExit(
            f"{args.database_url_env} must contain the Supabase database connection URL"
        )
    libpq_env(database_url)  # fail fast on a malformed URL before creating a run row

    run_id = create_run(
        database_url,
        args.provider,
        source_updated_at,
        len(rows),
        args.input_jsonl.name,
    )
    inserted = existing = promoted_count = 0
    try:
        for index, batch in enumerate(batches, start=1):
            result = stage_batch(database_url, args.provider, source_updated_at, batch)
            inserted += int(result["inserted_count"])
            existing += int(result["existing_count"])
            print(
                f"batch {index}/{len(batches)}: inserted={result['inserted_count']} "
                f"existing={result['existing_count']}",
                file=sys.stderr,
            )
        if args.promote:
            promoted_count = promote(database_url, args.provider)
        finish_run(
            database_url,
            run_id,
            "succeeded",
            promoted_count,
            {
                "phase": "promoted" if args.promote else "staged",
                "source_updated_at": source_updated_at,
                "input_count": len(rows),
                "inserted_count": inserted,
                "existing_count": existing,
                "batch_count": len(batches),
            },
        )
    except Exception as exc:
        try:
            finish_run(
                database_url,
                run_id,
                "failed",
                promoted_count,
                {
                    "phase": "failed",
                    "source_updated_at": source_updated_at,
                    "input_count": len(rows),
                    "inserted_count": inserted,
                    "existing_count": existing,
                },
                str(exc)[:1000],
            )
        except Exception:
            pass
        raise

    print(
        json.dumps(
            {
                "run_id": run_id,
                "provider": args.provider,
                "source_updated_at": source_updated_at,
                "input_count": len(rows),
                "inserted_count": inserted,
                "existing_count": existing,
                "promoted_count": promoted_count,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
