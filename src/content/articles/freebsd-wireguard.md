---
title: "WireGuard on FreeBSD: A 30-Minute Setup"
description: "A practical, no-fluff guide to running a WireGuard VPN on FreeBSD. Kernel module, key generation, server and client config, pf rules, and DNS through the tunnel."
date: 2026-05-10
keywords: "WireGuard, FreeBSD, VPN, networking, pf, road warrior, kernel module, wg-tools, mobile VPN"
ogTitle: "WireGuard on FreeBSD: A 30-Minute Setup"
ogDescription: "A working WireGuard VPN on FreeBSD in under 30 minutes, server, clients, pf, and DNS."
badges: ["FreeBSD", "WireGuard", "VPN", "Networking"]
related: ["freebsd-pf-router", "pf-firewall-rules", "freebsd-ipv6-router", "freebsd-jails-network"]
---
## Why WireGuard

WireGuard fits in your head. The protocol is small enough to read in an evening, the userland config file is half a screen, and the Linux/FreeBSD kernel modules are well-audited. Compared to OpenVPN, TLS, certificates, MTU bargaining, weeks of "why does my phone disconnect every 30 seconds", WireGuard is a relief.

On FreeBSD, the kernel module is in base since 13.0 (`if_wg(4)`) and the userland tools live in `net/wireguard-tools`. Setup takes about as long as reading this post.

## The Mental Model

WireGuard is point-to-point at the protocol level: every endpoint is a "peer", identified by a public key. There's no client/server distinction in the protocol, the labels are about who initiates and who has a static IP. A "VPN server" is just a peer with a public WAN address that other peers connect to.

Each peer has:

-   A **private key** (kept secret, generated locally)
-   A **public key** (shared with peers)
-   A list of **AllowedIPs** per peer (which destinations route to that peer)
-   Optionally, a **PresharedKey** for post-quantum-friendly mixing

## Install

```
$ pkg install wireguard-tools
$ kldload if_wg                 # load now
$ sysrc kld_list+=if_wg         # load on boot
```

Confirm the kernel module is up:

```
$ kldstat | grep wg
 12    1 0xffffffff82800000   12340  if_wg.ko
```

## Generate Keys for the Router

```
$ umask 077
$ mkdir -p /usr/local/etc/wireguard
$ cd /usr/local/etc/wireguard
$ wg genkey | tee privatekey | wg pubkey > publickey
$ cat publickey
3v9ZZ...= 
```

That public key is what every peer will need. The private key never leaves the router.

## Server Config

```
# /usr/local/etc/wireguard/wg0.conf

[Interface]
PrivateKey = <contents of privatekey>
ListenPort = 51820
Address    = 10.66.66.1/24

# Each [Peer] block is one client
[Peer]
# laptop
PublicKey  = <laptop public key>
AllowedIPs = 10.66.66.10/32

[Peer]
# phone
PublicKey  = <phone public key>
AllowedIPs = 10.66.66.11/32
```

On FreeBSD, AllowedIPs on the server side is **also a routing table entry**. Anything inside `10.66.66.10/32` is routed to the laptop peer. Don't make the AllowedIPs overlap between peers; the kernel will complain and you'll lose your afternoon.

## Bring It Up

```
# /etc/rc.conf
wireguard_enable="YES"
wireguard_interfaces="wg0"
```

```
$ service wireguard start
$ wg show wg0
interface: wg0
  public key: 3v9ZZ...
  private key: (hidden)
  listening port: 51820

peer: laptop-pubkey-here
  allowed ips: 10.66.66.10/32

peer: phone-pubkey-here
  allowed ips: 10.66.66.11/32
```

## pf Rules: Listener and Forwarding

```
# Allow the WireGuard listener on the WAN
pass in on $ext_if proto udp from any to ($ext_if) port 51820 keep state

# Allow VPN clients into the LAN, NAT'd as the router
pass in  on wg0     from 10.66.66.0/24 to any keep state
pass out on $ext_if from 10.66.66.0/24 to any keep state

# If you want VPN clients to reach the trusted LAN unmodified
nat on $ext_if from 10.66.66.0/24 to any -> ($ext_if)
```

The [main pf ruleset](pf-firewall-rules) already handles outbound NAT for RFC1918, if you tagged the VPN subnet into `$rfc1918` or your `nat` source set, you don't need a separate rule.

## Client Configs

Generate the client's keys on the client (never on the server):

```
$ wg genkey | tee laptop.privatekey | wg pubkey > laptop.publickey
```

Then build a config the client can import:

```
# laptop.conf
[Interface]
PrivateKey = <laptop privatekey>
Address    = 10.66.66.10/32
DNS        = 10.0.0.1

[Peer]
PublicKey         = <router public key>
Endpoint          = vpn.example.com:51820
AllowedIPs        = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
```

On the client side, AllowedIPs means "send traffic for these destinations into the tunnel". `0.0.0.0/0, ::/0` means "everything", full tunnel. If you want split tunnel, list only the LAN ranges you want to reach.

## Phone Setup

The official WireGuard apps for iOS and Android both read QR codes. Generate one from the client config:

```
$ pkg install qrencode
$ qrencode -t ansiutf8 < phone.conf
```

Hold the phone up, scan, accept. The phone is on the VPN. Total elapsed time: about 30 seconds.

## DNS Through the Tunnel

If you set `DNS = 10.0.0.1` in the client config (your router's unbound), every DNS query from the client goes through the tunnel. This is usually what you want, it means the client's queries aren't visible to the coffee shop wifi, and clients can resolve your internal hostnames.

Don't forget to allow that traffic on the router-side pf:

```
pass in on wg0 proto { tcp udp } from 10.66.66.0/24 to (self) port domain keep state
```

## Persistent Keepalive: When You Need It

If a client is behind NAT (most phones, most laptops on hotel wifi), the upstream NAT mapping for the WireGuard UDP flow will eventually time out, and the next inbound packet from the server will get dropped. Setting `PersistentKeepalive = 25` on the client tells it to send a heartbeat every 25 seconds, which keeps the NAT mapping alive.

Don't set keepalive on the server side. Servers with public IPs don't need it, and setting it just burns battery on idle connections.

## Troubleshooting

-   **Handshake never completes.** Check the firewall on the WAN, `pf` needs to `pass in` UDP 51820. Tcpdump on `$ext_if` for `udp port 51820` to confirm packets arrive.
-   **Handshake completes but no traffic.** Check AllowedIPs on both ends. Server must list the client's tunnel IP; client must list the destinations it wants to reach. Then check your pf `pass` rules for the `wg0` interface.
-   **MTU weirdness.** WireGuard adds 60 bytes of overhead. If your WAN MTU is 1500, the WireGuard MTU is effectively 1420. Most platforms handle this automatically, but on flaky links you can pin it with `MTU = 1400` in the client config.
-   **Clock skew.** WireGuard doesn't care about wall-clock time for handshakes, but if a client's clock is years off and you're using certificate-based auth elsewhere on the same VPN, you'll waste time chasing the wrong bug. `ntpd` on every endpoint.

## Operational Habits

-   **Key rotation.** Cheap. Generate new keys, swap the configs, restart. Take a snapshot first.
-   **Per-device peers.** One peer per device, not one shared credential. Lost phone? Delete the peer, no key rotation needed elsewhere.
-   **Document the AllowedIPs map.** A small Markdown file mapping tunnel IPs to devices saves real time the next time you debug.
-   **Backup the configs and keys offline.** Encrypted USB, paper printout, however you back up secrets, but not just on the router itself.

## Going Further

-   [Building a FreeBSD pf Router](freebsd-pf-router): the host this VPN attaches to
-   [pf.conf: Writing Rules That Survive a Power Outage](pf-firewall-rules): pf integration in detail
-   [IPv6 for Home Networks](freebsd-ipv6-router): once you have v6, WireGuard over v6 is the same config with different addresses

Got a different topology, site-to-site, mesh, hub-and-spoke? [Tell me about it](../contact). I'm always curious how other people lay out their VPN graphs.
