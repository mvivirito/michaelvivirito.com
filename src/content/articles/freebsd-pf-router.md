---
title: "Building a FreeBSD pf Router behind XGS-PON"
description: "A practical, opinionated guide to building a FreeBSD 15 edge router on a CWWK N100 mini PC, with an X-ONU-SFPP XGS-PON SFP+ module taking the AT&T fiber directly. ZFS root, pf, unbound, ISC DHCP, and a VLAN, from boot media to a working gateway."
date: 2026-05-10
keywords: "FreeBSD, pf, router, firewall, homelab, networking, unbound, dhcpd, ZFS, ix, XGS-PON, X-ONU-SFPP, AT&T bypass, CWWK, N100, VLAN, Sodola"
ogTitle: "Building a FreeBSD pf Router behind XGS-PON"
ogDescription: "From boot media to a working FreeBSD 15 edge router with an XGS-PON SFP+ module replacing the ISP gateway. pf, unbound, ISC DHCP, and a VLAN trunk to a Sodola switch."
badges: ["FreeBSD 15", "pf", "XGS-PON", "Networking", "Homelab"]
related: ["pf-firewall-rules", "freebsd-jails-network", "freebsd-ipv6-router", "freebsd-wireguard"]
---
## Why Build It Yourself?

Consumer routers run a Linux kernel from 2017, a vendor-modified userspace, and a web UI that lies about what's actually configured. OPNsense and pfSense are excellent, they're both FreeBSD-based, in fact, but their abstraction is also their burden: the GUI eventually doesn't expose the knob you need, and you end up editing a config file that the GUI may overwrite tomorrow.

Running plain FreeBSD as your router gives up the GUI and gains everything underneath: a stable kernel, the OpenBSD-derived `pf` firewall, jails for service isolation, ZFS for storage and rollback, and a documentation tradition that takes itself seriously. This post walks through how I build one.

## Hardware Pick

I'm boring on purpose, with one specific upgrade over the usual 4-port mini-PC recipe: dual SFP+ 10GbE so the WAN can be an XGS-PON SFP module instead of an ISP gateway.

-   **CWWK Intel Alder Lake N100 mini PC** (4C/4T, up to 3.4 GHz), 8 GB DDR5, 128 GB NVMe. The exact model has dual SFP+ 10 GbE plus four Intel I226-V 2.5 GbE ports, which gives you a 10G WAN and a 10G LAN trunk with copper to spare.
-   **2x Intel SFP+ 10 GbE**. The FreeBSD `ix(4)` driver is in base. One port is the WAN (with the XGS-PON SFP module installed), the other is the LAN trunk down to a managed switch.
-   **4x Intel I226-V 2.5 GbE**. The `igc(4)` driver, also in base. Useful for an OOB management LAN, a separate jail network, or simply spare capacity.
-   **WAN ONT**: [X-ONU-SFPP](https://pon.wiki/category/bgw320-500/) XGS-PON SFP+ module, pre-flashed with the 8311 community firmware. Takes the AT&T fiber directly via SC/APC, slots into `ix0`, and lets the FreeBSD box pull the public DHCP lease itself. Bring a USB-C cooler; these modules run hot.
-   **Downstream switch**: any decent managed switch with 802.1Q VLANs. I run a [Sodola 12-port 10G managed switch](https://a.co/d/0bHmg42w) (8x SFP+ / 4x 10GBase-T, 1U) so the LAN trunk side stays at line rate for fileserver and backup traffic.

Avoid Realtek NICs unless you enjoy writing forum posts. Intel chips are boring and that's the highest praise you can give a router NIC.

## Install Media

Grab the latest FreeBSD 15.x memstick image and write it to a USB drive:

```
# From a Linux/macOS box
curl -OL https://download.freebsd.org/releases/amd64/amd64/ISO-IMAGES/15.0/FreeBSD-15.0-RELEASE-amd64-memstick.img
sudo dd if=FreeBSD-15.0-RELEASE-amd64-memstick.img of=/dev/sdX bs=1M status=progress conv=fsync
```

Plug it in, boot the mini PC, and at the loader prompt drop into a serial console if your hardware supports it (most of these boxes do, via a console port on the front). Working over serial means you can recover from your own mistakes later.

## Install: ZFS Root, Auto, with One Tweak

bsdinstall is genuinely good. Walk through it normally and pick:

-   **Auto (ZFS)** for the partition layout
-   **stripe** with one disk (or **mirror** if you have two NVMe slots)
-   Enable `sshd` at the services prompt; everything else can wait
-   Add a non-root admin user in the `wheel` group

Reboot, log in over SSH from a workstation cabled to one of the LAN-side NICs, and don't touch a thing on the WAN side until pf is loaded.

## Naming the Wires

Before any configuration: figure out which physical port maps to which kernel interface name. `ifconfig` shows you the names; the labels on the case tell you which is which. With this build the SFP+ ports come up as `ix0` and `ix1`, and the four 2.5G copper ports come up as `igc0` through `igc3`.

```
$ ifconfig -l
ix0 ix1 igc0 igc1 igc2 igc3 lo0

$ ifconfig ix0 | grep status
        status: active
```

Convention I use:

-   `ix0`: WAN. The X-ONU-SFPP XGS-PON module lives in this slot, with the AT&T fiber going straight into its SC/APC connector.
-   `ix1`: LAN trunk down to the Sodola switch. Untagged traffic is the main LAN; VLAN 20 is tagged for a separate SSID/subnet.
-   `igc0`\-`igc3`: spare 2.5G ports, available for an OOB management LAN or future segmentation.

Before you cable up the WAN, make sure the X-ONU-SFPP is configured for your ISP per the [pon.wiki](https://pon.wiki/category/bgw320-500/) guide. The SFP module does the PON-side authentication; FreeBSD just sees an Ethernet link with DHCP behind it.

## /etc/rc.conf: the One File Most Routers Need

```
hostname="homefw"
zfs_enable="YES"

# Forwarding both IP versions
gateway_enable="YES"
ipv6_gateway_enable="YES"

# WAN: SFP+ port hosting the X-ONU-SFPP XGS-PON ONT
ifconfig_ix0="DHCP"
ifconfig_ix0_ipv6="inet6 accept_rtadv"
background_dhclient_ix0="YES"   # XGS-PON DHCP can be slow at boot

# LAN trunk and VLAN 20 (UniWork)
ifconfig_ix1="inet 10.0.0.1 netmask 255.255.255.0"
vlans_ix1="20"
ifconfig_ix1_20="inet 10.20.0.1/24"

# Firewall
pf_enable="YES"
pflog_enable="YES"

# DNS resolver (unbound from pkg)
unbound_enable="YES"

# DHCP server (from pkg) on both LAN segments
dhcpd_enable="YES"
dhcpd_ifaces="ix1 ix1.20"

# Time
ntpd_enable="YES"
ntpd_sync_on_start="YES"

# SSH (lock it down with pf, but enable here)
sshd_enable="YES"
```

Two lines in there are load-bearing in non-obvious ways. `background_dhclient_ix0="YES"` exists because the XGS-PON ONT can take a few seconds to settle and hand out a lease at boot; without backgrounding the dhclient call, the boot will block waiting for it, and that delay cascades into ntpd, unbound, and (via missing host keys on first boot) sshd. `vlans_ix1="20"` plus `ifconfig_ix1_20` create the `ix1.20` interface during boot. If that interface doesn't exist before pf loads, anything in pf that references it silently breaks, and the VLAN clients have no internet even though the rules look fine.

Apply piecewise:

```
$ service netif restart
$ sysctl net.inet.ip.forwarding=1
$ sysctl net.inet6.ip6.forwarding=1
```

## Bootstrap pf with a Safety Net

Don't start pf with an empty ruleset and rely on default-pass. Don't start it with a deny-all and lock yourself out either. Start with the smallest ruleset that keeps SSH and the LAN working, then iterate.

```
# /etc/pf.conf, bootstrap, replace with the real ruleset later
ext_if = "ix0"
lan_if = "ix1"
vlan20_if = "ix1.20"
lan_net = "10.0.0.0/24"
vlan20_net = "10.20.0.0/24"

set skip on lo0
scrub in all

# NAT outbound from both internal segments
nat on $ext_if from { $lan_net $vlan20_net } to any -> ($ext_if)

# Default deny inbound on the WAN
block in log on $ext_if all

# Pass internal traffic outbound, stateful
pass in on $lan_if    from $lan_net    to any keep state
pass in on $vlan20_if from $vlan20_net to any keep state
pass out all keep state
```

Validate before you load it:

```
$ pfctl -nf /etc/pf.conf
$ service pf start
$ pfctl -s rules
```

Order of operations matters here: the `ix1.20` interface has to exist before pf parses this file, otherwise the macros referencing it fail to resolve and the rules don't load. The rc.conf above brings the VLAN up during boot, so a normal boot is fine; the gotcha appears when you create the VLAN by hand later and forget to bring it up before reloading pf.

See the [pf.conf design article](pf-firewall-rules.html) for the production ruleset I actually use.

## unbound: Local Recursive DNS

I run the full `unbound` from `pkg` rather than the base *local\_unbound*, mostly so its config lives in `/usr/local/etc/unbound/` next to the rest of the pkg-managed services. Either works. Have it listen on the LAN and the VLAN:

```
# /usr/local/etc/unbound/unbound.conf (excerpt)
server:
  interface: 10.0.0.1
  interface: 10.20.0.1
  access-control: 127.0.0.0/8  allow
  access-control: 10.0.0.0/24  allow
  access-control: 10.20.0.0/24 allow
  access-control: 0.0.0.0/0    refuse

  hide-identity: yes
  hide-version: yes
  qname-minimisation: yes
  harden-glue: yes
  harden-dnssec-stripped: yes
  prefetch: yes
```

Restart:

```
$ service unbound restart
$ drill -u google.com @10.0.0.1   # check DNSSEC validation
```

Operational note from experience: a symptom that looks like a firewall problem ("ping works, web pages don't load") is almost always DNS in disguise. Check unbound first, pf second.

## dhcpd: Leases for the LANs

```
# /usr/local/etc/dhcpd.conf (excerpt)
default-lease-time 3600;
max-lease-time     86400;
authoritative;

subnet 10.0.0.0 netmask 255.255.255.0 {
  range 10.0.0.100 10.0.0.200;
  option routers 10.0.0.1;
  option domain-name-servers 10.0.0.1;
  option domain-name "lan";
}

subnet 10.20.0.0 netmask 255.255.255.0 {
  range 10.20.0.100 10.20.0.200;
  option routers 10.20.0.1;
  option domain-name-servers 10.20.0.1;
  option domain-name "uniwork";
}
```

## SSH: Belongs on the LAN, Not the WAN

Three things every router SSH config needs: key-only login, no root login, and a pf rule that limits SSH to the trusted LAN.

```
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no
ChallengeResponseAuthentication no
AllowUsers admin
ListenAddress 10.0.0.1
```

## ZFS Boot Environments: Cheap Insurance

Before you change anything important, snapshot the boot environment so a single reboot reverts you:

```
$ bectl create pre-pf-tightening
$ bectl list
BE                NAME      Active Mountpoint Space   Created
default                     NR     /          12.4G   2026-05-01 09:14
pre-pf-tightening                  -          1.04M   2026-05-03 17:42
```

If a pf change locks you out and you have console access:

```
$ bectl activate pre-pf-tightening
$ shutdown -r now
```

## Smoke Test

From a workstation on the main LAN (downstream of the Sodola switch on `ix1`):

```
$ ping -c 3 10.0.0.1              # router LAN address
$ ping -c 3 1.1.1.1               # outbound IP routing
$ host www.freebsd.org            # outbound DNS
$ traceroute www.freebsd.org      # full path
```

Then from a device on the UniWork SSID (VLAN 20, `10.20.0.0/24`), repeat. Both should reach the internet; neither should reach into the other's subnet without a deliberate pass rule.

If all of that works, you have a working FreeBSD edge router with the AT&T gateway out of the path.

<div style="background: var(--bg-surface); padding: 1rem; border: 1px solid var(--border-accent); border-left: 3px solid var(--accent-primary); margin: 1.5rem 0;"><p style="margin: 0;"><strong>Heads-up:</strong> This is the bare metal. The real work, clean pf rules, jails for services, monitoring, IPv6, lives in the <a href="../homelab.html">homelab tour</a> and the rest of this series.</p></div>

## Next Steps

-   [pf.conf: Writing Rules That Survive a Power Outage](pf-firewall-rules.html): replace the bootstrap ruleset with something deliberate
-   [FreeBSD Jails for Network Services](freebsd-jails-network.html): move DNS and monitoring out of the host
-   [FreeBSD vs Linux: An SRE's Take](freebsd-vs-linux-sre.html): context for why this stack pays off

Building a router along with this guide? [Send me your rc.conf](../contact.html). I always learn from how other people draw the lines.
