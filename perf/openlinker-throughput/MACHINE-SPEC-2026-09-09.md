# Machine specification — perf-programme-2840 (second machine)

Recorded: 2026-09-08T23:19:12Z

## Host
```
CPU(s):                               22
On-line CPU(s) list:                  0-21
Vendor ID:                            GenuineIntel
Model name:                           Intel(R) Core(TM) Ultra 7 155H
Thread(s) per core:                   2
Core(s) per socket:                   11
Socket(s):                            1
---
               total        used        free      shared  buff/cache   available
Mem:            15Gi       3.3Gi        10Gi       122Mi       2.3Gi        12Gi
Swap:          4.0Gi          0B       4.0Gi
---
Linux NORBERT-PRACA 5.15.167.4-microsoft-standard-WSL2 #1 SMP Tue Nov 5 00:21:55 UTC 2024 x86_64 x86_64 x86_64 GNU/Linux
---
Kernel note: this is WSL2 (Windows Subsystem for Linux 2) - a Hyper-V-backed VM, not bare metal. The physical host's true CPU is exposed to the guest via /proc/cpuinfo/lscpu, but disk and memory are virtualized through the WSL2 VM boundary.
```

## Disk
```
Filesystem      Size  Used Avail Use% Mounted on
/dev/sdc       1007G  132G  825G  14% /
NAME MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS
sda    8:0    0 388.4M  1 disk 
sdb    8:16   0     4G  0 disk [SWAP]
sdc    8:32   0     1T  0 disk /var/lib/docker
                               /mnt/wslg/distro
                               /
```

Disk type: `/sys/block/sdc/queue/rotational` reports `1` (rotational), scheduler `none`. **Not trusted as-is** — `sdc` is WSL2's virtual disk (a `.vhdx` on the Windows host), and virtualized block devices are known to misreport `rotational` regardless of the underlying physical media. The true physical disk type of the Windows host is not determinable from inside this guest. Reported here as measured, with this caveat, rather than asserted as SSD or HDD.

## Docker
```
Client: 27.5.0  Server: 27.5.0
Docker Compose version v2.32.4
```

## Node / pnpm (host, used to build ol-perf images)
```
v24.14.1
10.33.4
```
