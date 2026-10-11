import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import tomllib
import unittest

SCRIPT = Path(__file__).with_name('detect-edge-function-changes.py').resolve()
spec = importlib.util.spec_from_file_location('detector', SCRIPT)
detector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(detector)


class DetectionTests(unittest.TestCase):
    files = {'supabase/functions/alpha/index.ts', 'supabase/functions/beta/index.ts'}
    base = '[functions.alpha]\nverify_jwt = true\n[functions.beta]\nverify_jwt = false\n'

    def check(self, changed=(), old=None, new=None, old_files=None, new_files=None):
        return detector.detect(set(changed), self.files if old_files is None else old_files,
                               self.files if new_files is None else new_files,
                               tomllib.loads(self.base if old is None else old),
                               tomllib.loads(self.base if new is None else new))

    def test_storage_only(self):
        self.assertEqual(self.check(['supabase/config.toml'], new=self.base +
                         '[storage.buckets.profile-avatars]\npublic=true\nfile_size_limit="512KiB"\n'), [])

    def test_comments_formatting_and_non_function_settings(self):
        text = '# changed\n[auth]\nenabled=true\n[db]\nport=54322\n' + self.base.replace(' = ', '=')
        self.assertEqual(self.check(['supabase/config.toml'], new=text), [])

    def test_jwt_and_mixed_storage_change(self):
        text = self.base.replace('verify_jwt = true', 'verify_jwt = false') + '[storage]\nenabled=true\n'
        self.assertEqual(self.check(['supabase/config.toml'], new=text), ['alpha'])

    def test_added_removed_function_and_keys(self):
        for key in ['entrypoint="./custom.ts"', 'import_map="./imports.json"', 'enabled=false', 'future_setting=true']:
            text = self.base.replace('[functions.beta]', key + '\n[functions.beta]')
            with self.subTest(key=key):
                self.assertEqual(self.check(new=text), ['alpha'])
                self.assertEqual(self.check(old=text), ['alpha'])
        self.assertEqual(self.check(new=self.base+'[functions.gamma]\nverify_jwt=false\n'), ['gamma'])
        self.assertEqual(self.check(new='[functions.beta]\nverify_jwt=false\n'), ['alpha'])

    def test_quoted_and_inline_tables(self):
        self.assertEqual(self.check(new='functions = { alpha = { verify_jwt = true }, beta = { verify_jwt = false } }'), [])
        self.assertEqual(self.check(new=self.base.replace('functions.alpha', 'functions."alpha"')), [])

    def test_source_add_modify_delete_rename(self):
        for path in ['supabase/functions/alpha/index.ts', 'supabase/functions/alpha/deno.json']:
            self.assertEqual(self.check([path]), ['alpha'])
        self.assertEqual(self.check(['supabase/functions/alpha/index.ts', 'supabase/functions/gamma/index.ts']), ['alpha', 'gamma'])
        self.assertEqual(self.check(['supabase/functions/alpha/index.ts'], new_files=set()), ['alpha'])

    def test_shared_root_dependencies_and_runtime(self):
        for path in ['supabase/functions/_shared/auth.ts', 'supabase/functions/_internal/x.ts',
                     'supabase/functions/deno.json', 'supabase/functions/deno.lock', 'supabase/functions/import_map.json']:
            self.assertEqual(self.check([path]), ['alpha', 'beta'])
        self.assertEqual(self.check(new=self.base+'[edge_runtime]\nenabled=true\n'), ['alpha', 'beta'])

    def test_external_explicit_inputs(self):
        for key, changed in [('entrypoint="../custom/index.ts"', 'custom/index.ts'),
                             ('import_map="./imports.json"', 'supabase/imports.json'),
                             ('static_files=["./assets/**"]', 'supabase/assets/a/b.html')]:
            text = self.base.replace('[functions.beta]', key+'\n[functions.beta]')
            self.assertEqual(self.check([changed], old=text, new=text), ['alpha'])

    def test_unrelated(self):
        self.assertEqual(self.check(['mobile/src/app.tsx', 'supabase/migrations/x.sql']), [])

    def test_invalid_function_structure(self):
        with self.assertRaises(ValueError):
            self.check(new='functions="invalid"')


class GitIntegrationTests(unittest.TestCase):
    def test_real_git_ranges_and_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args], stderr=subprocess.PIPE).decode().strip()
            def write(path, text):
                target = root/path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(text)
            def commit():
                git('add', '.')
                git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
                return git('rev-parse', 'HEAD')
            def run(before=''):
                env = {**os.environ, 'GITHUB_OUTPUT': str(root/'output')}
                return subprocess.run(['python3', str(SCRIPT), '--before', before, '--head', 'HEAD'], cwd=root,
                                      env=env, capture_output=True, text=True)
            git('init', '-q')
            write('supabase/config.toml', DetectionTests.base)
            write('supabase/functions/alpha/index.ts', 'export {};')
            first = commit()
            self.assertIn('alpha,beta', run().stdout)  # initial commit
            write('supabase/config.toml', DetectionTests.base+'[storage]\nenabled=true\n')
            storage = commit()
            self.assertIn('none', run(first).stdout)
            self.assertIn('slugs=\n', (root/'output').read_text())
            write('supabase/functions/alpha/index.ts', 'export const x = 1;')
            commit()
            write('unrelated.txt', 'later commit')
            commit()
            self.assertIn('alpha', run(storage).stdout)  # exact multi-commit range
            self.assertIn('none', run().stdout)  # manual run: first parent
            self.assertNotEqual(run('f'*40).returncode, 0)  # unavailable base
            (root/'output').unlink()
            write('supabase/config.toml', '[invalid')
            commit()
            self.assertNotEqual(run().returncode, 0)
            self.assertFalse((root/'output').exists())  # no empty successful output


if __name__ == '__main__':
    unittest.main()
