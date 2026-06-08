---
title: "FreeBSD Jails for Network Services"
description: "Using FreeBSD jails to isolate DNS, monitoring, and VPN on a single router. VNET vs shared networking, ZFS datasets, jail.conf, and pf integration."
date: 2026-05-10
keywords: "FreeBSD, jails, jail.conf, VNET, networking, isolation, unbound, WireGuard, pf, ZFS"
ogTitle: "FreeBSD Jails for Network Services"
ogDescription: "Run DNS, monitoring, and VPN inside FreeBSD jails on the same box as your router, without giving up isolation."
badges: ["FreeBSD", "Jails", "VNET", "Networking"]
related: ["freebsd-pf-router", "pf-firewall-rules", "zfs-send-recv-replication", "freebsd-vs-linux-sre"]
---
## Jails, in One Paragraph

A FreeBSD jail is a partition of the kernel's userspace: its own filesystem root, its own process list, its own networking surface. There's no separate kernel, because there's only ever one kernel. From the outside it looks like a tiny machine you can `jexec` into; from the inside it looks like FreeBSD, because it is FreeBSD. Jails predate Docker by a long time, and on a router they do exactly what Docker is constantly trying to be, small, boring, and obviously correct.

## Why Bother on a Router?

Most homelab routers run a handful of services next to packet forwarding: a DNS resolver, a DHCP server, an NTP daemon, sometimes a monitoring agent or a WireGuard endpoint. Running them on the host works, but it conflates concerns: a panic in unbound can take the whole router with it, and the host's `/usr/local/etc` turns into a rats' nest of unrelated configs.

Putting each service in its own jail gives you four cheap wins:

-   **Independent restarts.** Reload unbound by restarting one jail.
-   **Per-service filesystems.** One ZFS dataset per jail, snapshot and rollback at the granularity that matters.
-   **Independent network identities.** With VNET, each jail sees its own `ifconfig`, routes, and pf state.
-   **Honest config sprawl.** Each jail's config lives in its own tree. You can blow it away without affecting anything else.

## VNET vs Shared Networking

Jails come with two networking models:

-   **Shared IP** (the default): the jail uses the host's network stack and is restricted to specific IP addresses on the host's interfaces. Cheap, fast, no kernel options required, but the jail can't run its own firewall or modify its own routing table.
-   **VNET** (virtualised network stack): the jail gets its own network stack, its own interfaces, its own routes, its own pf state. It costs you a kernel option (`options VIMAGE`, on by default in 15.x `GENERIC`) and a tiny bit more memory per jail, and it gives you near-VM isolation at near-jail cost.

For network services on a router, VNET is the right default. The host's pf ruleset stays clean, and the jail's own firewall (if it has one) can be as loose or strict as the service needs.

## ZFS Layout

One dataset per jail, mounted at `/jails/<name>`:

```
$ zfs create -o mountpoint=/jails zroot/jails
$ zfs create zroot/jails/unbound
$ zfs create zroot/jails/wireguard
$ zfs create zroot/jails/monitor
```

Now `zfs snapshot zroot/jails/unbound@before-upgrade` is a free rollback before any change. This habit alone has saved me from at least three late-night oh-no moments.

## Bootstrapping the Filesystem

Drop a base userland into each jail. The lazy way:

```
$ fetch https://download.freebsd.org/releases/amd64/15.0-RELEASE/base.txz
$ tar -C /jails/unbound -xpf base.txz
$ cp /etc/resolv.conf /jails/unbound/etc/
$ cp /etc/localtime   /jails/unbound/etc/
```

For real life, `iocage` and `bastille` wrap this nicely. Both are good; I lean on `bastille` on newer hosts because it's a thin shell layer with no daemon, and it stays out of my way.

## jail.conf: One File, All the Jails

```
# /etc/jail.conf

# defaults applied to every jail unless overridden
exec.start  = "/bin/sh /etc/rc";
exec.stop   = "/bin/sh /etc/rc.shutdown";
exec.clean;
mount.devfs;
allow.raw_sockets;
host.hostname = "$name";

# unbound, VNET jail with its own epair link to the LAN bridge
unbound {
  vnet;
  vnet.interface = "epair0b";
  exec.prestart  = "ifconfig epair0 create up; \
                    ifconfig bridge0 addm epair0a up; \
                    ifconfig epair0b vnet unbound";
  exec.poststop  = "ifconfig epair0a destroy";
  path           = "/jails/unbound";
  persist;
}

# wireguard, VNET jail, separate epair, on the WAN-facing bridge
wireguard {
  vnet;
  vnet.interface = "epair1b";
  exec.prestart  = "ifconfig epair1 create up; \
                    ifconfig bridge1 addm epair1a up; \
                    ifconfig epair1b vnet wireguard";
  exec.poststop  = "ifconfig epair1a destroy";
  path           = "/jails/wireguard";
  persist;
}
```

Each jail gets an `epair` pseudo-interface, a virtual back-to-back cable. One side stays in the host and joins a bridge that's connected to a real LAN; the other side moves into the jail's network namespace. Inside the jail, configure that interface like any other.

## Inside the unbound Jail

```
# /jails/unbound/etc/rc.conf
hostname="unbound.lan"
ifconfig_epair0b="inet 10.0.0.53/24"
defaultrouter="10.0.0.1"
local_unbound_enable="YES"
syslogd_flags="-ss"
```

Now the resolver listens on `10.0.0.53`, and the host's DHCP server hands that out to clients. The router itself is no longer a DNS resolver, that's a feature.

## pf and Jails Get Along

With VNET, the host's pf rules don't see traffic that stays inside a jail. They do see traffic that crosses bridges. A small addition to the [main ruleset](pf-firewall-rules) covers the new flow:

```
# Allow LAN clients to reach the unbound jail's IP on port 53
pass in on $lan_if proto { tcp udp } \
  from $lan_net to 10.0.0.53 port domain keep state

# Allow the unbound jail outbound to root servers
pass out on $ext_if from 10.0.0.53 to any port domain keep state
```

## Resource Limits

Jails will happily eat all the host's memory if you let them. `rctl(8)` is the answer:

```
# /etc/rctl.conf
jail:unbound:memoryuse:deny=512M
jail:unbound:maxproc:deny=64
jail:wireguard:memoryuse:deny=128M
jail:wireguard:maxproc:deny=32

# enable on boot
# /etc/rc.conf
rctl_enable="YES"
```

## Updating Jails

Each jail has its own copy of the base system. Updating one doesn't update the rest:

```
# Per-jail update
$ freebsd-update -b /jails/unbound fetch install

# Or, with bastille
$ bastille update unbound
```

Always snapshot first. Always.

## Daily Operations

```
$ jls               # list running jails
   JID  IP Address      Hostname              Path
     1  -               unbound.lan           /jails/unbound
     2  -               wireguard.lan         /jails/wireguard

$ jexec unbound /bin/sh                  # shell into a jail
$ service jail restart unbound           # restart one jail
$ service jail status                    # are they all up?
```

## Common Gotchas

-   **devfs rules.** By default a VNET jail can see far more of `/dev` than it needs. Use `devfs_ruleset = "4";` in jail.conf and the standard `devfsrules_jail` ruleset to lock it down.
-   **raw sockets.** If the service inside needs ping or traceroute, set `allow.raw_sockets;`. If not, leave it off.
-   **persistent jails vs ephemeral.** `persist;` keeps a jail up even if its main process dies, useful for jails managed by their own rc scripts. Without it, the jail exits when the start command exits.
-   **Boot ordering.** If a jail depends on a host bridge, make sure the bridge exists before the jail starts. `cloned_interfaces` in `/etc/rc.conf` handles this cleanly.

## When NOT to Use Jails

Jails are FreeBSD-specific. If you need to run a Linux-only binary, use a Linux VM or a bhyve guest, Linuxulator is a tar pit for this kind of work. If you need GPU acceleration, you'll usually be happier with a dedicated VM. And if you only have one service to run, a jail is overkill, just run it on the host.

## Bigger Picture

Once you have one service in a jail, the next ten get easier. The router's host OS shrinks back to: a kernel, pf, ssh, and the boot environment. Everything else becomes a small dataset, a small `jail.conf` stanza, and a small set of pf rules. The whole shape of the box becomes legible.

## Where to Go Next

-   [Building a FreeBSD pf Router](freebsd-pf-router): the host this all runs on
-   [pf.conf: Writing Rules That Survive a Power Outage](pf-firewall-rules): what to add when jails join the network
-   [FreeBSD vs Linux: An SRE's Take](freebsd-vs-linux-sre): context for why this is so much nicer than the Linux equivalent

Running services in jails of your own? [I'd love to compare notes](../contact).
