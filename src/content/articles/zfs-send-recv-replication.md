---
title: "ZFS Send/Recv: Replicating Your Homelab"
description: "ZFS replication with send and recv. Snapshots, incremental streams, raw encrypted send, resumable transfers, and a pull-based cron script."
date: 2026-05-10
keywords: "ZFS, send, recv, replication, FreeBSD, backup, snapshots, OpenZFS, encrypted, incremental, homelab"
ogTitle: "ZFS Send/Recv: Replicating Your Homelab"
ogDescription: "ZFS replication done right, snapshots, incremental streams, raw encrypted send, and a real cron-based pull script."
badges: ["ZFS", "FreeBSD", "Backup", "Homelab"]
related: ["freebsd-jails-network", "freebsd-vs-linux-sre", "freebsd-pf-router", "why-i-run-nixos"]
---
## The Mental Model

A ZFS snapshot is a read-only point-in-time view of a dataset, almost free to create. A `zfs send` turns one snapshot (or the delta between two snapshots) into a binary stream on stdout. A `zfs recv` on the other end reconstructs that snapshot inside a destination pool. Pipe them together, possibly through SSH, and you have replication. That's it.

Everything else in this post, incrementals, raw send, resumable transfers, cron, is just operational polish on top of those three primitives.

## Snapshots First

```
$ zfs snapshot zroot/home@2026-05-03
$ zfs list -t snapshot
NAME                    USED  AVAIL  REFER  MOUNTPOINT
zroot/home@2026-05-03     0B      -   2.4G  -
```

Snapshots cost nothing until the data they refer to changes. The "USED" column is the size of blocks that *only this snapshot* still references, for a snapshot taken seconds ago of an idle dataset, that's zero.

## The Smallest Possible Send

```
# Local: copy one snapshot from one pool to another
$ zfs send zroot/home@2026-05-03 | zfs recv backup/home

# Remote: same idea, over SSH
$ zfs send zroot/home@2026-05-03 \
  | ssh backup-host zfs recv backup/home
```

On the receiving side, `backup/home` didn't exist before; ZFS creates it. On a subsequent run with the same destination, you'll need either an incremental (recommended) or `-F` to force a rollback (not recommended).

## Incrementals Are Where the Win Lives

After the initial full send, you only ever want to send the delta between snapshots:

```
$ zfs snapshot zroot/home@2026-05-04
$ zfs send -i @2026-05-03 zroot/home@2026-05-04 \
  | ssh backup-host zfs recv backup/home
```

`-i @prev new` sends the changes between two named snapshots. `-I @prev new` (capital I) sends every snapshot in the chain, which is what you want for daily snapshots so the backup pool also has all the intermediate points.

## Encrypted Datasets: Raw Send

If your source dataset is encrypted (`encryption=on`), you almost certainly want `-w` (raw mode). It sends the encrypted blocks verbatim, the receiver never needs the key:

```
$ zfs send -w -i @prev zroot/home@new \
  | ssh backup-host zfs recv backup/home
```

The backup pool stores ciphertext. If the backup host is compromised, the attacker gets blocks they can't read. If you ever need the data, mount the dataset on the backup host with the key, and only then.

## Resumable Transfers

Sending 4 TB over a residential uplink and the SSH session drops at 3.7 TB? ZFS has you covered. The receiver leaves a resume token behind:

```
# On the receiver
$ zfs get -H -o value receive_resume_token backup/home
1-...long-token...

# Resume from the source
$ zfs send -t 1-...long-token... | ssh backup-host zfs recv -s backup/home
```

The `-s` flag on `recv` on the original transfer is what makes resumability work, set it from the start and you never lose progress.

## A Real Pull-Based Cron Script

I prefer pull replication: the backup host reaches into the source over SSH instead of the source pushing. If the source is compromised, it can't delete the backups. If the backup is compromised, it can't write to the source. Both sides have the smaller blast radius.

```
#!/bin/sh
# /usr/local/sbin/zfs-pull.sh, runs on the backup host
set -eu

SRC_HOST="homefw"
SRC_DS="zroot/home"
DST_DS="backup/home"

# Make a new snapshot on the source
SNAP=$(date +%Y%m%d-%H%M)
ssh "$SRC_HOST" "zfs snapshot ${SRC_DS}@${SNAP}"

# Find the latest snapshot we already have on the destination
PREV=$(zfs list -H -o name -t snapshot -s creation -r "$DST_DS" \
  | awk -F@ '{print $2}' | tail -n1)

if [ -z "$PREV" ]; then
  # First run, full send
  ssh "$SRC_HOST" "zfs send -wc ${SRC_DS}@${SNAP}" \
    | zfs recv -s "$DST_DS"
else
  # Incremental from the last snapshot we know about
  ssh "$SRC_HOST" "zfs send -wc -I @${PREV} ${SRC_DS}@${SNAP}" \
    | zfs recv -s "$DST_DS"
fi

# Prune snapshots older than 30 days on the destination
zfs list -H -o name -t snapshot -r "$DST_DS" \
  | while read -r snap; do
      ts=$(echo "$snap" | awk -F@ '{print $2}' | cut -c1-8)
      cutoff=$(date -v-30d +%Y%m%d 2>/dev/null || date -d '30 days ago' +%Y%m%d)
      if [ "$ts" -lt "$cutoff" ]; then
        zfs destroy "$snap"
      fi
    done
```

Throw it in `cron` on the backup host, four times a day:

```
# /etc/crontab on the backup host
0 */6 * * * root /usr/local/sbin/zfs-pull.sh >> /var/log/zfs-pull.log 2>&1
```

## Bandwidth and Compression

The `-c` flag (lowercase) on `send` emits compressed records as-is when the source dataset has compression enabled. It saves bandwidth and CPU on both ends, strictly better than re-compressing after the fact.

If your source dataset is *not* compressed but your link is slow, pipe through `zstd`:

```
zfs send ... | zstd -3 | ssh backup zstd -d \| zfs recv backup/home
```

For most homelabs the bottleneck is the WAN uplink, not CPU.

## Verifying the Backup

Three habits, in order of strictness:

1.  **Compare snapshot lists.** `zfs list -t snapshot -r backup/home` on the destination should include the snapshot the source just created. Trivial to script as a cron-based alert.
2.  **Periodic scrub.** `zpool scrub backup` verifies every block's checksum. Schedule it monthly. Set up email on errors.
3.  **Restore drill.** Twice a year, mount a snapshot from the backup pool on a fresh host and confirm the files are there. Backups you never restore from aren't backups.

## Restoring

The reverse direction works the same:

```
# From the backup host, send the latest snapshot back
$ zfs send backup/home@2026-05-03 | ssh source-host zfs recv -F zroot/home

# Or roll back in place from a local snapshot if the source pool still has it
$ zfs rollback zroot/home@2026-05-03
```

`-F` on the receiving side forces a rollback of the destination to match the incoming stream. Use it deliberately, it discards anything newer on the destination.

## Common Gotchas

-   **Holds.** If you can't destroy a snapshot, check `zfs holds`. Some tools place holds; pyznap, sanoid, and half-finished receives are common offenders.
-   **Mountpoints on the destination.** Set `canmount=noauto` on the destination dataset so an in-progress backup doesn't accidentally mount over something on the backup host.
-   **Receive permissions over SSH.** If you don't want to use root SSH, use `zfs allow` to delegate `create,mount, receive,destroy,snapshot` to a dedicated user on each side.
-   **Network at 0 bytes/sec.** A long initial replication can look hung. Use `pv` in the pipeline (`... | pv | ...`) to see actual throughput. `zfs send -v` on the source also prints progress.
-   **Different ZFS versions.** Newer source features (e.g. raidz expansion metadata, new compression algorithms) can produce streams the older receiver can't import. Keep both ends roughly in sync.

## Why This Matters

Most "backup" setups are really just snapshots on the same physical device. ZFS snapshots are wonderful, but they don't help when the disk dies, the building burns, or someone runs `zpool destroy` at the wrong shell. Send/recv to a separate pool, ideally on a separate machine in a separate location, is the difference between "I have backups" and "I had backups, theoretically".

## Where to Go Next

-   [Building a FreeBSD pf Router](freebsd-pf-router): context for the homelab this backs up
-   [FreeBSD Jails for Network Services](freebsd-jails-network): one ZFS dataset per jail; replication becomes per-jail
-   [FreeBSD vs Linux: An SRE's Take](freebsd-vs-linux-sre): why ZFS being first-class on FreeBSD changes how you think about storage

Replicating your own pools? [I'd love to compare scripts](../contact). Everyone writes their own zfs-pull.sh; everyone learns something from someone else's.
