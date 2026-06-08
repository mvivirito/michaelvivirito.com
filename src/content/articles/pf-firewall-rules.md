---
title: "pf.conf: Writing Rules That Survive a Power Outage"
description: "A deep dive on FreeBSD pf rule design, macros, tables, NAT, anti-spoofing, state tracking, and a real residential gateway ruleset you can adapt."
date: 2026-05-10
keywords: "pf, pf.conf, FreeBSD, firewall, NAT, anti-spoofing, networking, security, packet filter"
ogTitle: "pf.conf: Writing Rules That Survive a Power Outage"
ogDescription: "A real, residential pf.conf, macros, tables, NAT, anti-spoofing, and the reasoning behind every line."
badges: ["FreeBSD", "pf", "Firewall", "Networking"]
related: ["freebsd-pf-router", "freebsd-ipv6-router", "freebsd-wireguard", "freebsd-jails-network"]
---
## The Rule You Actually Need to Remember

pf evaluates rules **top to bottom**, and the **last matching rule wins**, unless a rule uses `quick`, in which case evaluation stops at that rule. That single sentence is most of what makes pf rulesets behave the way they do; if you internalise it, the rest of pf.conf is much smaller than it looks.

This post is a tour of the ruleset I run on the FreeBSD router at the edge of my homelab. Nothing here is novel, it's all in pf.conf(5), but having a real, annotated example next to the manual page is what I wish I'd had when I started.

## The Sections of a pf.conf

pf.conf must appear in this order. Mixing the order produces confusing errors:

1.  **Macros**: variable definitions
2.  **Tables**: IP address sets, queryable at runtime
3.  **Options**: `set` directives that change pf behaviour
4.  **Traffic normalization**: `scrub`
5.  **Queueing**: ALTQ, optional
6.  **Translation**: `nat`, `rdr`, `binat`
7.  **Filter**: `block` and `pass`

## Macros and Tables: Stay DRY

```
# /etc/pf.conf

# --- macros ---
ext_if      = "ix0"          # WAN: SFP+ port hosting the X-ONU-SFPP XGS-PON ONT
lan_if      = "ix1"          # LAN trunk: SFP+ down to the Sodola switch
vlan20_if   = "ix1.20"       # VLAN 20 (UniWork) terminated on the trunk
int_ifs     = "{ " $lan_if " " $vlan20_if " }"

lan_net     = "10.0.0.0/24"
vlan20_net  = "10.20.0.0/24"
rfc1918     = "{ 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 }"

icmp_ok     = "{ echoreq unreach time-exceeded }"
tcp_svc     = "{ ssh http https }"

# --- tables ---
table <bogons>     persist file "/etc/pf.bogons"     # martian/bogon ranges
table <bruteforce> persist                           # populated by overload
table <blocklist>  persist file "/etc/pf.blocklist"  # known bad IPs
```

The CWWK chassis has four spare 2.5G `igc` ports next to the SFP+ slots. If you want a physically separate IoT or camera segment, drop one of those into the macros (`iot_if = "igc0"`, etc.) and follow the same shape of rules below. The version on disk just hasn't needed it yet, the VLAN already gives the work-network isolation I care about.

## Options: Sensible Defaults

```
# --- options ---
set skip on lo0
set block-policy drop
set state-policy if-bound
set loginterface $ext_if

# Traffic normalization: reassemble fragments, randomize TCP IDs
scrub in on $ext_if all fragment reassemble random-id
```

`block-policy drop` drops packets silently rather than sending TCP RSTs. `state-policy if-bound` ties state entries to specific interfaces, which makes anti-spoofing and asymmetric-routing bugs much louder instead of silently passing.

## NAT and Redirects

```
# --- translation ---
# Outbound NAT for everything in RFC1918
nat on $ext_if inet from $rfc1918 to any -> ($ext_if)

# Optional: redirect inbound HTTPS to a server on the trusted LAN
# rdr on $ext_if inet proto tcp from any to ($ext_if) port 443 \
#   -> 10.0.0.20 port 443
```

Note `($ext_if)` in parentheses: that resolves the address at packet time, not at load time. With the X-ONU-SFPP terminating PON on `ix0` and pulling DHCP from the ISP, this matters, the WAN address does change, and pf doesn't need to be reloaded when it does.

## Default Deny: Then Add Trust

```
# --- filter ---
# Default deny everywhere, log on the WAN
block in  log on $ext_if all
block in  on $int_ifs all
block out on $ext_if all
block return        # default for all "block" without modifier

# Drop bogons and known-bad immediately on the WAN
block in quick on $ext_if from { <bogons> <blocklist> } to any
block in quick on $ext_if from any to { <bogons> }

# Anti-spoofing: a packet arriving on $ext_if claiming a LAN source is bogus
antispoof quick for { $lan_if $vlan20_if }
```

The `antispoof` macro expands to a small set of rules that drop packets arriving on the wrong interface for their claimed source.

## Outbound: Trusted LAN and the Work VLAN Reach the Internet

```
# Main LAN (UniWorld): trusted, can reach anywhere
pass in  on $lan_if from $lan_net to any keep state
pass out on $ext_if from $lan_net to any keep state

# VLAN 20 (UniWork): reach the internet ONLY. Cannot reach the main LAN.
pass in  on $vlan20_if proto { tcp udp } from $vlan20_net to !$rfc1918 keep state
pass out on $ext_if              from $vlan20_net to any keep state
```

That `!$rfc1918` on the VLAN 20 ingress rule is the whole point of having UniWork on its own segment: a work device cannot, by rule, reach into the main LAN's address space. The router itself answers DHCP and DNS for the VLAN; nothing on the trusted LAN side does. The same pattern extends naturally if you split out a third segment on a spare igc port later.

## Inbound: Just Enough

```
# SSH only from the trusted LAN, with brute-force tarpitting
pass in on $lan_if proto tcp from $lan_net to ($lan_if) port ssh \
  flags S/SA keep state \
  (max-src-conn 5, max-src-conn-rate 5/60, \
   overload <bruteforce> flush global)

# DNS and DHCP, answer requests on every internal interface
pass in on $int_ifs proto { tcp udp } from any to (self) port domain keep state
pass in on $int_ifs proto udp        from any to (self) port { 67 68 } keep state

# NTP
pass in on $int_ifs proto udp from any to (self) port ntp keep state

# WireGuard listener (if used)
pass in on $ext_if proto udp from any to ($ext_if) port 51820 keep state
```

The SSH rule is more interesting than it looks. `overload <bruteforce>` moves any source that exceeds the rate limit into the `bruteforce` table; a separate `block quick from <bruteforce>` rule will then drop them, no matter what they try. `flush global` kills any open states they already have.

## ICMP: Allow, but Allow on Purpose

```
# Allow useful ICMP and traceroute return paths
pass inet  proto icmp  all icmp-type  $icmp_ok keep state
pass inet6 proto icmp6 all icmp6-type $icmp_ok keep state
```

Blanket-blocking ICMP feels secure but breaks Path MTU Discovery and traceroute, which makes future debugging harder. Allow specific types and trust state.

## Logging: pflog Is a Real Interface

Anything you tag with `log` shows up on the `pflog0` interface. You can tcpdump it like any other interface:

```
$ tcpdump -n -e -ttt -i pflog0
$ tcpdump -n -e -ttt -i pflog0 'host 10.0.0.42'
```

Pair this with a small log shipper to feed pf decisions into the same monitoring stack as everything else. (See the [Prometheus and Grafana setup](prometheus-grafana-monitoring).)

## Loading Safely

Validate before you load. Always.

```
# Parse-check only
$ pfctl -nf /etc/pf.conf

# Load
$ pfctl -f /etc/pf.conf

# Inspect
$ pfctl -s rules
$ pfctl -s nat
$ pfctl -s states | head
$ pfctl -t bruteforce -T show
```

For changes you're nervous about, use `at(1)` or `shutdown -r +5` as a dead-man's switch: schedule a reboot to a known-good boot environment, then load your new ruleset. If you lose the connection, the box reboots back to safety on its own.

## Common Pitfalls

-   **Order matters.** Macros first, then tables, options, scrub, translation, filter. The parser will yell, but the message isn't always obvious.
-   **`quick` changes everything.** Use it for explicit blocks at the top (bogons, blocklist) and for must-match rules, but realise it short-circuits the rest of evaluation.
-   **State doesn't survive ruleset reload.** By default pf keeps existing states across `pfctl -f`. If you need to flush them, `pfctl -F states`, but don't run that over SSH.
-   **NAT requires forwarding to be on.** `net.inet.ip.forwarding=1` and `gateway_enable="YES"` in rc.conf, or the rules pass nothing.
-   **Don't share `pf.conf` between hosts blindly.** Interface names and table contents differ; macros help, but every host's ruleset deserves its own review.

## The Whole File, in One Place

Everything above is in *pf.conf(5)*, but for completeness, the file as one block:

```
# /etc/pf.conf

# --- macros ---
ext_if      = "ix0"
lan_if      = "ix1"
vlan20_if   = "ix1.20"
int_ifs     = "{ " $lan_if " " $vlan20_if " }"

lan_net     = "10.0.0.0/24"
vlan20_net  = "10.20.0.0/24"
rfc1918     = "{ 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 }"

icmp_ok     = "{ echoreq unreach time-exceeded }"

# --- tables ---
table <bogons>     persist file "/etc/pf.bogons"
table <bruteforce> persist
table <blocklist>  persist file "/etc/pf.blocklist"

# --- options ---
set skip on lo0
set block-policy drop
set state-policy if-bound
set loginterface $ext_if

scrub in on $ext_if all fragment reassemble random-id

# --- translation ---
nat on $ext_if inet from $rfc1918 to any -> ($ext_if)

# --- filter ---
block in  log on $ext_if all
block in  on $int_ifs all
block out on $ext_if all

block in quick on $ext_if from { <bogons> <blocklist> <bruteforce> } to any
block in quick on $ext_if from any to <bogons>
antispoof quick for { $lan_if $vlan20_if }

pass in  on $lan_if    from $lan_net    to any keep state
pass out on $ext_if    from $lan_net    to any keep state

pass in  on $vlan20_if proto { tcp udp } from $vlan20_net to !$rfc1918 keep state
pass out on $ext_if              from $vlan20_net to any keep state

pass in on $lan_if proto tcp from $lan_net to ($lan_if) port ssh \
  flags S/SA keep state \
  (max-src-conn 5, max-src-conn-rate 5/60, \
   overload <bruteforce> flush global)

pass in on $int_ifs proto { tcp udp } from any to (self) port domain keep state
pass in on $int_ifs proto udp        from any to (self) port { 67 68 } keep state
pass in on $int_ifs proto udp from any to (self) port ntp keep state

pass inet  proto icmp  all icmp-type  $icmp_ok keep state
pass inet6 proto icmp6 all icmp6-type $icmp_ok keep state
```

## Where to Go Next

-   [Building a FreeBSD pf Router](freebsd-pf-router): the hardware and OS install that this ruleset runs on
-   [FreeBSD Jails for Network Services](freebsd-jails-network): once your router is solid, move services off the host
-   [FreeBSD vs Linux: An SRE's Take](freebsd-vs-linux-sre): why pf and the FreeBSD networking stack feel coherent

If you've spotted something I should tighten, please [tell me](../contact). Firewalls get better with every honest pair of eyes.
