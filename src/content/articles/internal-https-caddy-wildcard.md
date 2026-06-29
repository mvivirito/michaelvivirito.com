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

## The Click-Through-the-Warning Tax

My homelab had accumulated a dozen web UIs, and every one of them greeted me the same way: `https://10.0.0.150`, a fat red browser warning, and a "this connection is not private" interstitial I had trained myself to click through without reading. The lucky services had names like `git.k8s.home`, which is marginally better than an IP and still a fake TLD with a self-signed cert. The unlucky ones were just memorized port numbers.

This is the homelab default, and it is quietly corrosive. Training yourself to click past certificate warnings is training yourself to ignore the exact signal that is supposed to stop you from getting phished. I wanted the green lock to mean something again, which means every internal service needed two things it did not have: a real name, and a certificate a browser actually trusts. A [Caddy](https://caddyserver.com/) reverse proxy gave me both, and the path there ran straight through a genuinely annoying DNS bug that is worth the whole post on its own.

## What I Wanted

The requirements were specific:

-   **Real names.** `git.home.michaelvivirito.com`, not `10.0.0.150` and not a made-up `.home` TLD. A real subdomain of a domain I own.
-   **Valid certs.** A browser-trusted Let's Encrypt certificate, auto-renewing, no warnings, no per-device "trust this CA" dance.
-   **Nothing exposed.** These are internal services. The names should work on my LAN and over [Tailscale](beryl-7-tailscale-travel-router), and resolve to nothing at all from the public internet.
-   **One cert, not twelve.** A new service should be a two-line change, not a new certificate ceremony.

That last pair is in tension: a normally-issued Let's Encrypt cert requires the world to reach your server on port 80 to answer the challenge, which is the opposite of "nothing exposed." The way out is a wildcard cert issued over DNS, and that is where the design gets interesting.

## Three Independent Pieces

It helps to see that "service with a valid cert on my LAN" is really three separate problems that happen to meet at the proxy:

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

A name that resolves (Unbound), a cert that is trusted (Caddy plus Let's Encrypt), and routing (Caddy). Keep them separate in your head and the whole thing is legible. Conflate them and you will debug a cert problem by editing DNS, which I did, which is the rest of this post.

## Why Caddy

I run Caddy in an unprivileged container with a static IP, `10.0.0.5`. The whole config is one file. Two reasons it won the slot over the alternatives:

-   **Automatic HTTPS is the product, not a bolt-on.** Caddy obtains and renews certificates as a first-class behavior. nginx can do all of this; you just assemble it yourself out of certbot, a renewal timer, and reload hooks. Caddy's version is a few lines and it manages the renewal lifecycle itself.
-   **It stays local.** A [Cloudflare Tunnel](https://www.cloudflare.com/products/tunnel/) is the other popular answer, and I use one for the single service I deliberately expose to the public. But routing my *internal* traffic out to Cloudflare and back to reach a box two meters away is a dependency I don't want on my LAN. If my internet is down, my internal services should not be.

## A Wildcard Cert Without Exposing Anything

The trick that satisfies "valid cert" and "nothing exposed" at once is the ACME **DNS-01** challenge. Instead of proving control of a domain by answering on port 80, Caddy proves it by creating a DNS record:

1.  Caddy asks Let's Encrypt for `*.home.michaelvivirito.com`.
2.  Let's Encrypt says "prove you control this domain: publish this token as a TXT record at `_acme-challenge.home.michaelvivirito.com`."
3.  Caddy uses a Cloudflare API token to create that TXT record via Cloudflare's API.
4.  Let's Encrypt reads the record from Cloudflare's public nameservers, sees the token, and issues the cert. Caddy deletes the TXT record.

Nothing on my network ever accepts an inbound connection from the internet. The only thing that talks to the outside world is an API call to Cloudflare. The config is short:

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

A backend that itself only speaks HTTPS with its own self-signed cert (Proxmox and Proxmox Backup Server both do) gets `tls_insecure_skip_verify` on that hop. That is not a security hole: the link from your browser to Caddy is the real, validated TLS, and the Caddy-to-backend hop is a meter of cable inside the same trusted host. The browser sees one clean green lock.

The Cloudflare token is the one real secret, and it is scoped to the floor: `dns_records:edit` on this one zone, nothing else, and pinned to my home's WAN IP so a leaked copy is useless from anywhere but my house. It lives in a `0600` env file that the proxy loads at start, and it is the one file in this whole setup that never goes near Git. Caddy uses it continuously, not just at first issue, because every renewal runs the same DNS-01 dance.

## The Unbound Gotcha That Ate an Evening

Here is the part I promised. My router runs Unbound as the LAN resolver, and I pointed Caddy's ACME resolver at it (`resolvers 10.0.0.1`) because I enforce all DNS through Unbound on purpose and did not want the firewall to carve out an exception. Two Unbound behaviors then fought the challenge, and the failure mode was maddening because the cert request *almost* worked.

My first instinct for the split-horizon zone was a wildcard `redirect` local-zone, which says "answer everything under this name from local data." The problem: a `redirect` zone **synthesizes an SOA record** for `home.michaelvivirito.com`. When Caddy goes to issue the cert, it first walks up the DNS tree doing SOA lookups to figure out which zone it needs to write the TXT record into. It asks for the SOA of `home.michaelvivirito.com`, Unbound *invents* one locally, and Caddy concludes the zone is `home.michaelvivirito.com`, a zone Cloudflare has never heard of. The challenge fails because Caddy is trying to write the proof into the wrong place.

The fix is a `transparent` zone instead of a `redirect` zone:

```
# /usr/local/etc/unbound/unbound.conf
local-zone: "home.michaelvivirito.com." transparent
local-data: "git.home.michaelvivirito.com. A 10.0.0.5"
local-data: "pbs.home.michaelvivirito.com. A 10.0.0.5"
# ...one A record per service, all pointing at the proxy
```

`transparent` means "answer from local data if I have a record, otherwise recurse normally." So `git.home.michaelvivirito.com` resolves locally to the proxy, but `_acme-challenge.home.michaelvivirito.com`, which has no local data, recurses out to Cloudflare. The SOA walk now finds the *real* zone, `michaelvivirito.com`, and Caddy writes the TXT record where Let's Encrypt will actually look.

That fixed issuance, and then a second, subtler Unbound behavior stalled it: **negative caching.** When Caddy polls to confirm its own TXT record has propagated, the first lookups come back empty, and Unbound caches that "no such record" answer for up to the zone's SOA-minimum, which on Cloudflare is 1800 seconds. So Caddy publishes the record, Cloudflare serves it, and my resolver keeps confidently returning the cached "nope" for the next half hour. The cert request times out waiting on its own resolver to forget a stale negative.

```
# cap how long a "no such record" answer is cached
cache-max-negative-ttl: 30
```

Thirty seconds, and the propagation check clears almost immediately. The lesson generalizes past Caddy: **a recursive resolver between you and an ACME challenge can lie to you in two directions**, by synthesizing records that send you to the wrong zone, and by caching their absence after they exist. Both are invisible unless you know to look, because every individual component is behaving exactly as documented.

The reward for fighting through it instead of punching a firewall hole: the proxy obtains and renews certs entirely through my own resolver, and the router's "all DNS goes through Unbound" rule stays intact with no exception.

## Names That Only Exist at Home

The DNS half of "nothing exposed" is split-horizon, and it falls out of the `transparent` zone above. The `*.home.michaelvivirito.com` names exist *only* in my router's Unbound. The public DNS for `michaelvivirito.com` has no records for them at all. From the coffee shop, `git.home.michaelvivirito.com` resolves to nothing. From my couch, it resolves to the proxy.

"From my couch" extends to "from anywhere, over Tailscale," which is the part that makes this genuinely usable. When I'm out and connected to my [Tailscale exit node](beryl-7-tailscale-travel-router) at home, my DNS queries tunnel back and get answered by the same Unbound, so the same names resolve to the same proxy and everything just works, no per-device hosts files, no split-DNS config to maintain. The exit node carries both the name resolution and the route. It is the one piece of remote-access plumbing doing double duty, and it means the internal names are exactly as portable as my Tailscale connection.

## Adding a Service Is Two Lines

The payoff for all this structure is that onboarding a new service is trivial and, crucially, *certificate-free*, because the wildcard already covers every name under the zone:

1.  One `local-data` line in Unbound pointing the new name at the proxy, then reload.
2.  One `handle` block in the Caddyfile pointing at the backend, then reload.

```
@grafana host grafana.home.michaelvivirito.com
handle @grafana {
	reverse_proxy 10.0.0.160:3000
}
```

Reload Caddy and `https://grafana.home.michaelvivirito.com` has a green lock the instant it answers. No new cert, no DNS propagation wait, no browser warning to dismiss. Both of those config files live in the version-controlled repos described in [the firewall post](version-control-freebsd-firewall), so "add a service" is also a reviewed, revertible commit.

## When the Backend Fights Back

Most services proxy without complaint. Two kinds don't, and both taught me something.

**Apps with their own idea of who's allowed to talk to them.** Some self-hosted apps implement DNS-rebinding protection by rejecting any request whose `Host` header they don't recognize. The first time you hit them through a new proxy name, they return a flat "access denied, hostname verification failed." The fix is to add the new hostname to the app's host allowlist, and the gotcha is the chicken-and-egg: the proxy is the thing being rejected, so you set the allowlist by reaching the app *directly* on its IP and port, then the proxied name works. Caddy is doing nothing wrong; the backend is being protective. Once you recognize the pattern you fix it in thirty seconds.

**Single-page apps that decide their own URLs in the browser.** My NAS's admin console (Asustor ADM) rendered as a blank page through the proxy, even though every asset returned a clean `200`. This one is sneaky, because the server side is fine: I confirmed with `curl` that the backend returns `200` with no redirect and no Host rejection. The break is entirely client-side. ADM's JavaScript front-end builds its own API and WebSocket URLs from the browser's address bar and pins them to the port it expects, so served from `:443` through a proxy it ties itself in a knot.

The fix turned out to be a combination, and it is a good template for any stubborn admin SPA:

-   Proxy to the backend's **plain-HTTP** port, not its HTTPS port, with the app's auto-redirect-to-HTTPS turned off. Pointed at the HTTPS port, the SPA pinned URLs to that port and rendered blank; over plain HTTP it stops fighting.
-   Let the proxy send `X-Forwarded-Proto: https` (Caddy does this automatically) so the app knows the *original* request was secure even though the proxy-to-backend hop is HTTP.
-   Turn on the app's "trusted reverse proxy" setting and point it at the proxy's IP, so it honors those forwarded headers and builds correct `https://` URLs for the external name.

```
@nas host nas.home.michaelvivirito.com
handle @nas {
	reverse_proxy http://10.0.0.108:48000 {
		header_up X-Real-IP {remote_host}
	}
}
```

Green lock, real cert, working admin panel. The general lesson is worth keeping: when a proxied web app misbehaves but `curl` says the server is fine, stop editing the proxy and open the browser's network tab, because the bug is in the front-end's head, not on the wire.

## What It Looks Like Now

Every internal service has a real name and a real certificate. Gitea, Proxmox, Proxmox Backup Server, Open WebUI, and the rest of the internal web UIs all answer at `https://<name>.home.michaelvivirito.com` with a green lock, on the LAN and over Tailscale, and resolve to nothing from outside. Adding the next one is two lines and a reload. The browser warning is gone, which means when I *do* see one now, it means something again.

The pieces are not exotic: a reverse proxy, a wildcard cert, and a split-horizon resolver. The value is in wiring them so that nothing is exposed, the secret is scoped to the floor, and the certificate machinery runs entirely on infrastructure I control, including the resolver that spent one evening lying to me about it.

## Next Steps

-   [Backing Up My FreeBSD Firewall](version-control-freebsd-firewall): where the Unbound and Caddy configs live, under Git
-   [Building a FreeBSD pf Router behind XGS-PON](freebsd-pf-router): the router running the split-horizon Unbound
-   [The Beryl Tailscale Travel Router](beryl-7-tailscale-travel-router): how these names follow me off the LAN

Running a different internal-HTTPS setup, mkcert or step-ca or an internal CA? [Tell me about it](../contact). There are several right answers here and I am always curious which one other people landed on.
