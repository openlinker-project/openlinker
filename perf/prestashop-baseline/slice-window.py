#!/usr/bin/env python3
"""Cut an access-log capture down to one run's window.

`docker logs --since` was handed a UTC timestamp while the daemon reads a bare
timestamp as ITS OWN local time, so a capture covers far more than the run.
The container's clock also runs at a different offset to the host's. Rather
than trust either, this slices on the Apache timestamp the log itself carries.

Usage: slice-window.py <log> <start HH:MM:SS> <end HH:MM:SS>   (container clock)
"""
import sys, re

log, start, end = sys.argv[1], sys.argv[2], sys.argv[3]
TS = re.compile(r'\[\d{2}/\w{3}/\d{4}:(\d{2}:\d{2}:\d{2})')
for line in open(log, encoding='utf-8', errors='replace'):
    m = TS.search(line)
    if m and start <= m.group(1) <= end:
        sys.stdout.write(line)
