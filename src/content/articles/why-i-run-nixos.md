---
title: "Why I Run NixOS on My Servers"
description: "Running NixOS in production. Declarative configuration, atomic rollbacks, and reproducible builds, from 3 years on Proxmox and bare metal."
date: 2026-04-02
keywords: "NixOS, Nix, Linux, server management, declarative configuration, DevOps, SRE, infrastructure"
ogTitle: "Why I Run NixOS on My Servers"
ogDescription: "Declarative configuration, atomic rollbacks, and reproducible builds, lessons from running NixOS in production."
badges: ["NixOS", "DevOps", "Infrastructure"]
related: ["freebsd-vs-linux-sre", "prometheus-grafana-monitoring"]
---
## The Problem with Traditional Linux

Every SRE has lived this nightmare: you SSH into a production server, make a config change, and something breaks. You don't remember what you changed. There's no diff. The backup is three weeks old. You start grepping through `/etc` hoping to find what went wrong.

I spent years in this cycle. Then I found NixOS, and my servers became *declarative*.

## What Makes NixOS Different

NixOS isn't just another Linux distribution. It's built on a fundamentally different idea: your entire system configuration is a single expression written in the Nix language. Every package, every service, every firewall rule, it's all in one file.

```
# /etc/nixos/configuration.nix (simplified)
{ config, pkgs, ... }:
{
  services.nginx = {
    enable = true;
    virtualHosts."example.com" = {
      root = "/var/www/example";
      enableACME = true;
      forceSSL = true;
    };
  };

  networking.firewall.allowedTCPPorts = [ 80 443 ];

  environment.systemPackages = with pkgs; [
    vim git curl jq
  ];
}
```

That's it. That's your web server config. Commit it to git, and you have a complete audit trail of every change ever made to your system.

## The Three Killer Features

### 1\. Atomic Rollbacks

Every time you rebuild your NixOS system, it creates a new "generation." If something breaks, you reboot into the previous generation. It's like git for your entire operating system.

```
# List all system generations
$ nixos-rebuild list-generations
  47   2026-04-01 14:23:15   current
  46   2026-03-28 09:15:42
  45   2026-03-25 11:30:00

# Roll back to previous generation
$ sudo nixos-rebuild switch --rollback
```

I've rolled back production servers in under 30 seconds. No panic, no manual config restoration. Just pick the generation that worked.

### 2\. Reproducible Builds

My entire infrastructure is defined in a [Nix flake](https://nixos.wiki/wiki/Flakes). When I deploy to a new server, I get the *exact same system*. Not "mostly the same." Not "close enough." **Exactly** the same packages, configs, and services. Pin the flake lock, and you get bit-for-bit reproducibility.

### 3\. Safe Experimentation

Want to test a new service? Create a **nix shell** or a **NixOS test**. It runs in isolation, doesn't touch your system, and disappears when you're done. No more "apt install" on production and hoping for the best.

```
# Try PostgreSQL 16 without installing it
$ nix shell nixpkgs#postgresql_16

# Test a NixOS configuration in a VM
$ nixos-rebuild build-vm --flake .#my-server
```

## Real-World Setup

Here's what I actually run:

-   **Proxmox VM** running NixOS as my main server
-   **Kubernetes** cluster on NixOS nodes
-   **Docker Compose** stacks for monitoring (Prometheus, Grafana)
-   A [FreeBSD pf router](../homelab) at the edge: different OS, same declarative spirit

All NixOS pieces are configured in one flake. One `git push` and a rebuild deploys everything consistently. The FreeBSD router has its own git repo for `/etc`; together they cover the whole network from packets to pods.

<div style="background: var(--bg-surface); padding: 1rem; border: 1px solid var(--border-accent); border-left: 3px solid var(--accent-primary); margin: 1.5rem 0;"><p style="margin: 0;"><strong>Tip:</strong> I packaged my NixOS + K8s configs as a <a href="https://github.com/mvivirito">DevOps toolkit</a>. If you want to get started with declarative infrastructure, it's a solid foundation.</p></div>

## The Learning Curve

I won't sugarcoat it: NixOS has a steep learning curve. The Nix language is functional, not imperative. Your first week will feel like you're fighting the system. Your second week will start clicking. By month two, you'll wonder how you ever managed servers without it.

Resources that helped me:

-   [Official Nix tutorials](https://nixos.org/learn)
-   [NixOS Wiki](https://nixos.wiki)
-   [Home Manager](https://github.com/nix-community/home-manager) for user-space config
-   [nixos-generators](https://github.com/nix-community/nixos-generators) for images

## When NOT to Use NixOS

NixOS isn't for everyone. If your team is deeply invested in Ansible/Puppet and everything works fine, the migration cost might not be worth it. If you need bleeding-edge hardware support on day one, Ubuntu/Fedora might be better. And if your team doesn't want to learn a new language, Nix will be a hard sell.

## Conclusion

NixOS transformed how I manage infrastructure. My servers are reproducible, rollbacks are instant, and my configs are version-controlled. It's not perfect, the learning curve is real and documentation can be sparse, but for anyone serious about infrastructure as code, it's worth the investment.

Got questions about NixOS? [Drop me a line](../contact). Or check out my [nix-config on GitHub](https://github.com/mvivirito/nix-config) for a working example.
