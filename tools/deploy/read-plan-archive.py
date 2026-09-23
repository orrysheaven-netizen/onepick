"""Read one bounded plan.json from stdin ZIP bytes; never extract files."""
import io
import sys
import zipfile

LIMIT = 1024 * 1024
try:
    data = sys.stdin.buffer.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ValueError()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files = archive.infolist()
        if len(files) != 1:
            raise ValueError()
        entry = files[0]
        if entry.filename != "plan.json" or entry.is_dir() or entry.flag_bits & 1:
            raise ValueError()
        if entry.file_size > LIMIT or entry.compress_size > LIMIT:
            raise ValueError()
        content = archive.read(entry)
        content.decode("utf-8", errors="strict")
        sys.stdout.buffer.write(content)
except Exception:
    sys.stderr.write("Invalid deployment plan archive\n")
    sys.exit(1)
