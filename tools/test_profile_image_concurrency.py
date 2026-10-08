"""Real two-session RLS tests, only against a running local Supabase Docker DB.

No remote DSN or credentials accepted. Fixtures are metadata only; never use
direct storage.objects deletion against production/backing Storage objects.
"""
import concurrent.futures
import queue
import subprocess
import threading
import time
import uuid


def main():
    names = subprocess.check_output(
        ['docker', 'ps', '--format', '{{.Names}}'], text=True).splitlines()
    names = [name for name in names if name.startswith('supabase_db_')]
    if len(names) != 1:
        raise RuntimeError('Expected exactly one local Supabase Docker database')
    command = ['docker', 'exec', '-i', names[0], 'psql', '-X', '-qAt',
               '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
               '-v', 'VERBOSITY=verbose']
    actor = str(uuid.uuid4())
    app = 'profile_race_' + uuid.uuid4().hex
    holders = []

    def sql(statement, check=True):
        result = subprocess.run(command, input=statement, text=True,
                                capture_output=True, timeout=30)
        if check and result.returncode:
            raise AssertionError(result.stderr)
        return result

    def auth():
        return ("begin; set local statement_timeout='20s'; "
                "set local storage.allow_delete_query='true'; "
                "set local request.jwt.claims='{\"aal\":\"aal1\"}'; "
                f"set local request.jwt.claim.sub='{actor}'; "
                'set local role authenticated; ')

    def image(n):
        return f'{actor}/00000000-0000-4000-8000-{n:012d}.jpg'

    def insert(n):
        return ("insert into storage.objects(bucket_id,name,owner_id) values "
                f"('profile-images','{image(n)}','{actor}');")

    def choose(n):
        return f"select public.set_profile_image('{image(n)}');"

    def delete(n):
        return ("with removed as (delete from storage.objects "
                f"where bucket_id='profile-images' and name='{image(n)}' returning 1) "
                'select count(*) from removed;')

    def holder(statement):
        process = subprocess.Popen(command, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True)
        holders.append(process)
        lines = queue.Queue()

        def read_lines():
            for line in process.stdout:
                lines.put(line.strip())
            lines.put('EOF')

        threading.Thread(target=read_lines, daemon=True).start()
        process.stdin.write(auth() + statement + '\n\\echo HELD\n')
        process.stdin.flush()
        deadline = time.monotonic() + 25
        while True:
            line = lines.get(timeout=max(.01, deadline - time.monotonic()))
            if line == 'HELD':
                return process
            if line == 'EOF':
                raise AssertionError(process.stderr.read())

    def release(process):
        process.stdin.write('commit;\n\\quit\n')
        process.stdin.flush()
        process.stdin.close()
        process.wait(timeout=25)
        assert process.returncode == 0, process.stderr.read()

    def race(first, second, expected_error=None, expected_output=None):
        process = holder(first)
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql,
                                 f"set application_name='{app}'; " + auth() + second + 'commit;',
                                 False)
            try:
                deadline = time.monotonic() + 10
                while True:
                    waiting = sql("select count(*) from pg_stat_activity "
                                  f"where application_name='{app}' "
                                  "and wait_event_type='Lock' and wait_event='advisory';").stdout.strip()
                    if waiting == '1':
                        break
                    if future.done() or time.monotonic() > deadline:
                        raise AssertionError('Second session did not block on the advisory lock')
                    time.sleep(.1)
            finally:
                release(process)
            result = future.result(timeout=25)
        if expected_error:
            assert result.returncode != 0 and expected_error in result.stderr, result
        else:
            assert result.returncode == 0, result.stderr
            if expected_output is not None:
                assert result.stdout.strip() == expected_output, result.stdout

    def reset_objects(count):
        sql("begin; set local storage.allow_delete_query='true'; "
            f"update public.profiles set profile_image_url=null where id='{actor}'; "
            f"delete from storage.objects where bucket_id='profile-images' and owner_id='{actor}'; "
            + ''.join(insert(n) for n in range(1, count + 1)) + 'commit;')

    try:
        sql("begin; insert into auth.users(id,aud,role,created_at,updated_at) "
            f"values ('{actor}','authenticated','authenticated',now(),now()); "
            "insert into public.profiles(id,username,onboarding_completed) "
            f"values ('{actor}','race_{uuid.uuid4().hex[:12]}',true); commit;")
        reset_objects(19)
        race(insert(20), insert(21), expected_error='42501')
        assert sql("select count(*) from storage.objects "
                   f"where bucket_id='profile-images' and owner_id='{actor}';").stdout.strip() == '20'
        print('PASS: two sessions at 19 objects admit one upload, reject the other', flush=True)

        reset_objects(2)
        race(choose(2), delete(2), expected_output='0')
        assert sql(f"select profile_image_url from public.profiles where id='{actor}';").stdout.strip() == image(2)
        assert sql("select count(*) from storage.objects "
                   f"where bucket_id='profile-images' and name='{image(2)}';").stdout.strip() == '1'
        print('PASS: selecting first protects the photo from concurrent deletion', flush=True)

        reset_objects(2)
        race(delete(2), choose(2), expected_error='PROFILE_IMAGE_NOT_FOUND')
        assert sql("select count(*) from storage.objects "
                   f"where bucket_id='profile-images' and name='{image(2)}';").stdout.strip() == '0'
        assert sql(f"select profile_image_url is null from public.profiles where id='{actor}';").stdout.strip() == 't'
        print('PASS: deleting first prevents selecting a removed photo', flush=True)
    finally:
        for process in holders:
            if process.poll() is None:
                process.stdin.write('rollback;\n\\quit\n')
                process.stdin.flush()
                process.wait(timeout=25)
        sql("begin; set local storage.allow_delete_query='true'; "
            f"update public.profiles set profile_image_url=null where id='{actor}'; "
            f"delete from storage.objects where bucket_id='profile-images' and owner_id='{actor}'; "
            f"delete from auth.users where id='{actor}'; commit;")


if __name__ == '__main__':
    main()
