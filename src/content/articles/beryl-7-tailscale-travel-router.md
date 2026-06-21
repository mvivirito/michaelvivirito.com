---
title: "Carrying My Home Network in My Pocket: Beryl 7 + Tailscale"
description: "How a GL.iNet Beryl 7 travel router and a Tailscale exit node give me secure access to my entire home LAN — and my home IP — from any hotel, café, or dealership Wi-Fi. The full struggle and the fixes that finally made it work."
date: 2026-06-20
keywords: "Beryl 7, GL-MT3600BE, GL.iNet, Tailscale, exit node, subnet router, travel router, home network remote access, Proxmox, pf, WireGuard, VPN, homelab, DFS, symmetric NAT"
ogTitle: "Carrying My Home Network in My Pocket: Beryl 7 + Tailscale"
ogDescription: "A GL.iNet Beryl 7 + a Tailscale exit node = my whole home network, anywhere. The full struggle, the fixes, and why a travel router earns its spot in the bag."
ogImage: "/pix/beryl-7-tailscale-1.jpg"
badges: ["Networking", "Tailscale", "Homelab", "Travel"]
related: []
draft: false
---

<div style="background: var(--bg-surface); padding: 1rem; border: 1px solid var(--border-accent); border-left: 3px solid var(--accent-primary); margin: 0 0 1.5rem;">
  <p style="margin: 0; font-size: 0.9rem;"><strong>Heads-up:</strong> the gear links below are affiliate links. Buying through them helps fund <a href="/openworld">OpenWorld</a> and the homelab, at no extra cost to you. See the <a href="/disclosure">disclosure</a>.</p>
</div>

I'm writing this from a car-dealership service lounge, on their open guest Wi-Fi — and my laptop is convinced it's sitting on my desk at home. It carries my home IP out to the internet, reaches my NAS and my Proxmox box by their normal addresses, and resolves my internal `.home.lan` names. A little travel router in my bag is quietly tunneling everything back to the house.

That's the payoff. Getting there took a dedicated exit node, three firewall fixes, one genuinely humbling self-own, and a random Reddit comment that finally cracked the last problem. Here's the whole thing.

<figure style="margin: 1.5rem 0;">
  <img src="/pix/beryl-7-tailscale-1.jpg" alt="The GL.iNet Beryl 7 travel router on a table, in use on the road" width="1600" height="1200" loading="lazy" style="width: 100%; height: auto; border-radius: 8px;" />
  <figcaption class="text-muted" style="font-size: 0.85rem; text-align: center; margin-top: 0.5rem;">The Beryl 7 — my home network, packed into something the size of a deck of cards.</figcaption>
</figure>

## What I actually wanted

Two things people lump together as "VPN back home," but they're separate:

- **Reach my home devices** — open `10.0.0.x` and hit the NAS, Proxmox, the firewall UI, as if I were on the couch. In Tailscale terms that's a *subnet route*.
- **Look like I'm home** — push my internet traffic *out through my house*, so I carry my home IP and get a trusted exit on sketchy public Wi-Fi. That's an *exit node*.

I wanted both — for **any** device, without installing anything on each gadget. That last part is what a travel router buys you: join its Wi-Fi and you're home, no per-device setup.

## The home side: one boring little VM

The anchor is a dedicated Tailscale node at home I call `net-gateway` — a minimal Debian VM on Proxmox (1 vCPU, 1 GB RAM) whose entire job is to advertise itself as an **exit node** and a **subnet router** for my LAN:

```
tailscale up --advertise-exit-node --advertise-routes=10.0.0.0/24
```

Approve those in the Tailscale admin console and, in theory, anything on my tailnet can now ride home through it. In theory.

## Then the struggle

### 1. Reachable — but only the slow way

Tailscale always prefers a **direct** peer-to-peer connection and only falls back to a relay (its encrypted "DERP" servers) when it can't punch through. My home firewall's NAT was *symmetric* — it handed out a different external port for every destination — so the travel router could never find a stable path in. Everything fell back to a relay, which is fine for a quick SSH but miserable when you're trying to push your whole internet connection through it.

The fix, on my FreeBSD/pf firewall, was to give the exit node a stable, forwarded port and stop the NAT from scrambling it:

```
# Forward Tailscale's port straight to the exit-node VM…
rdr pass on $ext_if inet proto udp from any to ($ext_if) port 41641 -> 10.0.0.10 port 41641
# …and keep its source port stable so the NAT stops being "symmetric" for it
nat on $ext_if inet proto udp from 10.0.0.10 port 41641 to any -> ($ext_if) static-port
```

Flush the stale states (`pfctl -k 10.0.0.10`) and the travel router suddenly connected **directly** — ~5 ms instead of a relay halfway across the country.

### 2. My own firewall ate the DNS

This one's embarrassing. A while back I'd locked my network down so that *all* DNS is forced through my home resolver (Unbound), and queries to outside DNS servers are blocked — a privacy thing. Worked great… until the exit node forwarded a traveling device's DNS lookup to `8.8.8.8` and my own firewall promptly dropped it.

The symptom was maddening: pages wouldn't load, but pinging raw IPs worked. Classic "DNS is down" — except I'd done it to myself. The fix is to transparently redirect the exit node's DNS to my home resolver instead of blocking it:

```
# Send the exit node's forwarded DNS to home Unbound instead of dropping it
rdr pass on $lan_if proto { tcp udp } from 10.0.0.10 to ! $lan_ip port 53 -> $lan_ip port 53
```

Now traveling devices quietly resolve through my house — ad-blocking, internal names, and all.

### 3. The travel router wouldn't pass traffic — the Reddit save

Now the home side was provably perfect. I tested it from a laptop with Tailscale: full internet, home IP, the works. But the moment I put the **Beryl 7** in the path as the exit node, requests went *out* and nothing came *back*. Bytes flowing up, almost nothing down. I chased NAT again, then DNS, then MTU — all dead ends.

The actual answer came from a GL.iNet subreddit thread. In the router's LUCI admin panel:

> **Network → Firewall**, edit the **wan** zone → **Advanced Settings**, and add **`tailscale0`** to the covered devices.

That one toggle tells OpenWrt to actually **forward and masquerade** traffic between the LAN and the Tailscale tunnel. Without it, the router happily sent my requests out the tunnel but had no return path for the replies. The instant I added it, real traffic flowed both ways. Full credit to [this r/GLinet comment](https://www.reddit.com/r/GlInet/s/JSfxl70Jtc) — it's the only place I found the fix.

<figure style="margin: 1.5rem 0;">
  <img src="/pix/beryl-7-tailscale-2.jpg" alt="The LUCI firewall page on the Beryl 7 with tailscale0 added to the wan zone's covered devices" width="1600" height="1200" loading="lazy" style="width: 100%; height: auto; border-radius: 8px;" />
  <figcaption class="text-muted" style="font-size: 0.85rem; text-align: center; margin-top: 0.5rem;">The fix: <code>tailscale0</code> added to the wan zone's covered devices in LUCI.</figcaption>
</figure>

## The payoff

With those three fixed, the Beryl 7 just works as a pocket gateway:

- **Join its Wi-Fi → you're on my home network.** No app, no config, on any device.
- **My home IP, anywhere** — great for services that get suspicious of new locations, or anything geo-locked to home.
- **Full reach into the LAN** — NAS, Proxmox, the firewall, everything by its normal `10.0.0.x` address.
- **A trusted, encrypted exit** on hotel, airport, café, and (apparently) car-dealership Wi-Fi.

<figure style="margin: 1.5rem 0;">
  <img src="/pix/beryl-7-tailscale-3.jpg" alt="The Tailscale exit-node selector showing net-gateway active, routing this device's traffic home" width="1600" height="1200" loading="lazy" style="width: 100%; height: auto; border-radius: 8px;" />
  <figcaption class="text-muted" style="font-size: 0.85rem; text-align: center; margin-top: 0.5rem;">Exit node set to home — every byte routes through the house. (And no, I'm not going to screenshot my actual home IP.)</figcaption>
</figure>

## Why a travel router instead of just the app

You can run Tailscale on each device — and I do, as a backup. But the router is the magic trick: it pulls **everything behind it** home, including things that can't run Tailscale themselves — a locked-down work laptop, a streaming stick, a game console, a guest's phone. One login on the router and the whole bag comes home with you.

## The gear

- <a href="/go/beryl-7/" rel="sponsored noopener noreferrer" target="_blank">GL.iNet Beryl 7 (GL-MT3600BE)</a> — the travel router. Pocket-sized, runs OpenWrt, and has Tailscale and WireGuard built right into the GUI.
- **[Tailscale](https://tailscale.com)** — free for personal use; the mesh-VPN backbone that ties it all together.
- **Any always-on box at home** for the exit node — a spare PC, a Raspberry Pi, or in my case a tiny Proxmox VM. It just has to stay powered on and reachable.

The hardest part wasn't the router or the VPN — both are genuinely friendly. It was my own years-deep firewall rules fighting me. If you're running the same kind of locked-down home network and hit the same wall — or you're stuck on that wan-zone gotcha — [drop me a line](../contact).
