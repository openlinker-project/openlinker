# Measurement host specification - `epyc32`

_Captured 2026-09-08T11:02:45Z, before any measurement. Cited by every
`results-*-epyc32.md` in this directory._

This campaign's figures are **machine-bound**. Any comparison against the
reference host's numbers (a 28-thread / 15 GB machine, the `results-*-2026-09-05`
through `results-*-2026-09-08.md` files here) must carry both specs.

## Identity

| | |
|---|---|
| Hostname | `silksh-openlinker-openlinker-perftest-01` |
| Role | Dedicated perf stand. Nothing else runs on it. |
| Host tag used in filenames | `epyc32` |

## CPU

| | |
|---|---|
| Model | AMD EPYC-Milan Processor (family 25, model 1, stepping 1) |
| Sockets / cores / threads | 1 / 16 / **32** |
| Threads per core | 2 (SMT on) |
| BogoMIPS | 4799.99 |
| L1d / L1i | 512 KiB each (16 instances) |
| L2 / L3 | 8 MiB (16 inst.) / 32 MiB (1 inst.) |
| NUMA nodes | 1 (node0 = CPUs 0-31) |
| Virtualisation | **KVM guest, full virtualisation** - not bare metal |

## Memory

| | |
|---|---|
| MemTotal | 128 805 664 kB = **122 GiB** |
| Swap | **0 B** (none configured) |

## Disk

| | |
|---|---|
| Root filesystem | `/dev/sda1`, ext4, 564 G total, 538 G available at start |
| Device | QEMU HARDDISK, 572.2 G, `ROTA=0` -> non-rotational (SSD/NVMe-backed virtual disk) |
| Docker data-root | on the same `/dev/sda1` filesystem |

## Kernel and OS

| | |
|---|---|
| Kernel | `6.12.101+deb13-cloud-amd64` (SMP PREEMPT_DYNAMIC, Debian 6.12.101-1, 2026-08-05) |
| Distribution | Debian GNU/Linux 13 (trixie) |
| Arch | x86_64 |

## Toolchain

| Tool | Version | Note |
|---|---|---|
| Docker Engine | 29.8.0 (client + server), containerd v2.3.4 | community build |
| Docker Compose | v5.5.1 | |
| Node | **v24.20.0** | Brief asked for 22 LTS; repo `engines` is `>=22.0.0`, so v24 satisfies it. Deviation recorded rather than silently accepted. |
| pnpm | 10.33.4 | `engines` requires `>=10.0.0` |
| k6 | **v1.3.0** | Installed for this campaign (was absent). `~/.local/bin/k6`, static release binary, go1.25.1. Harness runs k6 in the `grafana/k6:1.0.0` **container** for scenarios; the host binary is a fallback/inspection tool. |
| jq | **1.7.1** | Installed for this campaign (was absent). `~/.local/bin/jq`, static release binary. |
| curl | 8.14.1 | |
| git | repo at `perf-programme-2840` @ `4ff884d8eadb9ea90c97f2ea5bcb7aef2a61f8df` (verified equal to `origin` tip) |

## Notable differences from the reference host

| Axis | Reference host | This host (`epyc32`) |
|---|---|---|
| Threads | 28 | 32 |
| RAM | 15 GB | 122 GiB |
| Swap | not stated | none |

The RAM difference is large enough that any figure sensitive to page-cache
residency (Postgres reads over the 1M-order dataset above all) is **not**
comparable across the two hosts without saying so. 122 GiB comfortably holds
the whole seeded database in cache; 15 GB may not.

## Caveats that bound every figure taken here

1. **KVM guest, not bare metal.** Steal time and host contention are not
   observable from inside. No `cpuset` pinning is applied by the lab compose
   file either, so container-to-container CPU contention is real and is part
   of what is measured.
2. **No swap.** A memory-pressure failure here is an OOM kill, not a slowdown.
3. **Docker 29.8.0.** The `docker logs --since "@$epoch"` defect the campaign
   already recorded (accepted without error, returns nothing) was verified on
   29.5.2; this host runs a later 29.x. Re-verified here - see
   `docker-logs-since-probe-epyc32-2026-09-08.txt`.
