---
title: "Real HTTPS for Internal Services: Caddy, a Wildcard Cert, and Split-Horizon DNS"
description: "Killing self-signed cert warnings for every homelab service with a Caddy reverse proxy: a wildcard Let's Encrypt cert via DNS-01, split-horizon Unbound so the names only resolve at home, and the Unbound gotcha that breaks the ACME challenge."
date: 2026-06-28
keywords: "Caddy, reverse proxy, Let's Encrypt, DNS-01, wildcard certificate, Cloudflare, unbound, split-horizon DNS, split DNS, ACME, homelab, internal HTTPS, Tailscale, self-signed, TLS"
ogTitle: "Real HTTPS for Internal Services with Caddy and a Wildcard Cert"
ogDescription: "A Caddy reverse proxy gives every internal homelab service a real name and a valid cert via a wildcard DNS-01 challenge, with split-horizon Unbound so the names resolve only at home. Plus the Unbound bug that breaks ACME."
badges: ["Caddy", "TLS", "Reverse Proxy", "DNS", "Homelab"]
related: ["freebsd-pf-router", "version-control-freebsd-firewall", "beryl-7-tailscale-travel-router", "prometheus-grafana-monitoring"]
---

## Clean Names, Real Encryption

Every internal web UI in my homelab lived at a bare IP like `https://10.0.0.150` or a fake-TLD name like `git.k8s.home`, each with a self-signed cert and the red browser warning that comes with it. Two things bugged me: I wanted clean, real names for every service, and I wanted the traffic actually encrypted with a cert browsers trust, even inside my own LAN. A [Caddy](https://caddyserver.com/) reverse proxy delivers both: one wildcard Let's Encrypt cert in front of every internal service. Here is how it fits together and how to build it, including the one DNS gotcha that will eat an evening if you hit it blind.

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

Self-signed HTTPS backends (Proxmox and Proxmox Backup Server) get `tls_insecure_skip_verify` on that hop. It is not a hole: browser-to-Caddy is real, validated TLS, and the Caddy-to-backend hop is a meter of cable inside the same host. The browser sees one green lock.

The Cloudflare token is the one real secret, scoped to the floor: `dns_records:edit` on this one zone, pinned to my WAN IP so a leaked copy is useless off my network. It lives in a `0600` env file, the one file here that never touches Git, and Caddy uses it on every renewal, not just first issue.

## The Unbound Gotcha That Ate an Evening

Here is the bug I promised. Caddy resolves through my router's Unbound (`resolvers 10.0.0.1`) because I enforce all DNS through Unbound and did not want a firewall exception. Two Unbound behaviors then fought the challenge.

My first split-horizon zone was a wildcard `redirect` local-zone. The problem: a `redirect` zone **synthesizes an SOA** for `home.michaelvivirito.com`. To issue the cert, Caddy walks up the DNS tree doing SOA lookups to find which zone to write the TXT record into. Unbound invents an SOA for `home.michaelvivirito.com`, so Caddy tries to write the proof into a zone Cloudflare has never heard of, and fails. The fix is a `transparent` zone:

```
# /usr/local/etc/unbound/unbound.conf
local-zone: "home.michaelvivirito.com." transparent
local-data: "git.home.michaelvivirito.com. A 10.0.0.5"
local-data: "pbs.home.michaelvivirito.com. A 10.0.0.5"
# ...one A record per service, all pointing at the proxy
```

`transparent` means "answer from local data if I have a record, otherwise recurse." So service names resolve locally to the proxy, but `_acme-challenge...` (no local data) recurses out to Cloudflare, the SOA walk finds the real zone `michaelvivirito.com`, and the TXT record lands where Let's Encrypt looks.

That fixed issuance; then negative caching stalled it. When Caddy polls for its own TXT record, the first lookups come back empty, and Unbound caches that "no such record" answer for the zone's SOA-minimum, 1800 seconds on Cloudflare. So the record exists, Cloudflare serves it, and my resolver keeps returning the cached "nope" for half an hour until the request times out. Cap it:

```
cache-max-negative-ttl: 30
```

The takeaway: a recursive resolver between you and an ACME challenge can mislead you two ways, synthesizing records that point to the wrong zone, and caching their absence after they exist. Both are invisible because every component behaves exactly as documented. Solving it in Unbound instead of bypassing it with a firewall hole means the proxy renews through my own resolver, no exception.

## Names That Only Exist at Home

Those names exist *only* in my router's Unbound; public DNS for `michaelvivirito.com` has no records for them. From outside my network they resolve to nothing; from my couch they resolve to the proxy. And "my couch" extends to "anywhere, over Tailscale": on my [Tailscale exit node](beryl-7-tailscale-travel-router), DNS tunnels home to the same Unbound, so the same names work with no per-device hosts files and no split-DNS to maintain. The exit node carries both the name resolution and the route.

## Adding a Service Is Two Lines

Onboarding a new service is two lines and, because the wildcard already covers every name, certificate-free: one `local-data` line in Unbound, one `handle` block in Caddy.

```
@grafana host grafana.home.michaelvivirito.com
handle @grafana {
	reverse_proxy 10.0.0.160:3000
}
```

Reload Caddy and `https://grafana.home.michaelvivirito.com` has a green lock the instant it answers, no new cert, no propagation wait. Both files live in the version-controlled repos from [the firewall post](version-control-freebsd-firewall), so adding a service is a reviewed, revertible commit.

## When the Backend Fights Back

Most services proxy without complaint. Two kinds don't.

**Apps that police their own `Host` header.** Some self-hosted apps do DNS-rebinding protection and reject any hostname they don't recognize, returning "access denied, hostname verification failed" the first time you hit them by a new name. Add the proxy hostname to the app's allowlist, and mind the chicken-and-egg: the proxy is what's blocked, so you set the allowlist by reaching the app directly on its IP first.

**SPAs that build their own URLs.** My NAS admin console (Asustor ADM) rendered blank through the proxy even though every asset returned `200`. The server side was fine (`curl` got a clean `200`, no redirect, no Host rejection); the break was client-side, ADM's JavaScript builds its API and WebSocket URLs from the browser's address bar and pins them to the port it expects. The fix, a decent template for any stubborn admin SPA: proxy to the backend's **plain-HTTP** port with its HTTPS auto-redirect off, let Caddy send `X-Forwarded-Proto: https`, and turn on the app's "trusted reverse proxy" setting pointed at the proxy so it honors that header and builds `https://` URLs.

```
@nas host nas.home.michaelvivirito.com
handle @nas {
	reverse_proxy http://10.0.0.108:48000 {
		header_up X-Real-IP {remote_host}
	}
}
```

The lesson worth keeping: when a proxied app misbehaves but `curl` says the server is fine, stop editing the proxy and open the browser's network tab. The bug is in the front-end's head, not on the wire.

## What It Looks Like Now

Every internal service now answers at `https://<name>.home.michaelvivirito.com` with a green lock, on the LAN and over Tailscale, and resolves to nothing from outside. Clean names, real certs, and the next service is two lines and a reload. None of the parts are exotic, a reverse proxy, a wildcard cert, a split-horizon resolver; the work is wiring them so nothing is exposed and the whole cert path runs on hardware I control.

Building internal HTTPS a different way, mkcert or step-ca or an internal CA? Say so in the comments or [drop me a line](../contact). Thanks for reading.

## Next Steps

-   [Backing Up My FreeBSD Firewall](version-control-freebsd-firewall): where the Unbound and Caddy configs live, under Git
-   [Building a FreeBSD pf Router behind XGS-PON](freebsd-pf-router): the router running the split-horizon Unbound
-   [The Beryl Tailscale Travel Router](beryl-7-tailscale-travel-router): how these names follow me off the LAN
