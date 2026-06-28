---
title: "Version-Controlling a FreeBSD Firewall: Git, a Makefile, and No Symlinks"
description: "How I put a FreeBSD 15 router's entire config under Git without symlinks or etckeeper: a path-mirrored repo, a copy-deploy Makefile, a permissions manifest, validate-before-reload, and a Gitea-to-GitHub mirror."
date: 2026-06-28
keywords: "FreeBSD, pf, firewall, git, version control, config management, Gitea, GitHub mirror, Makefile, GNU stow, chezmoi, etckeeper, PkgBase, boot environments, bectl, unbound, dhcpd, homelab"
ogTitle: "Version-Controlling a FreeBSD Firewall Without Symlinks"
ogDescription: "A path-mirrored Git repo, a copy-deploy Makefile, and a permissions manifest put a FreeBSD router's config under version control. Validate before reload, mirror Gitea to GitHub, update with PkgBase."
badges: ["FreeBSD", "Git", "Config Management", "pf", "Homelab"]
related: ["freebsd-pf-router", "pf-firewall-rules", "zfs-send-recv-replication", "why-i-run-nixos"]
---

## The /root Graveyard

Here is what `/root` looked like on my router before I did this:

```
pf.conf_bak_oldversion
pf.conf_bak_newversion
unbound.bak121825
unbound_bak.conf
dhcpd.conf.sample.orig
```

Every one of those files is a small confession. Each is a moment where I was about to change something load-bearing, got nervous, and copied the file before touching it. That is version control implemented by hand, badly: no history, no diffs, no message explaining *why* the December 18th unbound config was worth keeping, and no way to tell which of the two `pf.conf` backups is the one that actually booted.

A firewall is the worst possible place to manage config this way. It is the one box where a bad edit doesn't throw an error, it just quietly stops passing traffic, and you find out when the whole house loses the internet. So I finally did the obvious thing and put the entire configuration of my [FreeBSD pf router](freebsd-pf-router) into Git. The interesting part was deciding *how*, because the popular answers are all wrong for this particular machine.

## What Actually Needs Tracking

The router runs FreeBSD 15 on an N100 with a ZFS root. The custom state that makes it *this* router, rather than a fresh install, is a short list:

-   `/etc/pf.conf`, `/etc/rc.conf`, `/etc/sysctl.conf` : the firewall, the interfaces, the kernel knobs
-   `/etc/ntp.conf`, `/etc/fstab`, `/etc/hosts`, `/etc/crontab`, `/etc/ssh/sshd_config`
-   `/boot/loader.conf`
-   `/usr/local/etc/unbound/` : the resolver, ACLs, local zones, blocklist include
-   `/usr/local/etc/dhcpd.conf` : the DHCP scopes and static leases
-   `/usr/local/etc/doas.conf` : the privilege policy
-   `/usr/local/sbin/update-*-blocklists.sh` : the scripts that refresh the DNS blocklists

That is the whole surface. Everything else on the box is either a fresh-install default or generated at runtime, and tracking generated state is how you get a repo full of noise.

What stays *out* of the repo matters just as much. DNSSEC keys, the unbound control keys, SSH host keys, `master.passwd`, the DHCP lease database, the 3.5 MB blocklist file the scripts build: all generated or secret, all ignored. The rule of thumb is that if a file is produced by a daemon or a script, the script belongs in Git and its output does not.

## Why Not Stow, Chezmoi, or etckeeper

This is the part I actually thought about, because the internet has three confident answers and I rejected all of them.

**GNU Stow** manages dotfiles by symlinking them out of a repo into their target locations. It is elegant for a home directory. It is a quiet hazard for a router. The moment `/etc/pf.conf` becomes a symlink into `/root/firewall-repo/...`, the repo checkout is load-bearing infrastructure. Blow away that directory, restore onto a fresh disk in the wrong order, or have the repo live on a filesystem that mounts late, and you have a firewall whose core config is a dangling link. A router's config files should be *real files* that exist whether or not a Git repo does.

**Chezmoi** is a genuinely good dotfile manager, and people reach for it here because it can template and it can run as root. But its whole model is "the source of truth lives in the repo, and I render it into place." Pointing that at `/etc` on a system daemon's behalf is off-label: you are now asking a tool designed for `~/.config` to own the files that decide whether the box routes packets. The impedance mismatch is not worth it.

**etckeeper** is the closest fit, since it versions `/etc` in place and hooks your package manager so every `pkg` operation auto-commits. I would have used it. It is not packaged for FreeBSD anymore; the port was retired. That settled it.

So none of the off-the-shelf tools fit a FreeBSD firewall cleanly. The requirement underneath all three rejections is the same: **the running config must not depend on the repo existing.** Once you take that seriously, the design falls out on its own.

## The Shape: A Repo That Mirrors the Filesystem

The repo is just a tree that mirrors the absolute paths it manages:

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

`etc/pf.conf` in the repo corresponds to `/etc/pf.conf` on disk. No symlinks, no templating, no magic: deploying is *copying*, and the repo is a staging area you review before you copy.

The one thing a plain copy loses is permissions. `git` does not record owner, group, or the fact that `doas.conf` must be mode `0600` or doas refuses to run. So the repo carries a `manifest.tsv` that does:

```
# path                              mode  owner  group
etc/pf.conf                         0644  root   wheel
usr/local/etc/doas.conf             0600  root   wheel
usr/local/sbin/update-oisd-blocklists.sh  0755  root  wheel
```

The deploy step reads the manifest and `chmod`/`chown`s each file after copying it. That is the piece etckeeper and Stow give you for free and a copy-based approach has to do explicitly. It is also documentation: the manifest is a single place that says exactly how every managed file should look on disk.

## The Makefile Is the Interface

I never run `cp` by hand. A Makefile wraps every operation so the verbs are consistent and safe:

```
make status     # what's deployed vs what's in the repo, per file
make diff       # full diff of live files against the repo
make check      # validate every config without touching anything
make install    # copy repo -> system, then apply manifest perms
make reload     # reload the services that changed
make capture    # pull live files back INTO the repo (for ad-hoc edits)
```

Two of those are the ones I lean on. `make diff` is the answer to "did I change something on the box and forget to commit it," which on a hand-managed router is always eventually yes. `make capture` is the escape hatch: when I'm debugging at 1am and edit `/etc/pf.conf` in place like a normal person, `capture` pulls the live file back into the repo so the next commit reflects reality instead of fighting it. The repo accommodates how I actually work instead of demanding discipline I won't have at 1am.

## Validate Before You Reload

The single most valuable line in the whole setup is that `make check` validates *before* anything reloads, and `make install` refuses to proceed if it fails. FreeBSD ships the validators for free:

```
pfctl -nf /etc/pf.conf           # parse pf rules, don't load them
unbound-checkconf                # validate the resolver config
dhcpd -t -cf /usr/local/etc/dhcpd.conf   # test the DHCP config
sshd -t                          # test sshd_config
```

`pfctl -n` is the hero. It parses the ruleset and reports errors without loading it, which means a typo in a firewall rule becomes a message on your terminal instead of a house with no internet and a router you can't SSH into. Reloading a firewall config you haven't dry-run first is a coin flip, and the coin is weighted toward your spouse asking why the TV won't load.

## Two Remotes: Gitea First, GitHub for the 3am Scenario

The repo pushes to my self-hosted [Gitea](https://about.gitea.com/), which is where all my private code lives. But a firewall repo has a specific disaster-recovery problem: **Gitea lives behind the firewall.** If the router is down badly enough that I'm restoring its config from Git, the Git server may be exactly as unreachable as the router.

So Gitea is the primary, and it push-mirrors to a private GitHub repo automatically. The firewall only ever talks to Gitea on the LAN; Gitea forwards each commit to GitHub on a sync hook. No GitHub credentials ever touch the router, and I still get an off-site copy I can `git clone` from a coffee shop while the homelab is a brick. The mirror is configured once, in Gitea, and then it is invisible.

```
homefw  ──push──►  Gitea (LAN, private)  ──mirror──►  GitHub (off-site, private)
```

## Scrubbing a Secret From History

I will admit a mistake here, because it is instructive. An early version of the repo had my public WAN IP written into a network-topology doc. Putting that in Git is not catastrophic, but a public IP plus a list of open services is more of a map than I want to hand out, and I planned to make notes from this repo public eventually.

The wrong fix is a new commit that deletes the line. Git is history; the IP is still right there in every prior revision, one `git log -p` away. Because the repo was young and the history was not precious, I took the blunt, correct route: remove the IP from the working tree, delete the `.git` directory entirely, and re-initialize with a single fresh commit. Then I deleted and recreated the Gitea and GitHub repos so their stored history was purged too, not just the local copy.

```
# nuke local history, start clean
rm -rf .git
git init -b main
git add .
git commit -m "Initial import"
```

The lesson is the boring one everybody learns once: **secrets do not belong in a commit, because a commit is forever unless you do violence to the history.** For a young repo, the cleanest violence is a clean slate. For an old one with history you care about, you reach for `git filter-repo`, but the better move is to never let it happen, which is what the `.gitignore` is now for.

## Updating the Box: PkgBase, Not freebsd-update

A detail specific to this machine, because it surprised me. This router runs **PkgBase**: the FreeBSD base system itself is installed as packages (`FreeBSD-kernel-generic`, `FreeBSD-runtime`, and friends) rather than managed by `freebsd-update`. The two are mutually exclusive. On a PkgBase system, `freebsd-update` is not just unnecessary, it is wrong, and running it will fight the package database.

The upside is that one tool updates everything:

```
pkg update
pkg upgrade        # updates base system AND ports together
```

Kernel, userland, and the unbound/dhcpd packages all move in one transaction. A new kernel means a reboot to activate it, and that is where ZFS boot environments earn their keep again:

```
bectl create pre-upgrade-2026-06-28    # snapshot the whole BE first
pkg upgrade
# if the new kernel panics or misbehaves, pick the old BE at the loader
```

I take a boot environment before every upgrade. It is the same insurance I use before a risky pf change: a single reboot reverts the entire system to a known-good state, no restore-from-backup required. The config repo and the boot environment cover two different failure modes. The repo versions my *deliberate* changes; the boot environment versions the *whole system* across an update I didn't write.

## What Version Control Surfaced

The best argument for doing this is what it found. While inventorying the config to import it, I discovered that the cron job refreshing my DNS blocklists pointed at a script that did not exist: a rename months earlier had quietly broken the update, and the blocklist had been frozen ever since. Nothing alerted me, because a blocklist that fails to update doesn't error, it just stops getting better.

Putting the config under version control is what forced me to actually read every file instead of trusting that the box was doing what I thought. The repo did not just preserve the config, it made me audit it, and the audit is where the value was. Repointing the cron and watching 478,000 fresh rules load was the moment the whole exercise paid for itself.

## The Payoff

Every change to the firewall is now a reviewed diff with a message explaining why. Rolling back is `git revert` and `make install`. Standing the router back up on fresh hardware is a clone, a `make install`, and a reboot. The `/root` graveyard is gone, archived into a single tarball and deleted, because the thing it was a sad imitation of finally exists.

None of this required a fancy tool. It required *rejecting* the fancy tools, because a firewall's constraint, that the running config cannot depend on the repo, rules them out. A directory of real files, a Makefile, and a permissions manifest is less clever than Stow and exactly right for the job.

## Next Steps

-   [Building a FreeBSD pf Router behind XGS-PON](freebsd-pf-router): the box this config runs on
-   [pf.conf: Writing Rules That Survive a Power Outage](pf-firewall-rules): the ruleset that lives in this repo
-   [ZFS send/recv Replication](zfs-send-recv-replication): the other half of "I can rebuild this"

Managing a router's config some other way? [Tell me how you draw the line](../contact). The copy-versus-symlink question has more than one defensible answer, and I like hearing the other ones.
