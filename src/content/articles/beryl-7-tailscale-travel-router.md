---
title: "Take Your Home Network With You: Beryl 7 + Tailscale"
description: "How a GL.iNet Beryl 7 travel router and a Tailscale exit node give me secure access to my entire home LAN, and my home IP, from any hotel, café, or dealership Wi-Fi. The full struggle and the fixes that finally made it work."
date: 2026-06-20
keywords: "Beryl 7, GL-MT3600BE, GL.iNet, Tailscale, exit node, subnet router, travel router, home network remote access, Proxmox, pf, WireGuard, VPN, homelab"
ogTitle: "Take Your Home Network With You: Beryl 7 + Tailscale"
ogDescription: "A GL.iNet Beryl 7 plus a Tailscale exit node equals my whole home network, anywhere. The full struggle, the fixes, and why a travel router earns its spot in the bag."
ogImage: "/pix/beryl-7-tailscale-1.jpg"
badges: ["Networking", "Tailscale", "Homelab", "Travel"]
related: []
draft: false
---

<div style="background: var(--bg-surface); padding: 1rem; border: 1px solid var(--border-accent); border-left: 3px solid var(--accent-primary); margin: 0 0 1.5rem;">
  <p style="margin: 0; font-size: 0.9rem;"><strong>Heads-up:</strong> the gear links below are affiliate links. Buying through them helps fund <a href="/openworld">OpenWorld</a> and the homelab, at no extra cost to you. See the <a href="/disclosure">disclosure</a>.</p>
</div>

I'm writing this from a car-dealership service lounge, on their open guest Wi-Fi, and my laptop is convinced it's sitting on my desk at home. It carries my home IP out to the internet and reaches my NAS and my Proxmox box on their normal home addresses. A little travel router in my bag is quietly tunneling everything back to the house.

That's the payoff. Getting there took a dedicated exit node, three firewall fixes, and a random Reddit comment that finally cracked the last problem. Here's the whole thing.

<figure style="margin: 1.5rem 0;">
  <img src="/pix/beryl-7-tailscale-1.webp" alt="The GL.iNet Beryl 7 travel router on a table, in use on the road" width="1541" height="1156" loading="lazy" style="width: 100%; height: auto; border-radius: 8px;" />
  <figcaption class="text-muted" style="font-size: 0.85rem; text-align: center; margin-top: 0.5rem;">The Beryl 7: my home network, packed into something the size of a deck of cards.</figcaption>
</figure>

## What I actually want

Two things people lump together as "VPN back home," but they're really separate:

- **Reach my home devices:** open `10.0.0.x` and hit the NAS, Proxmox, or the firewall UI as if I were on the couch. In Tailscale terms that's a [subnet route](https://tailscale.com/docs/features/subnet-routers).
- **Look like I'm home:** push my internet traffic out through my house, so I carry my home IP and get a trusted exit on sketchy public Wi-Fi. That's an [exit node](https://tailscale.com/docs/features/exit-nodes).

I want both, for **any** device, without installing anything on each gadget. That last part is what a travel router buys you: join its Wi-Fi and you're home, with no per-device setup.

## The home side: one boring little VM

The anchor is a dedicated Tailscale node at home I call `net-gateway`, a minimal Debian VM on Proxmox (1 vCPU, 1 GB RAM). Its entire job is to advertise itself as an exit node and a subnet router for my LAN:

```
tailscale up --advertise-exit-node --advertise-routes=10.0.0.0/24
```

Advertising isn't enough on its own; both have to be approved once in the Tailscale admin console. Open the `net-gateway` machine, approve its **exit node**, and approve its advertised **`10.0.0.0/24` subnet route**. After that, anything on my tailnet can ride home through it. In theory.

<figure style="margin: 1.5rem 0;">
  <img src="/pix/beryl-7-tailscale-2.png" alt="The Tailscale admin console showing the net-gateway machine with its exit node allowed and the 10.0.0.0/24 subnet route approved" width="1537" height="884" loading="lazy" style="width: 100%; height: auto; border-radius: 8px;" />
  <figcaption class="text-muted" style="font-size: 0.85rem; text-align: center; margin-top: 0.5rem;">net-gateway in the Tailscale admin: exit node allowed and the 10.0.0.0/24 subnet route approved, tagged <code>tag:infra</code> with key expiry off.</figcaption>
</figure>

## Then the struggle

### 1. Reachable, but only the slow way

Tailscale always prefers a **direct** peer-to-peer connection and only falls back to a relay (its encrypted "DERP" servers) when it can't punch through. My home firewall's NAT is *symmetric*: it hands out a different external port for every destination, so the travel router could never find a stable path in. Everything fell back to a relay, which is fine for a quick SSH but miserable when you're trying to push a whole internet connection through it.

The fix, on my FreeBSD/pf firewall, is to give the exit node a stable, forwarded port and stop the NAT from scrambling it:

```
# Forward Tailscale's port straight to the exit-node VM
rdr pass on $ext_if inet proto udp from any to ($ext_if) port 41641 -> 10.0.0.10 port 41641
# Keep its source port stable so the NAT stops being "symmetric" for it
nat on $ext_if inet proto udp from 10.0.0.10 port 41641 to any -> ($ext_if) static-port
```

Flush the stale states (`pfctl -k 10.0.0.10`) and the travel router connects **directly**, around 5 ms instead of a relay halfway across the country.

### 2. The firewall's DNS lockdown caught the exit traffic

My network forces all DNS through my home resolver (Unbound) and blocks queries to outside DNS servers, a privacy measure I set up long ago. That same rule catches the exit node: when it forwards a traveling device's lookup to `8.8.8.8`, the firewall drops it like any other outbound DNS query.

The symptom is a familiar one: pages won't load, but pinging raw IPs still works. The fix is to let that traffic through, transparently redirecting the exit node's DNS to my home resolver instead of dropping it:

```
# Send the exit node's forwarded DNS to home Unbound instead of dropping it
rdr pass on $lan_if proto { tcp udp } from 10.0.0.10 to ! $lan_ip port 53 -> $lan_ip port 53
```

Now traveling devices quietly resolve through my house, ad-blocking and all.

### 3. The travel router wouldn't pass traffic: the Reddit save

Now the home side was provably perfect. I tested it from a laptop running Tailscale: full internet, home IP, the works. But the moment I put the **Beryl 7** in the path as the exit node, requests went *out* and nothing came *back*. Bytes flowing up, almost nothing down. I chased NAT again, then DNS, then MTU, all dead ends.

The actual answer came from a GL.iNet subreddit thread. In the router's LUCI admin panel:

> **Network → Firewall**, edit the **wan** zone, open **Advanced Settings**, and add **`tailscale0`** to the covered devices.

That one change tells OpenWrt to actually **forward and masquerade** traffic between the LAN and the Tailscale tunnel. Without it, the router happily sends my requests out the tunnel but has no return path for the replies. The instant I added it, real traffic flowed both ways. Credit to [this r/GLinet comment](https://www.reddit.com/r/GlInet/s/JSfxl70Jtc); it's the first place I came across the fix when I went looking.

<figure style="margin: 1.5rem 0;">
  <img src="/pix/beryl-7-tailscale-3.png" alt="The Beryl's LUCI firewall zone settings for the wan zone, with tailscale0 wired into it" width="1514" height="1167" loading="lazy" style="width: 100%; height: auto; border-radius: 8px;" />
  <figcaption class="text-muted" style="font-size: 0.85rem; text-align: center; margin-top: 0.5rem;">The fix: the Beryl's <code>wan</code> firewall zone in LUCI, with <code>tailscale0</code> wired in.</figcaption>
</figure>

## The payoff

With those three fixes in place, the Beryl 7 just works as a pocket gateway:

- **Join its Wi-Fi and you're on my home network.** No app, no config, on any device.
- **My home IP, anywhere:** great for services that get suspicious of new locations, or anything geo-locked to home.
- **Full reach into the LAN:** the NAS, Proxmox, the firewall, everything by its normal `10.0.0.x` address.
- **A trusted, encrypted exit** on hotel, airport, café, and (apparently) car-dealership Wi-Fi.

## Travel router, or just the app?

You don't strictly need the router. On any device you control, one command turns it into a Tailscale client that rides home the exact same way:

```
tailscale up --accept-routes --exit-node=net-gateway
```

That's the whole thing. My laptop and phone both do exactly that as a backup. So why also carry a separate box?

**Where the travel router wins:**

- It pulls *everything behind it* home, including gear that can't run Tailscale itself: a locked-down work laptop, a streaming stick, a game console, a friend's phone. One login on the router and the whole bag comes home.
- One thing to manage instead of configuring every device.
- It's genuinely versatile. These little boxes do far more than tunnel: plug in a USB drive and it's a pocket NAS you can share files from with whoever's in the room, it can extend or rebroadcast a weak Wi-Fi signal in a pinch, and it puts your own trusted SSID on top of whatever network you're stuck on. It's a genuinely handy thing to have in a backpack, and honestly pretty cool.

**Where the app wins:**

- Nothing extra to carry, charge, or set up. For a single laptop, it's the simpler answer.
- No second device that can flake on you.
- Throughput is whatever your machine can do, not capped by a small router's CPU.

**Bottom line:** if it's just you and a laptop, the app is plenty. If you travel with several devices, want to hand a working network to other people, or want the pocket-NAS and range-extender tricks, the router earns its spot in the bag.

## The gear

- <a href="/go/beryl-7/" rel="sponsored noopener noreferrer" target="_blank">GL.iNet Beryl 7 (GL-MT3600BE)</a>: the travel router. Pocket-sized, runs OpenWrt, with Tailscale and WireGuard built right into the GUI.
- **[Tailscale](https://tailscale.com)**: free for personal use, the mesh-VPN backbone that ties it all together.
- **Any always-on box at home** for the exit node: a spare PC, a Raspberry Pi, or in my case a tiny Proxmox VM. It just has to stay powered on and reachable.

The router and the VPN are both genuinely friendly. The rest was just adjusting my own setup to fit the new piece, and learning as I went. My DNS is locked down on purpose and I like it that way; the exit node simply had to be taught to play by those rules. If you run a similarly hardened home network, or you hit that wan-zone gotcha, [drop me a line](../contact).
