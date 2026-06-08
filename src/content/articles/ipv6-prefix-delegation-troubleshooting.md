---
title: "IPv6 Prefix Delegation: A Troubleshooting Cookbook"
description: "A field guide to debugging IPv6 prefix delegation on a FreeBSD home router. dhcp6c silence, missing RAs, broken DNS, PMTU oddities, and a tcpdump cheatsheet."
date: 2026-05-10
keywords: "IPv6, DHCPv6-PD, prefix delegation, FreeBSD, dhcp6c, rtadvd, rtsold, troubleshooting, networking, pf, RA, RDNSS"
ogTitle: "IPv6 Prefix Delegation: A Troubleshooting Cookbook"
ogDescription: "When DHCPv6-PD on FreeBSD goes silent, the things to check, in the order to check them."
badges: ["FreeBSD", "IPv6", "Troubleshooting", "Networking"]
related: ["freebsd-ipv6-router", "pf-firewall-rules", "freebsd-pf-router", "freebsd-wireguard"]
---
## Why This Post Exists

The [main IPv6 setup post](freebsd-ipv6-router.html) shows you the happy path. This post is everything you reach for when the happy path doesn't happen. Most of these are things I've broken, sometimes more than once, on my own router.

## The 60-Second Checklist

Before you go deep, sanity-check the obvious:

1.  `sysctl net.inet6.ip6.forwarding`: should be `1`.
2.  `ifconfig $ext_if` shows a link-local v6 address (`fe80::`) and the `ACCEPT_RTADV` flag.
3.  `service dhcp6c status` says it's running.
4.  `service rtadvd status` says it's running, on the LAN-side interfaces.
5.  The WAN cable is the WAN cable. (You laugh, but.)

If any of those is off, fix that first; the rest of the post probably won't help.

## Symptom: dhcp6c Won't Even Try

If dhcp6c starts but the WAN never sees DHCPv6 traffic:

```
$ tcpdump -ni $ext_if 'udp port 546 or udp port 547'
```

Crickets? Check that the interface is actually up and that `accept_rtadv` is set. Without an RA from upstream, dhcp6c won't send a SOLICIT in `statefulonly` mode (which is the default for many configs). The fix is usually one of:

-   `ifconfig $ext_if inet6 accept_rtadv -ifdisabled`: apply now.
-   Set `ifconfig_${ext_if}_ipv6="inet6 accept_rtadv"` in `/etc/rc.conf`: apply on reboot.
-   Set `rtsold_enable="YES"` and `rtsold_flags="-aF"` so rtsold actively probes for RAs at boot.

## Symptom: dhcp6c Tries But Gets Nothing

You see dhcp6c sending SOLICITs, but no ADVERTISE in reply:

```
$ tcpdump -ni $ext_if -vv 'udp port 547'
... > ff02::1:2.547: dhcp6 solicit
(silence)
```

Most common causes, in order of likelihood:

-   **The ISP doesn't actually delegate.** Some hand out a /128 on the WAN and call that "IPv6". Open a chat ticket and ask explicitly: "Do you do DHCPv6-PD on this plan, and what prefix size?" If the answer is no, none of the configuration tweaks below will help.
-   **You're behind a CPE that's already doing PD.** The ISP's modem grabbed the prefix; you can't take it. Bridge the modem (or put it in passthrough mode) so your FreeBSD box terminates the WAN.
-   **VLAN tagging.** Some ISPs use a tagged WAN VLAN. Your interface needs a matching `vlanX` child, and dhcp6c needs to run on that interface, not the parent.
-   **Authentication.** Some ISPs require a specific DUID or authentication string. Check support pages or community wikis for your provider.

## Symptom: dhcp6c Got a Prefix, but the LAN Is Quiet

dhcp6c logs say it received a /56, your `ix1` has a v6 address, and nothing on the LAN gets one. First, confirm the prefix actually landed:

```
$ ifconfig ix1 inet6
        inet6 fe80::1%ix1 prefixlen 64 scopeid 0x2
        inet6 2001:db8:cafe:1::1 prefixlen 64

$ netstat -rn -f inet6 | grep ix1
```

If the global address isn't there, dhcp6c's script didn't apply it to the LAN interface. Check `/usr/local/etc/dhcp6c.conf` for the `prefix-interface` blocks, and confirm the `script "/usr/local/etc/dhcp6c-script"` line points at a script that actually runs `ifconfig` on receipt.

## Symptom: rtadvd Sends Nothing

Even with the LAN address present, clients don't see RAs:

```
# From the router, look at what rtadvd is sending
$ tcpdump -ni ix1 'icmp6 and ip6[40] == 134'
```

ICMP6 type 134 is *Router Advertisement*. If you see no traffic, rtadvd isn't running or isn't bound to that interface. Check:

-   `service rtadvd status`
-   `rtadvd_interfaces` in `/etc/rc.conf` includes the LAN interface
-   The interface has a global v6 address (rtadvd refuses to advertise on link-local-only interfaces)
-   If you wrote a `/etc/rtadvd.conf`, the syntax is *intentionally cryptic*, see `rtadvd.conf(5)`. A typo there is a common source of silence.

## Symptom: Clients Get Addresses but Can't Resolve

DNS over v6 has two delivery mechanisms:

-   **RDNSS**: RA option that includes recursive DNS server addresses. Modern clients use this.
-   **DHCPv6 stateless**: clients ask DHCPv6 for DNS info even though they SLAAC for the address.

On rtadvd, RDNSS is enabled with a config file:

```
# /etc/rtadvd.conf
ix1:\
    :rdnss="2001:db8:cafe:1::1":\
    :dnssl="lan":
```

On dhcp6s (if you also want stateless DHCPv6 for older clients), point clients at the same address. But honestly: RDNSS works on every modern OS, so start there.

## Symptom: Pings Work, TCP Doesn't

Classic Path MTU bug. v6 doesn't fragment in transit; if a packet is too big for a hop, the router sends back `icmp6-type toobig`. If pf drops that, large TCP packets vanish into the void.

```
# Make sure pf is letting these through
pass inet6 proto icmp6 all icmp6-type { toobig unreach paramprob } keep state
```

If TCP works for short responses but hangs on large transfers, this is almost always the cause. Confirm with:

```
$ ping6 -s 1450 -D ipv6.google.com
$ ping6 -s 1500 -D ipv6.google.com   # may fail with PMTU=1492 or similar
```

## Symptom: Everything Works, Then Doesn't

v6 works for a few hours, then a client's address goes stale. Causes:

-   **Prefix lifetimes.** rtadvd's default valid-lifetime is 30 minutes. If rtadvd dies, addresses age out. Set `vltime` and `pltime` generously, but not so generous that a real change (ISP reassigns prefix) takes a day to clear.
-   **ISP rotates the prefix.** Some ISPs change your delegated prefix on every renew. dhcp6c picks up the new one, but rtadvd needs to switch its advertisements. Restart rtadvd in your dhcp6c hook script: `service rtadvd restart`.
-   **Privacy addresses confusing your firewall logs.** Clients generate temporary v6 addresses for outbound traffic. They aren't a bug, but "the device that did X" can be hard to identify after the fact. `net.inet6.ip6.use_tempaddr` sysctl, applied per-host.

## The pf Side

v6-specific things that bite:

-   **antispoof for inet6.** The IPv4 antispoof rule doesn't cover v6 by default. Add `antispoof quick for { ... } inet6`.
-   **NDP traffic.** Don't block ICMP6 types `neighbrsol` or `neighbradv`: they're v6's ARP. If you do, neighbours go silent.
-   **Rule order.** A blanket `block in` at the top of the WAN ruleset blocks ICMP6 too unless you specifically pass it. Pass v6 ICMP early; the existing v4 ICMP `pass` doesn't cover v6.

## The tcpdump Cookbook

```
# DHCPv6 traffic on the WAN
$ tcpdump -ni $ext_if -vv 'udp port 546 or udp port 547'

# Router solicitations and advertisements on the LAN
$ tcpdump -ni ix1 'icmp6 and (ip6[40] == 133 or ip6[40] == 134)'

# Neighbour solicitations / advertisements
$ tcpdump -ni ix1 'icmp6 and (ip6[40] == 135 or ip6[40] == 136)'

# Anything ICMPv6 on a given interface
$ tcpdump -ni ix1 'icmp6'

# Watch only multicast (RAs, NDP)
$ tcpdump -ni ix1 'ip6 multicast'

# Pflog for v6 specifically
$ tcpdump -ni pflog0 'inet6'
```

## Useful sysctls

```
# See current values
$ sysctl net.inet6.ip6 | grep -iE 'forward|tempaddr|accept'

# Common ones to know
net.inet6.ip6.forwarding             # 1 if router
net.inet6.ip6.accept_rtadv           # 1 to listen for RAs (set per-iface usually)
net.inet6.ip6.use_tempaddr           # 1 to enable privacy addresses
net.inet6.ip6.prefer_tempaddr        # 1 to prefer them on outbound
net.inet6.icmp6.nd6_useloopback      # 1 by default; rarely needs changing
net.inet6.ip6.no_radr                # 1 to ignore default routes from RAs (don't set on a CPE)
```

## When to Stop and Reboot

IPv6 has more state spread across more daemons than IPv4. Sometimes the right move, after you've checked everything reasonable, is:

```
$ service rtadvd stop
$ service dhcp6c  stop
$ ifconfig ix1 inet6 -alias 2001:db8:cafe:1::1
$ ifconfig ix0 down up
$ service dhcp6c  start
$ service rtadvd start
```

That sequence brings everything down, clears any stuck addresses, and brings things back up in the right order. It's not a real fix, but the sun's coming up, your kid wants the wifi back, and tomorrow you'll diff the configs to figure out what changed.

## The Reading List

-   [rtadvd.conf(5)](https://man.freebsd.org/cgi/man.cgi?query=rtadvd.conf&sektion=5): read the syntax notes carefully, more than once
-   [dhcp6c.conf(5)](https://man.freebsd.org/cgi/man.cgi?query=dhcp6c.conf): the prefix-interface stanza is what most "it works on my Linux box" articles miss on FreeBSD
-   [RFC 8415 (DHCPv6)](https://datatracker.ietf.org/doc/html/rfc8415): surprisingly readable for an RFC
-   [RFC 4861 (Neighbor Discovery)](https://datatracker.ietf.org/doc/html/rfc4861): what the ICMP6 types in this post actually mean

## Where to Go Next

-   [IPv6 for Home Networks: A FreeBSD Walkthrough](freebsd-ipv6-router.html): the happy path that this post debugs
-   [pf.conf: Writing Rules That Survive a Power Outage](pf-firewall-rules.html): the v4 ruleset; pair it with the v6 must-allows above
-   [Building a FreeBSD pf Router](freebsd-pf-router.html): the host underneath all of this

Stuck on a symptom I haven't covered? [Mail me a tcpdump capture](../contact.html) and I'll happily add it to the post.
