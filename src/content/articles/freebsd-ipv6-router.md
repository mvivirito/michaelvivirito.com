---
title: "IPv6 for Home Networks: A FreeBSD Walkthrough"
description: "A practical guide to running real, native IPv6 on a FreeBSD home router. Prefix delegation, rtsold, dhcp6c, rtadvd, and pf rules, without breaking your IPv4 setup."
date: 2026-05-10
keywords: "IPv6, FreeBSD, pf, networking, DHCPv6-PD, rtadvd, rtsold, dhcp6c, prefix delegation, home network"
ogTitle: "IPv6 for Home Networks: A FreeBSD Walkthrough"
ogDescription: "Real, native IPv6 on a FreeBSD router, DHCPv6-PD, rtsold, dhcp6c, rtadvd, and pf rules."
badges: ["FreeBSD", "IPv6", "Networking", "pf"]
related: ["ipv6-prefix-delegation-troubleshooting", "freebsd-pf-router", "pf-firewall-rules", "freebsd-wireguard"]
---
## Why You Should Care About v6 in 2026

Most residential ISPs in North America and Europe now hand out real IPv6 prefixes for free, alongside CGNAT'd IPv4. If you're not using v6, you're sharing one IPv4 address with your neighbours and inheriting all the weirdness that comes with it: failed inbound connections, broken games, mysterious rate limits, and zero ability to host anything.

Native v6 fixes all of that. Every device on your LAN gets a globally routable address. Hosting a service to a friend becomes a one-line pf rule. And the configuration on FreeBSD is genuinely smaller than the IPv4 NAT setup it replaces, there's nothing to translate.

## The Moving Pieces

-   **rtsold**: listens for IPv6 Router Advertisements (RAs) from your ISP on the WAN.
-   **dhcp6c** (from the `net/dhcp6` port): speaks DHCPv6 to the ISP and asks for a prefix delegation (PD), typically a /56 or /60.
-   **rtadvd**: sends RAs to your LAN interfaces, telling clients their prefix and gateway.
-   **pf**: filters v6 traffic the same way it filters v4, with a few v6-specific must-allow rules.

That's the whole stack. No NAT66, no proxies, no gateway VMs. The router forwards packets and the LAN gets real addresses.

## Step 1: Tell the Kernel It's a v6 Router

```
# /etc/rc.conf

# IPv4 forwarding (you presumably already have this)
gateway_enable="YES"

# IPv6 forwarding and accept-RA on the WAN
ipv6_gateway_enable="YES"
ipv6_cpe_wanif="ix0"

# Accept RAs only on the WAN (the SFP+ port hosting the XGS-PON ONT);
# advertise on the LAN trunk and the VLAN.
ifconfig_ix0_ipv6="inet6 accept_rtadv -ifdisabled"
ifconfig_ix1_ipv6="inet6 -ifdisabled"
ifconfig_ix1_20_ipv6="inet6 -ifdisabled"

# Daemons
rtsold_enable="YES"
rtsold_flags="-aF"
rtadvd_enable="YES"
rtadvd_interfaces="ix1 ix1.20"
```

`ipv6_cpe_wanif` is the magic switch that flips a FreeBSD box into "I am the customer-premises router for v6" mode. It tightens up forwarding and ICMP defaults so the box behaves correctly as the edge.

## Step 2: dhcp6c: Ask for a Prefix

Install the client and add a config:

```
$ pkg install dhcp6
```

```
# /usr/local/etc/dhcp6c.conf
interface ix0 {
    send ia-pd 0;
    send ia-na 0;
    request domain-name-servers;
    script "/usr/local/etc/dhcp6c-script";
};

id-assoc pd 0 {
    prefix-interface ix1 {
        sla-id  1;
        sla-len 8;
    };
    prefix-interface ix1.20 {
        sla-id  2;
        sla-len 8;
    };
};

id-assoc na 0 { };
```

If your ISP delegates a /56, `sla-len 8` carves it into 256 independent /64s, one per LAN, with 254 to spare. `sla-id` picks which slice each LAN gets, here the main LAN takes the first /64 and VLAN 20 takes the second.

```
# /etc/rc.conf (continued)
dhcp6c_enable="YES"
dhcp6c_interfaces="ix0"
```

## Step 3: rtadvd: Tell the LAN What Its Prefix Is

rtadvd's defaults are reasonable; you usually only need `rtadvd_interfaces` in rc.conf. If you want to override things explicitly, drop a config:

```
# /etc/rtadvd.conf  (optional, defaults are usually fine)
ix1:\
    :raflags="mo":\
    :rltime#1800:\
    :addrs#1: \
    :addr="auto":\
    :pltime#600:vltime#1200:

ix1.20:\
    :raflags="mo":\
    :rltime#1800:
```

`raflags="mo"` sets the *Managed* and *Other* flags so clients also do DHCPv6 if you want stateful assignment. For pure SLAAC, drop the `m`.

## Step 4: pf, but for v6

Most of your existing [pf ruleset](pf-firewall-rules.html) handles both families if you wrote `inet`\-agnostic rules. But IPv6 needs a few specific rules to behave:

```
# --- IPv6 must-allow ---
# ICMPv6 is structural, not optional. Path MTU, NDP, RA all live here.
icmp6_ok = "{ echoreq echorep neighbrsol neighbradv routersol routeradv \
              unreach toobig timex paramprob }"

pass inet6 proto icmp6 all icmp6-type $icmp6_ok keep state

# DHCPv6 client traffic to/from the WAN
pass in  on $ext_if inet6 proto udp from any to any port { 546 547 } keep state
pass out on $ext_if inet6 proto udp from any to any port { 546 547 } keep state

# Anti-spoofing for v6 (covers v4 with the same antispoof you already have)
antispoof quick for { $lan_if $vlan20_if } inet6
```

**Do not blanket-block ICMPv6.** v6 depends on it for neighbour discovery (the v6 equivalent of ARP), Path MTU, and RA, block it and your network silently falls apart in interesting ways.

## Step 5: Smoke Test

```
# On the router
$ ifconfig ix1 inet6
        inet6 fe80::1%ix1 prefixlen 64 scopeid 0x2
        inet6 2001:db8:cafe:1::1 prefixlen 64

$ ndp -an              # neighbour table
$ netstat -rn -f inet6 # routing table

# On a LAN client
$ ping6 -c 3 ipv6.google.com
$ traceroute6 ipv6.google.com
$ curl -6 https://ifconfig.co
```

If the LAN client gets a global address starting with `2` or `3` and pings the outside, you have working native v6.

## Hosting a Service: NAT-Free and Beautiful

With v6 there's no port forwarding because there's no NAT. The server has its own address, you just open the port:

```
# Allow inbound HTTPS to a server inside the homelab
pass in on $ext_if inet6 proto tcp \
  from any to 2001:db8:cafe:2::20 port https keep state
```

Hand a friend the AAAA record and they connect directly. No router config on their side, no UPnP, no STUN. This is what the protocol was designed to do.

## Common Pitfalls

-   **Privacy extensions.** Most clients use temporary v6 addresses for outbound traffic by default. That's fine, but don't expect a stable outbound IP per client unless you turn the temp addresses off. On FreeBSD, `net.inet6.ip6.use_tempaddr=0`.
-   **Link-local vs global.** `fe80::/10` is link-local and never routable. If you copy-paste a v6 address that starts with `fe80:`, you also need a scope ID like `%ix1`.
-   **RA flapping.** If you accidentally have two devices sending RAs on the same LAN (an ISP router still attached, plus your FreeBSD box), clients will flip between prefixes. Pick one source of truth.
-   **MTU.** Some PPPoE-style WANs have a smaller MTU on v6 than v4. Allow `icmp6-type toobig` through pf so PMTUD works, or things will hang at random.
-   **DNS over v6.** Make sure your DNS server (unbound, etc.) listens on a v6 address and is advertised via DHCPv6 / RDNSS. Otherwise v6-only clients can't resolve anything.

## What You Lose, What You Gain

You lose the comforting illusion of NAT-as-firewall, every device is now directly reachable, in principle, from anywhere. That's why `pf`'s default-deny on the WAN is non-negotiable.

You gain a working internet. Real addresses, real routing, no more games of port-forward tetris. Connections that "just don't work" over IPv4 mostly do over v6.

## Where to Go Next

-   [IPv6 Prefix Delegation: A Troubleshooting Cookbook](ipv6-prefix-delegation-troubleshooting.html): the companion debugging guide for when the steps above don't go to plan
-   [Building a FreeBSD pf Router](freebsd-pf-router.html): the host this all runs on
-   [pf.conf: Writing Rules That Survive a Power Outage](pf-firewall-rules.html): the IPv4 ruleset that pairs with this
-   [WireGuard on FreeBSD: A 30-Minute Setup](freebsd-wireguard.html): how the v6 prefix makes road-warrior VPN setup nicer

Run a different ISP or a different setup? [Send me your config](../contact.html). I'd love to add a section for setups that aren't mine.
