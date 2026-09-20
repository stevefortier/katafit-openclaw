"""Exercise the real native configure hidden prompt in a POSIX PTY.

Only a hard-coded synthetic credential is used; never passed in child argv.
"""
import os
import pty
import select
import subprocess
import sys
import time

node, host, mode = sys.argv[1:]
master, slave = pty.openpty()
proc = subprocess.Popen([node, host, 'katafit', 'configure'], stdin=slave,
                        stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
output = b''
sent = False
secret = b'synthetic-test-token'
try:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if not chunk:
                break
            output += chunk
            if not sent and b'(hidden): ' in output:
                os.write(master, b'\x03' if mode == 'cancel' else secret + b'\r')
                sent = True
        if proc.poll() is not None:
            break
    proc.wait(timeout=5)
    assert sent, 'hidden prompt was never shown'
    assert secret not in output, 'hidden credential echoed'
    if mode == 'cancel':
        assert proc.returncode != 0, 'cancel must not succeed'
        assert b'Setup cancelled' in output, output.decode(errors='replace')
    else:
        assert proc.returncode == 0, output.decode(errors='replace')
        assert b'Credential configured privately' in output
    print('PASS: native hidden prompt ' + mode + '; no credential echo')
finally:
    if proc.poll() is None:
        proc.kill()
        proc.wait()
    os.close(master)
