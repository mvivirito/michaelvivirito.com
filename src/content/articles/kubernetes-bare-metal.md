---
title: "Kubernetes on Bare Metal: A Practical Guide"
description: "Running Kubernetes on bare metal with Proxmox. Why skip the cloud? Performance, cost, and the joy of owning your stack. Real setup, real configs."
date: 2026-04-02
keywords: "Kubernetes, k8s, bare metal, Proxmox, self-hosted, home lab, infrastructure, on-premises, DevOps"
ogTitle: "Kubernetes on Bare Metal: A Practical Guide"
ogDescription: "Skip the cloud. Own your stack. A real-world guide to running k8s on bare metal with Proxmox."
badges: ["Kubernetes", "Proxmox", "Self-Hosting"]
related: ["why-i-run-nixos", "freebsd-vs-linux-sre", "aws-cost-optimization", "prometheus-grafana-monitoring"]
---
## Why Bare Metal?

"Just use EKS/GKE/AKS" is common advice. And it's good advice, for teams that need managed control planes and have the budget for cloud pricing. But there are legitimate reasons to go bare metal:

-   **Cost**: My 3-node k8s cluster costs $0/month beyond electricity (~$30/month). An equivalent EKS setup runs $200-400/month.
-   **Performance**: No hypervisor overhead, no noisy neighbors, direct hardware access for storage I/O.
-   **Learning**: You understand every layer: networking, storage, DNS, load balancing. Cloud providers abstract this away, which is fine until something breaks.
-   **Control**: Custom kernel parameters, real-time scheduling, GPU passthrough, specialized hardware.

## My Setup

-   **Hypervisor**: Proxmox VE 8.x on a dedicated server
-   **VMs**: 3 Ubuntu 24.04 VMs (4 vCPU, 8GB RAM, 100GB each)
-   **K8s**: kubeadm with kubeadm, containerd, Cilium CNI
-   **Storage**: NFS provisioner backed by Proxmox ZFS pool
-   **Ingress**: NGINX Ingress Controller
-   **DNS**: PiHole for internal, Cloudflare for external

## Step 1: Proxmox VM Setup

Create your VMs. I use a Terraform provider for Proxmox, but the UI works fine too.

```
# proxmox VM config (qm.conf)
agent: 1
balloon: 0
cores: 4
memory: 8192
net0: virtio=AA:BB:CC:DD:EE:01,bridge=vmbr0
scsi0: local-lvm:vm-101-disk-0,size=100G
scsihw: virtio-scsi-pci
ostype: l26
```

## Step 2: Prepare the Nodes

Run this on all three nodes. It installs containerd, kubeadm, kubelet, and kubectl.

```
#!/bin/bash
# prepare-node.sh, Run on each k8s node

# Disable swap
swapoff -a
sed -i '/ swap / s/^/#/' /etc/fstab

# Load required modules
cat <
```

````   ## Step 3: Initialize the Cluster  On the control plane node:  ``` # Init cluster with pod network CIDR kubeadm init \   --pod-network-cidr=10.244.0.0/16 \   --control-plane-endpoint=k8s-cp.local:6443 \   --upload-certs  # Set up kubectl for your user mkdir -p $HOME/.kube cp /etc/kubernetes/admin.conf $HOME/.kube/config chown $(id -u):$(id -g) $HOME/.kube/config  # Install Cilium CNI helm repo add cilium https://helm.cilium.io/ helm install cilium cilium/cilium \   --namespace kube-system \   --set kubeProxyReplacement=true \   --set k8sServiceHost=k8s-cp.local \   --set k8sServicePort=6443 ```  On worker nodes, join with the token from `kubeadm init`:  ``` kubeadm join k8s-cp.local:6443 \   --token <token> \   --discovery-token-ca-cert-hash sha256:<hash> ```  ## Step 4: Storage with NFS  On bare metal, you need a persistent volume provisioner. NFS is the simplest reliable option.  ``` # NFS server setup (on Proxmox host or separate VM) apt-get install -y nfs-kernel-server mkdir -p /srv/nfs/k8s echo '/srv/nfs/k8s 10.0.0.0/24(rw,sync,no_subtree_check,no_root_squash)' >> /etc/exports exportfs -ra  # NFS provisioner in k8s helm repo add nfs-subdir-external-provisioner \   https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner/ helm install nfs-provisioner \   nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \   --set nfs.server=10.0.0.10 \   --set nfs.path=/srv/nfs/k8s \   --set storageClass.defaultClass=true ```  ## Step 5: Ingress and DNS  NGINX Ingress for routing, PiHole for internal DNS resolution:  ``` # Install NGINX Ingress helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx helm install ingress-nginx ingress-nginx/ingress-nginx \   --set controller.service.type=NodePort \   --set controller.service.nodePorts.http=30080 \   --set controller.service.nodePorts.https=30443  # PiHole DNS entry (admin panel) # Add A records pointing to your k8s node IPs # grafana.k8s.local  → 10.0.0.11 # app.k8s.local      → 10.0.0.11 ```  ## What the Cloud Gives You for Free  Be honest with yourself about what you lose:  -   **LoadBalancer services**: No cloud LB. Use NodePort or MetalLB. -   **Managed DNS**: No Route53. Use PiHole + Cloudflare for external. -   **Auto-scaling**: No cluster autoscaler. Pre-provision your nodes. -   **Managed etcd**: You're responsible for backups. -   **Security patches**: You handle OS and k8s updates.  MetalLB gives you LoadBalancer-like services on bare metal:  ``` # MetalLB for LoadBalancer services helm repo add metallb https://metallb.github.io/metallb helm install metallb metallb/metallb  # Configure IP pool cat < ```  ``   ## Backups: Non-Negotiable  Without cloud snapshots, you need your own backup strategy:  -   **etcd snapshots**: Cron job running `etcdctl snapshot save` hourly -   **PV backups**: Restic or Velero backing up to off-site storage -   **Proxmox snapshots**: ZFS snapshots on the storage pool -   **GitOps**: All manifests in Git. The cluster is re-creatable from scratch.  ``` # etcd backup cron 0 * * * * /usr/local/bin/etcdctl snapshot save \   /backup/etcd/snap-$(date +\%Y\%m\%d-\%H\%M).db \   --endpoints=https://127.0.0.1:2379 \   --cacert=/etc/kubernetes/pki/etcd/ca.crt \   --cert=/etc/kubernetes/pki/etcd/healthcheck-client.crt \   --key=/etc/kubernetes/pki/etcd/healthcheck-client.key ```  ## Is It Worth It?  If your goal is production workloads with 99.99% SLA requirements, use a managed service. If your goal is learning, home lab, cost savings, or full control, bare metal k8s is genuinely rewarding.  I run my monitoring stack, media services, and development environments on bare metal k8s. My production apps still run on cloud-managed k8s. There's room for both.  Questions about bare metal k8s? [Get in touch](../contact).   `` ````
