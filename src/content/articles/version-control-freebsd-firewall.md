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

Here is what `/root` looked like on my router before I fixed this:

```
pf.conf_bak_oldversion
pf.conf_bak_newversion
unbound.bak121825
unbound_bak.conf
dhcpd.conf.sample.orig
```

Each file is a moment I was about to change something load-bearing, got nervous, and copied it first. It is version control by hand, badly: no history, no diffs, and no way to tell which `pf.conf` backup actually booted.

A firewall is the worst place to do this. A bad edit doesn't throw an error, it just stops passing traffic, and you find out when the whole house loses the internet. So I put the entire config of my [FreeBSD pf router](freebsd-pf-router) into Git. The interesting part was deciding *how*, because the popular answers are all wrong for this machine.

## What Actually Needs Tracking

The router runs FreeBSD 15 on an N100 with a ZFS root. The custom state that makes it *this* router rather than a fresh install is short:

-   `/etc/pf.conf`, `/etc/rc.conf`, `/etc/sysctl.conf` : the firewall, interfaces, kernel knobs
-   `/etc/ntp.conf`, `/etc/fstab`, `/etc/hosts`, `/etc/crontab`, `/etc/ssh/sshd_config`
-   `/boot/loader.conf`
-   `/usr/local/etc/unbound/` : resolver, ACLs, local zones, blocklist include
-   `/usr/local/etc/dhcpd.conf` : DHCP scopes and static leases
-   `/usr/local/etc/doas.conf` : the privilege policy
-   `/usr/local/sbin/update-*-blocklists.sh` : the scripts that refresh the blocklists

Everything else is a fresh-install default or generated at runtime, and tracking generated state just fills the repo with noise. What stays *out* matters as much: DNSSEC keys, unbound control keys, SSH host keys, `master.passwd`, the lease database, the 3.5 MB blocklist the scripts build. The rule of thumb: if a daemon or a script produces the file, the script belongs in Git and its output does not.

## Why Not Stow, Chezmoi, or etckeeper

This is the part I actually thought about, because the internet has three confident answers and I rejected all of them.

**GNU Stow** symlinks files out of a repo into place. Elegant for a home directory, a quiet hazard for a router. The moment `/etc/pf.conf` is a symlink into `/root/firewall-repo/...`, the repo checkout is load-bearing: blow it away, restore onto a fresh disk in the wrong order, or mount it late, and your firewall's core config is a dangling link. A router's config files should be *real files* that exist whether or not a repo does.

**Chezmoi** is a good dotfile manager, and it can run as root, but its model is "the repo is the source of truth and I render it into place." Pointing that at `/etc` on a daemon's behalf is off-label: you are asking a tool built for `~/.config` to own the files that decide whether the box routes packets.

**etckeeper** is the closest fit, since it versions `/etc` in place and auto-commits on every `pkg` operation. I would have used it. It is not packaged for FreeBSD anymore; the port was retired. That settled it.

The requirement underneath all three rejections is the same: **the running config must not depend on the repo existing.** Take that seriously and the design falls out on its own.

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

I never run `cp` by hand. A Makefile wraps every operation so the verbs stay consistent:

```
make status     # what's deployed vs what's in the repo, per file
make diff       # full diff of live files against the repo
make check      # validate every config without touching anything
make install    # copy repo -> system, then apply manifest perms
make reload     # reload the services that changed
make capture    # pull live files back INTO the repo (for ad-hoc edits)
```

`make diff` answers "did I change something on the box and forget to commit it," which is always eventually yes. `make capture` is the escape hatch: when I edit `/etc/pf.conf` in place at 1am like a normal person, it pulls the live file back into the repo so the next commit matches reality instead of fighting it.

## Validate Before You Reload

The most valuable habit here is that `make check` validates *before* anything reloads, and `make install` refuses to proceed if it fails. FreeBSD ships the validators for free:

```
pfctl -nf /etc/pf.conf           # parse pf rules, don't load them
unbound-checkconf                # validate the resolver config
dhcpd -t -cf /usr/local/etc/dhcpd.conf   # test the DHCP config
sshd -t                          # test sshd_config
```

`pfctl -n` is the hero: it parses the ruleset and reports errors without loading it, so a typo becomes a message on your terminal instead of a router you can't SSH into. Reloading a firewall you haven't dry-run is a coin flip, and the losing side is the whole house asking why the internet is down.

## Two Remotes: Gitea First, GitHub for the 3am Scenario

The repo pushes to my self-hosted [Gitea](https://about.gitea.com/), where my private code lives. But a firewall repo has a specific problem: **Gitea lives behind the firewall.** If the router is down badly enough that I am restoring from Git, the Git server may be just as unreachable.

So Gitea is primary and push-mirrors to a private GitHub repo. The firewall only talks to Gitea on the LAN; Gitea forwards each commit to GitHub on a hook. No GitHub credentials touch the router, and I still get an off-site copy I can clone from a coffee shop while the homelab is a brick.

```
homefw  ──push──►  Gitea (LAN, private)  ──mirror──►  GitHub (off-site, private)
```

## Updating the Box: PkgBase, Not freebsd-update

One detail changes how you update. I built this router on **PkgBase**: the base system delivered as packages (`FreeBSD-kernel-generic`, `FreeBSD-runtime`, and friends) rather than the monolithic base `freebsd-update` manages. The two are mutually exclusive, so on a PkgBase box `freebsd-update` is not just unnecessary, it is wrong and will fight the package database. The upside is one tool for everything:

```
pkg update
pkg upgrade        # base system AND ports, one transaction
```

A new kernel needs a reboot to activate, which is where ZFS boot environments earn their keep:

```
bectl create pre-upgrade-2026-06-28    # snapshot the whole BE first
pkg upgrade
# if the new kernel misbehaves, pick the old BE at the loader
```

I take one before every upgrade. The repo and the boot environment cover different failure modes: the repo versions my *deliberate* changes, the boot environment reverts the *whole system* across an update I didn't write.

## What Version Control Surfaced

The best argument for doing this is what it found. Inventorying the config to import it, I discovered the cron job refreshing my DNS blocklists pointed at a script that no longer existed: a rename months earlier had quietly broken it, and the blocklist had been frozen ever since. Nothing alerted me, because a blocklist that fails to update doesn't error, it just stops getting better. Version control forced me to read every file instead of trusting the box was doing what I thought, and repointing that cron to watch 478,000 fresh rules load was the moment it paid for itself.

## The Payoff

Every change is now a reviewed diff with a message. Rolling back is `git revert` and `make install`. Rebuilding on fresh hardware is a clone, a `make install`, and a reboot. The `/root` graveyard is gone, archived to a tarball and deleted, because the thing it was imitating finally exists.

None of this needed a fancy tool. It needed *rejecting* the fancy tools, because a firewall's one constraint, that the running config cannot depend on the repo, rules them out. A directory of real files, a Makefile, and a permissions manifest is less clever than Stow and exactly right for the job.

## Next Steps

-   [Building a FreeBSD pf Router behind XGS-PON](freebsd-pf-router): the box this config runs on
-   [pf.conf: Writing Rules That Survive a Power Outage](pf-firewall-rules): the ruleset that lives in this repo
-   [ZFS send/recv Replication](zfs-send-recv-replication): the other half of "I can rebuild this"

Managing a router's config some other way? [Tell me how you draw the line](../contact). The copy-versus-symlink question has more than one defensible answer, and I like hearing the other ones.
