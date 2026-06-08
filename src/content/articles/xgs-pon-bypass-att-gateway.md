---
title: "Bypassing the AT&T Fiber Gateway with an XGS-PON SFP+ Module"
description: "A practical write-up of replacing the AT&T BGW320-500 fiber gateway with an X-ONU-SFPP XGS-PON SFP+ module plugged directly into a FreeBSD 15 router. Hardware, prep, FreeBSD-side configuration, boot-timing gotchas, and rollback notes."
date: 2026-05-10
keywords: "XGS-PON, X-ONU-SFPP, AT&T, BGW320, BGW320-500, fiber bypass, ONT, 8311, Azores, pon.wiki, FreeBSD, ix, SFP+, CWWK, homelab, DHCP"
ogTitle: "Bypassing the AT&T Fiber Gateway with an XGS-PON SFP+ Module"
ogDescription: "The X-ONU-SFPP took the AT&T fiber straight into a 10G SFP+ port on the FreeBSD edge router. Here is the build, the prep, and the FreeBSD-side configuration."
badges: ["XGS-PON", "AT&T", "FreeBSD", "Networking", "Homelab"]
related: ["freebsd-pf-router", "pf-firewall-rules", "freebsd-ipv6-router", "ipv6-prefix-delegation-troubleshooting"]
---
## The Goal

Take the AT&T BGW320-500 fiber gateway out of the path entirely, and let the FreeBSD edge router pull the public DHCP lease itself. No passthrough mode, no double NAT, no extra hop, no vendor box quietly running its own software between me and the wire. Just fiber, an SFP+ ONT, and FreeBSD.

The hardware that makes this practical is the [X-ONU-SFPP](https://pon.wiki/category/bgw320-500/), an XGS-PON SFP+ module (a WAS-110 alternative) sold pre-flashed with the 8311 community firmware and the Azores bootloader. It speaks XGS-PON on the fiber side and presents itself as a 10G Ethernet link on the SFP+ side. Drop it into a 10G port on a router or switch and the host gets the WAN. That's it.

## Before and After

```
Before
======
AT&T fiber  ->  BGW320-500 (gateway)  ->  Ethernet  ->  FreeBSD (LAN-side IP)
                  ^ vendor NAT, vendor firewall, vendor admin UI
                  ^ public IP lives here

After
=====
AT&T fiber  ->  X-ONU-SFPP  ->  ix0 SFP+ on FreeBSD (homefw)
                                  ^ FreeBSD pulls the public DHCP lease itself
                                  ^ pf is the only firewall in the path
```

## Bill of Materials

-   **[X-ONU-SFPP](https://pon.wiki/category/bgw320-500/)** XGS-PON SFP+ ONT module, SC/APC connector, 1270nm up / 1577nm down, pre-flashed with the 8311 community firmware and the Azores bootloader. PRX126 SoC, 1 GB RAM, 128 MB NAND. WAS-110 compatible.
-   **USB-C active cooler for the SFP module.** Both the WAS-110 and the X-ONU-SFPP run hot. The pon.wiki shop sells a clip-on cooler; community DIY options exist. Skip cooling at your own risk.
-   **10G SFP+ host.** Anything with an SFP+ port that accepts the module: a router, a managed switch, or a NIC. In my case it's the SFP+ port on a CWWK Intel N100 mini PC running FreeBSD 15.
-   **SC/APC fiber to whatever you currently have on the wall**. AT&T's drop is SC/APC, and the X-ONU-SFPP takes SC/APC directly. If you have an existing patch you may need an APC-to-APC coupler.
-   **The AT&T gateway you're about to retire.** You still need it for the prep step.

## The Prep: What to Pull Off the AT&T Gateway

AT&T's PON authentication needs three things tied to your BGW320-500: the GPON / XGS-PON serial number, the MAC address it advertises, and an EAP-TLS certificate / private key pair. Without those, OLT-side authentication will quietly refuse the new module and you'll see no link.

The 8311 community has built up a thorough, regularly updated set of guides for extracting these from the BGW320-500. Rather than re-paste a procedure that changes with each AT&T firmware push, I'll point at the source:

-   [pon.wiki, BGW320-500 category](https://pon.wiki/category/bgw320-500/): the canonical guides for cert and serial extraction.
-   [8311-Community on GitHub](https://github.com/8311-Community): tooling, firmware, and discussion.

The exact button-mash sequence on the BGW depends on its current firmware version, so check the latest pon.wiki post for your specific case. What you'll come away with is a small bundle of files and identifiers that get loaded onto the X-ONU-SFPP via its 8311 web UI.

## Configuring the SFP Module

The X-ONU-SFPP boots into an OpenWRT-derived environment with a 8311 web UI. Once it's powered up (an SFP+ slot supplies enough power; the USB-C cooler fan needs its own cable) you reach the UI by setting your laptop or workstation to the same management subnet (the module ships with `192.168.11.1` by default) and opening a browser.

Inside the UI, paste in the cert/key pair, the PON serial, and the MAC address you pulled from the BGW. The 8311 firmware exposes the right fields directly; pon.wiki's screenshots make this hard to mess up. Save, reboot the module, and confirm in the UI logs that authentication succeeds and a PON link comes up.

At this point you can already cable the SFP module to the fiber and watch for an OLT-authenticated link, before involving FreeBSD at all. That's the single best test point in the whole project.

## Wiring It In

Pull the BGW320 out of the path:

1.  Disconnect the fiber drop from the BGW.
2.  Plug the X-ONU-SFPP into the SFP+ port on the FreeBSD box (in my case `ix0`).
3.  Plug the fiber drop into the X-ONU-SFPP's SC/APC port.
4.  Power the USB-C cooler.

The order matters: the module should be in the host before the fiber goes in, so you can watch the link come up on the host and aren't squinting at the module's LEDs in a closet.

## FreeBSD-Side Config

With the module installed in `ix0`, the FreeBSD config to pull a public DHCP lease is small. The pieces below are the WAN-relevant lines from my `/etc/rc.conf`; the rest of the [router build](freebsd-pf-router) is unchanged.

```
# /etc/rc.conf, WAN-side excerpt

# WAN: SFP+ port hosting the X-ONU-SFPP
ifconfig_ix0="DHCP"
ifconfig_ix0_ipv6="inet6 accept_rtadv"
background_dhclient_ix0="YES"   # XGS-PON DHCP can be slow at boot
```

The `background_dhclient_ix0="YES"` line is the one that fixed a class of boot-time bugs for me, and it's worth its own paragraph. The X-ONU-SFPP doesn't always finish PON authentication and DHCP in the second or two between when the kernel brings `ix0` up and when rc.d wants to start the rest of the network-dependent services. Without backgrounding the dhclient call, boot blocks waiting for a lease that's about to arrive, and the wait takes long enough that ntpd, unbound, and even sshd all try to come up against a half-configured stack. Backgrounding the WAN dhclient lets boot continue normally; the lease lands a beat later and everything settles.

## Bringing the Link Up

```
$ service netif restart
$ ifconfig ix0
ix0: flags=8943<UP,BROADCAST,RUNNING,...,MULTICAST> metric 0 mtu 1500
        inet 104.10.x.y netmask 0xfffffc00 broadcast 104.10.x.255
        inet6 fe80::%ix0 prefixlen 64 scopeid 0x1
        ...
        media: Ethernet autoselect (10Gbase-LR <full-duplex>)
        status: active

$ netstat -rn | head -5
Routing tables

Internet:
Destination        Gateway            Flags     Netif Expire
default            104.10.x.1         UGS         ix0
```

That's a working WAN. From here, every other piece of the [homelab tour](homelab) is the same as it was when the BGW was upstream: pf rules, DHCP server on the LAN side, unbound, IPv6 RA acceptance.

## What Could Go Wrong (and Where to Look)

-   **No PON link on the module.** Check the 8311 web UI logs for authentication errors. The most common cause is a mismatch between the cert/key bundle and the serial number / MAC. Re-extract from the BGW if in doubt.
-   **PON link up but no DHCP lease on the host.** `tcpdump -ni ix0 'udp port 67 or udp port 68'` to see whether DISCOVER packets are leaving and OFFERs are coming back. If DISCOVER is silent, suspect the host (interface up? `net.inet.ip.forwarding` set?). If OFFER never arrives, that's an OLT-side issue, usually authentication.
-   **Lease arrives, internet doesn't.** Confirm the default route lands on `ix0`, then check pf isn't blocking outbound (the XGS-PON swap shouldn't change that, but it's worth ruling out). `pfctl -s rules | head` and `ping -S <ix0-ip> 1.1.1.1` are the two fastest tests.
-   **Slow boot, ntpd / unbound / sshd unhappy.** You forgot `background_dhclient_ix0="YES"`. Add it, reboot, watch the problem evaporate.
-   **Module getting hot.** If the module starts dropping the link after it's been up for a while, check the cooler fan. The X-ONU-SFPP is the densest piece of silicon in the build by a long way.

## Rollback Plan

Keep the BGW320 in the closet, untouched, until you've been on the bypass for a couple of weeks. Reverting is just: power down the FreeBSD box, pull the X-ONU-SFPP, plug the fiber back into the BGW, power the BGW. The whole round-trip is on the order of five minutes. The new setup is reliable, but nothing about a residential ISP is friendly to "I broke the WAN at 11pm", so the safety net is cheap.

## Why It's Worth It

The replacement isn't about saving money (the X-ONU-SFPP costs more than the BGW does to rent for a year), and it isn't about throughput (XGS-PON was already 10G capable behind the BGW). It's about removing a piece of opaque vendor software from the data path on my own home network, and putting the public IP, the firewall, and the routing in one place I actually control. After the swap, every packet between my LAN and the internet crosses exactly one box I built, and that's the whole point.

## Where to Go Next

-   [Building a FreeBSD pf Router behind XGS-PON](freebsd-pf-router): the host this WAN attaches to, including the rc.conf and pf.conf in full.
-   [Homelab Tour](../homelab): the rest of the network downstream of `ix0`.
-   [IPv6 for Home Networks](freebsd-ipv6-router): native v6 once the bypass is in.
-   [pon.wiki, BGW320-500 category](https://pon.wiki/category/bgw320-500/): the canonical reference for the module-side prep.

Running the same module on a different ISP, or doing the same kind of bypass on a different gateway? [Drop me a note](../contact); I want to hear how the FreeBSD-side story changes.
