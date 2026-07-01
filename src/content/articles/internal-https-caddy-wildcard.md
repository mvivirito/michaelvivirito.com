---
title: "Real HTTPS for Every Homelab Service with Caddy"
description: "Give every internal homelab service a clean name and a real, browser-trusted HTTPS cert with a Caddy reverse proxy: one wildcard Let's Encrypt cert via DNS-01, split-horizon Unbound so the names resolve only at home, and the Unbound gotcha that breaks the ACME challenge."
date: 2026-06-28
keywords: "Caddy, reverse proxy, Let's Encrypt, DNS-01, wildcard certificate, Cloudflare, unbound, split-horizon DNS, split DNS, ACME, homelab, internal HTTPS, Tailscale, self-signed, TLS"
ogTitle: "Real HTTPS for Every Homelab Service with Caddy"
ogDescription: "A Caddy reverse proxy gives every internal homelab service a real name and a valid cert via a wildcard DNS-01 challenge, with split-horizon Unbound so the names resolve only at home. Plus the Unbound bug that breaks ACME."
badges: ["Caddy", "TLS", "Reverse Proxy", "DNS", "Homelab"]
related: ["freebsd-pf-router", "version-control-freebsd-firewall", "beryl-7-tailscale-travel-router", "prometheus-grafana-monitoring"]
---

## Clean Names, Real Encryption

Every internal web UI in my homelab lived at a bare IP like `https://10.0.0.150`, each with a self-signed cert and the red browser warning that comes with it. Two things bugged me: I wanted clean, real names for every service, and I wanted the traffic actually encrypted with a cert browsers trust, even inside my own LAN. A [Caddy](https://caddyserver.com/) reverse proxy delivers both: one wildcard Let's Encrypt cert in front of every internal service. Here is how it fits together and how to build it.

## Three Independent Pieces

My requirements: real names (`git.home.michaelvivirito.com`, not an IP or a fake `.home` TLD), a browser-trusted auto-renewing cert, nothing exposed to the public internet, and one wildcard cert so a new service is a two-line change instead of a certificate ceremony. That last pair is in tension, a normal Let's Encrypt cert wants the world to reach port 80, the opposite of "nothing exposed", and a wildcard issued over DNS is the way out.

"A service with a valid cert on my LAN" is really three separate problems that meet at the proxy:

```
You type:  https://git.home.michaelvivirito.com
   │
   │ 1. a name that resolves
   ▼
Unbound on the router (10.0.0.1)     ← split-horizon: *.home.michaelvivirito.com
   │  returns 10.0.0.5                   resolves to the proxy, on the LAN only
   ▼
Caddy (10.0.0.5:443)                 ← 2. a valid cert: serves the wildcard
   │  matches host, reverse-proxies      *.home.michaelvivirito.com certificate
   ▼
Gitea (10.0.0.150:80)                ← 3. routing: the real service answers,
                                        Caddy streams it back over HTTPS
```

A name that resolves (Unbound), a trusted cert (Caddy plus Let's Encrypt), and routing (Caddy). Keep them separate and it stays legible; conflate them and you debug a cert problem by editing DNS, which I did.

## Why Caddy

Caddy runs in an unprivileged container at a static `10.0.0.5`, and its whole config is one file. It won on two points. Automatic HTTPS is the product, not a bolt-on: it obtains and renews certs itself, where nginx makes you assemble certbot plus a renewal timer plus reload hooks. And it stays local. A [Cloudflare Tunnel](https://www.cloudflare.com/products/tunnel/) is the other common answer, and I use one for the single service I expose publicly, but routing internal traffic out to Cloudflare and back to reach a box two meters away is a LAN dependency I do not want. If my internet is down, my internal services should not be.

## A Wildcard Cert Without Exposing Anything

The trick that gets a valid cert with nothing exposed is the ACME **DNS-01** challenge. Instead of answering on port 80, Caddy proves control by writing a DNS record: it asks Let's Encrypt for `*.home.michaelvivirito.com`, gets a token to publish as a TXT record at `_acme-challenge.home.michaelvivirito.com`, uses a Cloudflare API token to create it, and Let's Encrypt reads it back from Cloudflare's nameservers and issues the cert. Nothing on my network accepts an inbound connection; the only outside contact is one API call to Cloudflare.

```
*.home.michaelvivirito.com {
	tls {
		dns cloudflare {env.CF_API_TOKEN}
		resolvers 10.0.0.1
	}

	@git host git.home.michaelvivirito.com
	handle @git {
		reverse_proxy 10.0.0.150:80
	}

	@pbs host pbs.home.michaelvivirito.com
	handle @pbs {
		reverse_proxy https://10.0.0.142:8007 {
			transport http { tls_insecure_skip_verify }
		}
	}

	# ...one block per internal service: Proxmox, PBS, Open WebUI, and the rest
}
```

Some backends (Proxmox and Proxmox Backup Server) only speak HTTPS, with their own self-signed certificate. There are two encrypted hops here: your browser to Caddy, and Caddy to the backend. The browser-to-Caddy hop uses the real Let's Encrypt cert, and that is what shows the green lock. On the Caddy-to-backend hop, `tls_insecure_skip_verify` tells Caddy to accept the backend's self-signed cert instead of rejecting it. That is fine: the traffic is still encrypted, and both ends are containers on the same host, so there is no one in the middle to impersonate.

The Cloudflare API token is the one secret here. I scoped it narrowly, `dns_records:edit` on this one zone, pinned it to my home IP, and keep it out of Git.

## The Unbound Gotcha That Ate an Evening

Caddy resolves DNS through my router's Unbound (`resolvers 10.0.0.1`), because I route all DNS through Unbound and did not want a firewall exception for the proxy. Two Unbound behaviors then broke the cert.

**Problem 1: the challenge went to the wrong place.** To pass the DNS-01 challenge, Caddy creates the `_acme-challenge` TXT record in the DNS zone that actually owns the domain, which for me is `michaelvivirito.com` at Cloudflare. It finds that zone by asking DNS which server is authoritative for the name (an SOA lookup) and walking up the domain until it gets an answer.

My first attempt used a `redirect` local-zone in Unbound. A `redirect` zone answers *everything* under the name from local data, including that authority question, so when Caddy asked, Unbound answered as if it owned `home.michaelvivirito.com`. Caddy believed it, decided that was the zone, and tried to create the record there through Cloudflare, which has never heard of it. The fix is a `transparent` zone instead:

```
# /usr/local/etc/unbound/unbound.conf
local-zone: "home.michaelvivirito.com." transparent
local-data: "git.home.michaelvivirito.com. A 10.0.0.5"
local-data: "pbs.home.michaelvivirito.com. A 10.0.0.5"
# ...one A record per service, all pointing at the proxy
```

`transparent` answers from local data only when it *has* a matching record, and otherwise lets the query recurse out to the real internet. So `git.home.michaelvivirito.com` still resolves locally to the proxy, but `_acme-challenge.home.michaelvivirito.com` (no local record) goes out to Cloudflare, Caddy correctly finds the `michaelvivirito.com` zone, and the TXT record lands where Let's Encrypt will look for it.

**Problem 2: a stale "does not exist" answer.** After Caddy creates the record, it double-checks that the record is visible before handing off to Let's Encrypt. But Unbound had already cached the *absence* of that record from an earlier lookup, and it keeps a "no such record" answer for as long as the domain's DNS tells it to, which is 1800 seconds (30 minutes) on Cloudflare. So the record now exists, but my own resolver keeps insisting it does not, and Caddy's check times out. The fix is to cap how long Unbound trusts a "does not exist" answer:

```
cache-max-negative-ttl: 30
```

Now the stale answer clears in about 30 seconds and the check passes. The takeaway: a resolver between you and an ACME challenge can trip you up two ways, by claiming to own a zone it does not, and by remembering that a record was missing after it exists. Both are easy to miss because each piece is behaving exactly as designed. Fixing it in Unbound, rather than bypassing Unbound with a firewall hole, keeps all DNS flowing through the one resolver.

## Domain Names That Only Exist at Home

My services' domain names exist *only* in my router's Unbound; public DNS for `michaelvivirito.com` has no records for them. From outside my network they resolve to nothing; from my couch they resolve to the proxy. And "my couch" extends to "anywhere, over Tailscale": on my [Tailscale exit node](beryl-7-tailscale-travel-router), DNS tunnels home to the same Unbound, so the same domain names work with no per-device hosts files and no split-DNS to maintain. The exit node carries both the name resolution and the route.

## Adding a Service Is Two Lines

Onboarding a new service is two lines and, because the wildcard already covers every name, certificate-free: one `local-data` line in Unbound, one `handle` block in Caddy.

```
@grafana host grafana.home.michaelvivirito.com
handle @grafana {
	reverse_proxy 10.0.0.160:3000
}
```

Reload Caddy and `https://grafana.home.michaelvivirito.com` has a green lock the instant it answers, no new cert, no propagation wait. Both files live in the version-controlled repos from [the firewall post](version-control-freebsd-firewall), so adding a service is a reviewed, revertible commit.

## What It Looks Like Now

Every internal service now answers at `https://<name>.home.michaelvivirito.com` with a green lock, on the LAN and over Tailscale, and resolves to nothing from outside. Clean names, real certs, and the next service is two lines and a reload. None of the parts are exotic, a reverse proxy, a wildcard cert, a split-horizon resolver; the work is wiring them so nothing is exposed and the whole cert path runs on hardware I control.

Building internal HTTPS a different way, mkcert or step-ca or an internal CA? Say so in the comments or [drop me a line](../contact). Thanks for reading.

## Next Steps

-   [Backing Up My FreeBSD Firewall](version-control-freebsd-firewall): where the Unbound and Caddy configs live, under Git
-   [Building a FreeBSD pf Router behind XGS-PON](freebsd-pf-router): the router running the split-horizon Unbound
-   [The Beryl Tailscale Travel Router](beryl-7-tailscale-travel-router): how these names follow me off the LAN
