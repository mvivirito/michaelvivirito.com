---
title: "Backing Up My FreeBSD Firewall"
description: "How I back up a FreeBSD 15 router by putting its entire config under Git, without symlinks or etckeeper: a path-mirrored repo, a copy-deploy Makefile, a permissions manifest, validate-before-reload, and a Gitea-to-GitHub mirror."
date: 2026-06-28
keywords: "FreeBSD, pf, firewall, backup, git, version control, config management, Gitea, GitHub mirror, Makefile, GNU stow, chezmoi, etckeeper, PkgBase, boot environments, bectl, unbound, dhcpd, homelab"
ogTitle: "Backing Up My FreeBSD Firewall with Git"
ogDescription: "A path-mirrored Git repo, a copy-deploy Makefile, and a permissions manifest put a FreeBSD router's config under version control. Validate before reload, mirror Gitea to GitHub, update with PkgBase."
badges: ["FreeBSD", "Git", "Config Management", "pf", "Homelab"]
related: ["freebsd-pf-router", "pf-firewall-rules", "zfs-send-recv-replication", "why-i-run-nixos"]
---

## The /root Graveyard

Here is what `/root` looked like on my router before I came up with a proper backup solution:

```
pf.conf_bak_oldversion
pf.conf_bak_newversion
unbound.bak121825
unbound_bak.conf
dhcpd.conf.sample.orig
```

Each file was a moment I changed something and made a manual backup first. It is version control by hand, badly: no history, no diffs, and no way to tell which `pf.conf` backup actually booted.

A firewall is the worst place to do this. A bad edit doesn't throw an error, it just stops passing traffic, and you find out when the whole house loses the internet. So I put the entire config of my [FreeBSD pf router](freebsd-pf-router) into Git. The interesting part was deciding *how*.

## What Actually Needs Tracking

The router runs FreeBSD 15 on an N100 with a ZFS root. The set of config files you actually edit to turn a fresh FreeBSD install into a working router is pretty minimal:

-   `/etc/pf.conf`, `/etc/rc.conf`, `/etc/sysctl.conf` : the firewall, interfaces, kernel knobs
-   `/etc/ntp.conf`, `/etc/fstab`, `/etc/hosts`, `/etc/crontab`, `/etc/ssh/sshd_config`
-   `/boot/loader.conf`
-   `/usr/local/etc/unbound/` : resolver, ACLs, local zones, blocklist include
-   `/usr/local/etc/dhcpd.conf` : DHCP scopes and static leases
-   `/usr/local/etc/doas.conf` : the privilege policy
-   `/usr/local/sbin/update-*-blocklists.sh` : the scripts that refresh the blocklists

Everything else is a default, generated at runtime, or secret, and it stays out: SSH host keys, the DHCP lease database, the 3.5 MB blocklist the scripts build. If a script produces a file, the script goes in Git, not its output.

## Why Not Stow, Chezmoi, or etckeeper

I originally wanted to use [GNU Stow](https://www.gnu.org/software/stow/), since I already used it for my [dotfiles](https://github.com/mvivirito/dotfiles) in the past, but I did not like the idea of symlinking a firewall's config into place. So I looked at a few other options before settling on the custom Makefile described below. Stow, [chezmoi](https://www.chezmoi.io/), and [etckeeper](https://etckeeper.branchable.com/) are all excellent tools in their own right; none of them is quite the right fit for a firewall, and here is why.

**GNU Stow** symlinks files out of a repo into place. The moment `/etc/pf.conf` is a symlink into `/root/firewall-repo/...`, the repo checkout is load-bearing: blow it away, restore onto a fresh disk in the wrong order, or mount it late, and your firewall's core config is a dangling link. A router's config files should be *real files* that exist whether or not a repo does.

**Chezmoi** is a good dotfile manager, and it can run as root, but its model is "the repo is the source of truth and I render it into place." Pointing it at `/etc` means asking a tool built for `~/.config` to own the files that decide whether the box routes packets.

**etckeeper** is the closest fit, since it versions `/etc` in place and auto-commits on every `pkg` operation. I would have used it. It is not packaged for FreeBSD anymore; the port was retired. That settled it.

Each one misses in its own way: Stow leans on symlinks, chezmoi wants to render the files rather than store them, and etckeeper is not available on FreeBSD at all. None was worth bending to fit, so I built my own.

## The Approach

What I landed on is deliberately boring: a Git repo that holds a copy of every managed file, and a Makefile that deploys changes by copying them onto the system. Nothing is symlinked, nothing is templated. The repo is a staging area I review, and the Makefile is the only thing that moves a change from the repo onto the live box.

This is what fits a firewall. The running files stay real and independent of the repo, so the repo can be missing, unmounted, or a few commits ahead and the box still boots with valid configs. The next section shows how the repo is laid out, and the one after covers what the Makefile does.

## The Shape: A Repo That Mirrors the Filesystem

The repo is just a tree mirroring the absolute paths it manages:

```
homefw/
├── etc/
│   ├── pf.conf
│   ├── rc.conf
│   ├── sysctl.conf
│   └── ssh/sshd_config
├── boot/loader.conf
├── usr/local/etc/
│   ├── unbound/unbound.conf
│   ├── dhcpd.conf
│   └── doas.conf
├── usr/local/sbin/update-oisd-blocklists.sh
├── manifest.tsv
├── Makefile
└── README.md
```

`etc/pf.conf` maps to `/etc/pf.conf`. No symlinks, no templating, no magic: deploying is *copying*, and the repo is a staging area you review first.

A plain copy loses permissions, though. Git does not record owner, group, or the fact that `doas.conf` must be `0600` or doas refuses to run. So a `manifest.tsv` carries them:

```
# path                              mode  owner  group
etc/pf.conf                         0644  root   wheel
usr/local/etc/doas.conf             0600  root   wheel
usr/local/sbin/update-oisd-blocklists.sh  0755  root  wheel
```

The deploy step applies the manifest after copying. It is the piece Stow and etckeeper give you for free, and it doubles as documentation: one place that says exactly how every file should look on disk.

## The Makefile Is the Interface

I never run `cp` by hand. A Makefile wraps every operation:

```
make status     # what's deployed vs what's in the repo, per file
make diff       # full diff of live files against the repo
make check      # validate every config without touching anything
make install    # copy repo -> system, then apply manifest perms
make reload     # reload the services that changed
make capture    # pull live files back INTO the repo (for ad-hoc edits)
```

If you have only ever *run* a Makefile, the format is simpler than it looks: each entry is a **target**, an optional list of prerequisites that run first, and a tab-indented recipe of shell commands. Here are the two that matter most, straight from my Makefile:

```
check:
	@echo "== pf =="; pfctl -nf etc/pf.conf && echo "  pf.conf OK"
	@echo "== unbound =="; unbound-checkconf usr/local/etc/unbound/unbound.conf && echo "  unbound OK"
	@echo "== dhcpd =="; dhcpd -t -cf usr/local/etc/dhcpd.conf && echo "  dhcpd OK"

reload: check
	@echo "reloading services..."; \
	service pf reload && echo "  pf reloaded"; \
	service unbound reload && echo "  unbound reloaded"; \
	service isc-dhcpd restart && echo "  isc-dhcpd restarted"
```

`check` runs each daemon's own validator against the repo copy: `pfctl -nf` parses the firewall rules without loading them, `unbound-checkconf` checks the resolver, `dhcpd -t` tests DHCP. Each one is its own recipe line on purpose, so Make stops at the first that fails. It only reports; nothing is touched.

`reload` names `check` as a **prerequisite** (that is what `reload: check` means), so `make reload` runs `check` first and proceeds only if every config is valid. Then it reloads each service in turn, with isc-dhcpd getting a restart because it does not reload gracefully. One typo anywhere fails `check`, and not a single service is bounced.

Two syntax notes: a leading `@` stops Make from printing the command before it runs, and a trailing `\` continues a recipe onto the next line as one shell command (which is why `reload`'s services share a line while `check`'s validators each stand alone). New to Make? [makefiletutorial.com](https://makefiletutorial.com/) is a friendly primer.

`make diff` answers "did I change something on the box and forget to commit it," which is always eventually yes. `make capture` is the escape hatch: when I edit `/etc/pf.conf` in place at 1am like a normal person, it pulls the live file back into the repo so the next commit matches reality instead of fighting it.

## Validate Before You Reload

The most valuable habit here is that reloading validates first: `make reload` runs `make check` and bails before it touches a running service if any config is invalid. FreeBSD ships the validators for free:

```
pfctl -nf /etc/pf.conf           # parse pf rules, don't load them
unbound-checkconf                # validate the resolver config
dhcpd -t -cf /usr/local/etc/dhcpd.conf   # test the DHCP config
sshd -t                          # test sshd_config
```

`pfctl -n` is the hero: it parses the ruleset and reports errors without loading it, so a typo becomes a message on your terminal instead of a router you can't SSH into. Reloading a firewall you haven't dry-run is a coin flip, and the losing side is the whole house asking why the internet is down.

## Two Remotes: Gitea First, GitHub for the 3am Scenario

The repo pushes to my self-hosted [Gitea](https://about.gitea.com/), where my private code lives. But a firewall repo has a specific problem: **Gitea lives behind the firewall.** If the router is down badly enough that I am restoring from Git, the Git server may be just as unreachable.

So Gitea is primary and push-mirrors to a private GitHub repo. The firewall only talks to Gitea on the LAN; Gitea forwards each commit to GitHub on a hook. No GitHub credentials touch the router, and the off-site copy stays reachable even when the whole homelab, Gitea included, is down, which is exactly when I need it.

```
homefw  ──push──►  Gitea (LAN, private)  ──mirror──►  GitHub (off-site, private)
```

## Backing Up the System, Not Just the Config

The repo backs up the config I write. It does nothing for the rest of the box, the base OS and the installed packages, which also change every time I update. ZFS boot environments cover that half.

FreeBSD now ships **PkgBase**, with the base system, kernel and userland, delivered as regular packages instead of a separate monolithic blob, so a single `pkg upgrade` moves the whole system at once. That is the moment to take a snapshot. Before any upgrade I clone a boot environment, and if a new kernel misbehaves I pick the old one at the loader and reboot into a known-good system:

```
bectl create pre-upgrade-2026-06-28
pkg upgrade
# misbehaves? select the old BE at the loader and reboot
```

Between the two, the firewall is fully recoverable: the repo restores the config I wrote, and a boot environment restores the system I didn't. More on PkgBase in the [FreeBSD wiki](https://wiki.freebsd.org/PkgBase).

## The Payoff

The firewall is now reproducible. Every change is a reviewed diff, rolling back is `git revert` and `make install`, and rebuilding on fresh hardware is a clone, a `make install`, and a reboot.

Want a closer look at any piece, the Makefile, the pf ruleset, the boot environments? Say so in the comments or [drop me a line](../contact), and I will write it up.

## Next Steps

-   [Building a FreeBSD pf Router behind XGS-PON](freebsd-pf-router): the box this config runs on
-   [pf.conf: Writing Rules That Survive a Power Outage](pf-firewall-rules): the ruleset that lives in this repo
-   [ZFS send/recv Replication](zfs-send-recv-replication): the other half of "I can rebuild this"

Thanks for reading.
