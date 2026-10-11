"""Read-only Git/TOML change detection; Python 3.11+, no dependencies."""
import argparse
import fnmatch
import os
import posixpath
import re
import subprocess
import tomllib


def git(*args):
    return subprocess.check_output(['git', *args]).decode('utf-8')


def paths(ref):
    return set(filter(None, git('ls-tree', '-r', '--name-only', '-z', ref).split('\0')))


def config(ref, files):
    if 'supabase/config.toml' not in files:
        return {}
    return tomllib.loads(git('show', f'{ref}:supabase/config.toml'))


def detect(changed, old_files, new_files, old_config, new_config):
    old_functions = old_config.get('functions', {})
    new_functions = new_config.get('functions', {})
    if not isinstance(old_functions, dict) or not isinstance(new_functions, dict):
        raise ValueError('functions must be a TOML table')
    all_slugs = set(old_functions) | set(new_functions)
    for path in old_files | new_files:
        parts = path.split('/')
        if len(parts) >= 4 and parts[:2] == ['supabase', 'functions'] and not parts[2].startswith('_'):
            all_slugs.add(parts[2])
    if any(not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', slug) for slug in all_slugs):
        raise ValueError('Invalid function slug; refusing ambiguous workflow output')
    selected = {slug for slug in set(old_functions) | set(new_functions)
                if old_functions.get(slug) != new_functions.get(slug)}
    # Global runtime changes affect all functions, unlike Storage/Auth/DB settings.
    if old_config.get('edge_runtime') != new_config.get('edge_runtime'):
        selected.update(all_slugs)
    for path in changed:
        parts = path.split('/')
        if parts[:2] == ['supabase', 'functions']:
            # Root dependency manifests and every private/shared directory are global.
            if len(parts) < 4 or parts[2].startswith('_'):
                selected.update(all_slugs)
            else:
                selected.add(parts[2])
    # Explicit deployment inputs may live outside the conventional slug folder.
    for functions in (old_functions, new_functions):
        for slug, settings in functions.items():
            if not isinstance(settings, dict):
                raise ValueError('Function configuration must be a table')
            inputs = [settings[key] for key in ('entrypoint', 'import_map') if key in settings]
            inputs.extend(settings.get('static_files', []))
            for value in inputs:
                if not isinstance(value, str):
                    raise ValueError('Function input paths must be strings')
                pattern = posixpath.normpath(posixpath.join('supabase', value))
                if any(fnmatch.fnmatchcase(path, pattern) for path in changed):
                    selected.add(slug)
    return sorted(selected)


def detect_range(before, head):
    # Resolve revisions before interpolating them into git object specifications.
    head = git('rev-parse', '--verify', f'{head}^{{commit}}').strip()
    new_files = paths(head)
    new_config = config(head, new_files)
    if not before or set(before) == {'0'}:
        parents = git('rev-list', '--parents', '-n', '1', head).split()[1:]
        before = parents[0] if parents else None
    if before:
        before = git('rev-parse', '--verify', f'{before}^{{commit}}').strip()
        old_files = paths(before)
        old_config = config(before, old_files)
        # No rename detection: both old and new paths must be checked.
        changed = set(filter(None, git('diff', '--no-renames', '--name-only', '-z', before, head).split('\0')))
    else:
        old_files, old_config, changed = set(), {}, new_files
    return detect(changed, old_files, new_files, old_config, new_config)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', default=os.environ.get('BEFORE_SHA', ''))
    parser.add_argument('--head', default=os.environ.get('GITHUB_SHA', 'HEAD'))
    args = parser.parse_args()
    # Invalid TOML / unavailable history fails the step, never emits an empty success.
    slugs = ','.join(detect_range(args.before, args.head))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
            output.write(f'slugs={slugs}\n')
    print(f'Changed Edge Functions: {slugs or "none"}')
