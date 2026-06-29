---
title: "Syncing Obsidian to iOS the Hard Way"
description: "I turned a spare M1 MacBook Air into an always-on, nix-darwin server that bridges my Syncthing Obsidian vault into iCloud, so iOS can read and write it. Obsidian Sync is the easy answer and worth paying for. This is the homelab way: the dual-engine conflict, the Unison fix, and the macOS permission wall I hit."
date: 2026-06-27
keywords: "MacBook Air M1 server, always-on Mac, nix-darwin, Obsidian sync, Obsidian iOS sync, iCloud Drive, Syncthing, Unison, two-way sync, macOS TCC, launchd agent iCloud permission, headless Mac, second brain"
ogTitle: "Syncing Obsidian to iOS the Hard Way"
ogDescription: "A spare M1 Air, nix-darwin, Syncthing, and iCloud: two-way Obsidian sync to iOS. The dual-engine conflict, the Unison fix, and the macOS TCC wall."
ogImage: "/pix/macbook-air-server-1.jpg"
badges: ["Homelab", "Obsidian", "nix-darwin", "Syncthing"]
related: ["why-i-run-nixos", "beryl-7-tailscale-travel-router"]
draft: false
---

I had an M1 MacBook Air gathering dust in a drawer: fanless, low-power, idle. So I made it an always-on homelab server, with one first job: get my Obsidian vault onto iOS.

My vault already follows me everywhere through Syncthing, including my daily driver, a Samsung S25 Ultra. iOS is the one holdout. I keep a dev iPhone for testing Flutter iOS builds of [OpenWorld](/openworld), and I wanted my second brain on it too, but Apple won't let Syncthing run in the background there. [Obsidian Sync](https://obsidian.md/sync) is the official answer, it's excellent, and worth paying for to support the people who build it. I went the other way for the fun of it: a spare Mac I already owned and a bridge I could build myself.

It works now. Getting there meant two sync engines at war over one folder, and macOS itself blocking the fix.

<figure style="margin: 1.5rem 0;">
  <img src="/pix/macbook-air-server-1.jpg" alt="A closed MacBook Air on a shelf in a homelab server rack, a single USB-C cable running to a small dock, with an N100 FreeBSD firewall router and a four-bay NAS on the shelf above" width="1600" height="1200" loading="lazy" style="width: 100%; height: auto; border-radius: 8px;" />
  <figcaption class="text-muted" style="font-size: 0.85rem; text-align: center; margin-top: 0.5rem;">Where it lives: lid shut on a rack shelf, one USB-C cable in, tucked under my N100 FreeBSD/pf router and the NAS.</figcaption>
</figure>

## Syncthing stops at iOS

My vault is plain Markdown, synced peer-to-peer with [Syncthing](https://syncthing.net/): no cloud in the middle, and flawless across my desktop, laptops, and Android phone. iOS is where it breaks down. Apple suspends background apps, so a Syncthing client on an iPhone only syncs while you're staring at it. iCloud, though, is the one engine Apple *does* run in the background for free. So the plan: get the vault into iCloud, without giving up Syncthing everywhere else.

## The idea: the Mac as a bridge

The always-on Air sits in the middle. The vault lives in iCloud Drive on the Mac; Syncthing keeps that folder in step with the rest of my machines; iCloud carries it to the iPhone. One folder, two sync engines. That last part is the bug, so hold onto it.

## A real server first

I don't hand-configure machines, so the Air is declared with [nix-darwin](https://github.com/nix-darwin/nix-darwin), same as my [NixOS boxes](../why-i-run-nixos): the system is a file, and rebuilding is one command. `pmset -a disablesleep 1` keeps it awake lid-closed, headless on a shelf. Three macOS surprises earned their place in the config:

- **FileVault has to be off.** Its unlock runs before networking exists, and macOS has no remote unlock, so leave it on and a reboot strands the box at a screen no one can reach.
- **Wi-Fi only auto-joins pre-login if its password is in the *System* keychain**, not the user keychain, which is locked when nobody's logged in. Otherwise a rebooted headless Mac never gets online.
- **SSH isn't a desktop session.** iCloud and the sync agents only run once someone's logged in, so after a reboot I Screen-Share in once to start them. Auto-login would skip that step, but I don't want someone to be able to grab the laptop, restart it, and get straight into my system with full access, so I leave it off and take the one manual login.

## Then the bridge fought back

The setup came up clean, so I started testing it. Within minutes, deleted notes were coming back from the dead: delete one on the ThinkPad, and three seconds later it's back on every device, trailing a `.sync-conflict` copy. The Mac's Syncthing log told the story:

```
Synced (created):   test.md
Updated metadata:   mtime 17:40:59 → 17:41:11    ← rewritten
Renamed → .sync-conflict-...
Synced (RE-CREATED): perms 0660                   ← back in 3s
Updated metadata:   perms 0660 → 0644             ← touched again
```

Permissions flipping 0644↔0660, mtimes rewritten seconds after each sync. That isn't Syncthing. It's iCloud's daemons (`bird`, `cloudd`) constantly rewriting the folder and re-downloading the files I'd deleted. **iCloud isn't a passive store.** Two real-time engines watching one folder each read the other's housekeeping as a real edit, forever. The one-folder bridge was doomed by design, not by config.

## The fix: two folders, one bridge

If two engines can't share a folder, give each its own and reconcile them on a schedule:

```
   Syncthing mesh: laptops, desktop, Android phone
   (peer-to-peer, two-way; every device has the full ~/vault)
        │
        ▼  Syncthing
   ───────── m1, always-on Mac ──────────────────
        ~/vault                   (Syncthing owns this)
           ▲
           │   Unison, every 60s, two-way
           ▼
        iCloud Obsidian folder    (iCloud owns this)
   ──────────────────────────────────────────────
        │
        ▼  iCloud (background)
   iPhone (Obsidian, read + write)
```

[Unison](https://github.com/bcpierce00/unison) is a true two-way reconciler: it keeps an archive of the last sync, so it can tell "deleted here" from "created there." Syncthing owns `~/vault`; iCloud owns its Obsidian container; Unison bridges them every 60 seconds, tuned to ignore iCloud's noise:

```
fastcheck = false   # compare by content, not mtime (iCloud churns mtimes)
perms = 0           # ignore the 0644 <-> 0660 flips
prefer = newer      # newest wins a real conflict; the loser is backed up
```

Neither engine ever watches the other's folder, so neither can mistake housekeeping for an edit.

## The wall: macOS blocks the bridge

One catch: macOS privacy controls (TCC) won't let a background agent reach iCloud, so the Unison launchd agent just gets `Operation not permitted`. You have to grant it access by clicking Allow on the system prompt, which I do over Screen Sharing since the Mac is headless. That grant is tied to the binary's exact path, and Nix store paths change on every update, so I copy `unison` to a fixed path (`~/.local/bin/unison-bridge`) and grant that one. Click Allow once and it sticks across rebuilds.

## It works

Create a note in `~/vault` and it's on the iPhone within a minute; jot one on the iPhone and it lands in `~/vault`, then fans out across the mesh. **Real two-way sync.** The only chore is after a reboot, where I Screen-Share in once to start the session; SSH and Tailscale come back on their own.

Would I point everyone down this road? Honestly, no. **Most people should just buy [Obsidian Sync](https://obsidian.md/sync).** It's polished, it's effortless, and it directly funds a tool worth funding. I did it this way because I had an idle Mac, I enjoy a homelab puzzle, and I wanted to own the whole path end to end.

## The Mac earns its keep

The Air didn't stop there. It's a fanless box that's always on and on my [tailnet](../beryl-7-tailscale-travel-router), and it's the only machine that can build for Apple platforms, so it doubles as a remote `xcodebuild` box. Remote Flutter builds of OpenWorld for iOS are next on the list, tested on the same dev iPhone that now carries my vault. A drawer laptop, declared as code, quietly running real jobs.

If you've bridged Syncthing and iCloud, or hit the same TCC wall, [I'd love to hear how it went](../contact).

*Thanks for reading. Mike out.*
