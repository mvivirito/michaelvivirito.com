---
title: "AWS Cost Optimization: An SRE's Playbook"
description: "Practical AWS cost optimization strategies from 8 years of SRE experience. Real numbers, real savings, from $2800/month to $1800/month with these techniques."
date: 2026-04-02
keywords: "AWS, cloud cost optimization, SRE, FinOps, Reserved Instances, Spot Instances, cost reduction, cloud spending, infrastructure"
ogTitle: "AWS Cost Optimization: An SRE's Playbook"
ogDescription: "Real strategies, real numbers. From $2800/month to $1800/month without sacrificing reliability."
badges: ["AWS", "FinOps", "SRE"]
related: ["prometheus-grafana-monitoring", "why-i-run-nixos"]
---
## The Bill That Woke Me Up

Three years ago, I got an AWS bill for $2,800. For a side project. That was the moment I stopped treating cloud costs as someone else's problem.

Since then, I've cut that bill to $1,800/month while **increasing** reliability and capacity. This isn't theoretical, these are the exact techniques I use, with real numbers.

## 1\. Right-Sizing: The Low-Hanging Fruit

Most teams over-provision because they guessed during setup. AWS's own data shows **40% of EC2 instances are under-utilized**.

```
# Check your actual utilization
aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUUtilization \
  --dimensions Name=InstanceId,Value=i-1234567890 \
  --start-time $(date -u -d '14 days ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 86400 \
  --statistics Average
```

**Rule of thumb**: If your average CPU is below 20% and memory below 40% for 14 days, you can probably drop one instance size. I saved $180/month just by moving a t3.xlarge to t3.large.

## 2\. Reserved Instances and Savings Plans

If you're running anything stable (databases, core services, CI/CD), you're leaving money on the table without commitments.

-   **1-year No Upfront RI**: ~30% savings on baseline compute
-   **Compute Savings Plans**: ~25% savings with flexibility across instance families
-   **S3 Intelligent-Tiering**: Automatically moves objects between access tiers

I run Savings Plans on my baseline (3x m6i.large) and use Spot for burst workloads. This alone saves me ~$400/month.

## 3\. Spot Instances for Fault-Tolerant Workloads

Spot instances are 60-90% cheaper than On-Demand. The catch: they can be interrupted with 2 minutes notice. Use them for:

-   CI/CD build runners
-   Data processing jobs
-   Stateless web servers behind an ALB
-   Kubernetes worker nodes (with proper drain handling)

```
# Spot Fleet request for CI runners
{
  "SpotFleetRequestConfig": {
    "AllocationStrategy": "capacityOptimized",
    "TargetCapacity": 2,
    "LaunchSpecifications": [
      {
        "InstanceType": "c5.xlarge",
        "ImageId": "ami-12345678",
        "KeyName": "ci-key",
        "SecurityGroups": [{"GroupId": "sg-ci"}]
      }
    ]
  }
}
```

I use Spot for all my CI/CD pipelines. My average build cost dropped from $0.17/hour to $0.04/hour.

## 4\. Storage: Where Costs Hide

Storage costs sneak up on you. EBS volumes, S3 buckets, snapshots, they accumulate silently.

-   **Delete unattached EBS volumes**: Check monthly, automate the cleanup
-   **Snapshot lifecycle policies**: Keep 7 daily, 4 weekly, 12 monthly: not forever
-   **S3 lifecycle rules**: Move to Glacier after 90 days, expire after 365
-   **EBS gp3 > gp2**: Same price, 20% better baseline IOPS, tunable

```
# Find unattached EBS volumes (often $50-200/month wasted)
aws ec2 describe-volumes \
  --filters Name=status,Values=available \
  --query 'Volumes[*].{ID:VolumeId,Size:Size,Type:VolumeType}'
```

## 5\. Network Costs: The Silent Killer

Data transfer is where AWS makes its real money. Inter-AZ traffic, NAT Gateway, and cross-region replication add up fast.

-   **NAT Gateway vs NAT Instance**: A t3.micro NAT instance costs $7/month. A NAT Gateway costs $32/month + data processing fees. For low-traffic environments, use the instance.
-   **VPC Endpoints**: S3 and DynamoDB Gateway endpoints are free. They keep traffic off the NAT.
-   **Consolidate services in same AZ**: Inter-AZ traffic is $0.01/GB each way.

## 6\. Automated Cleanup

Manual cleanup doesn't scale. Set up automation:

```
# Lambda: Delete old EBS snapshots (older than 90 days)
import boto3
from datetime import datetime, timedelta

def lambda_handler(event, context):
    ec2 = boto3.client('ec2')
    cutoff = datetime.now() - timedelta(days=90)
    
    snapshots = ec2.describe_snapshots(OwnerIds=['self'])
    for snap in snapshots['Snapshots']:
        if snap['StartTime'].replace(tzinfo=None) < cutoff:
            ec2.delete_snapshot(SnapshotId=snap['SnapshotId'])
            print(f"Deleted: {snap['SnapshotId']}")
```

## 7\. Environment Tiering

Not every environment needs production-grade infrastructure:

-   **Production**: RIs, multi-AZ, reserved capacity
-   **Staging**: Spot + On-Demand mix, single-AZ acceptable
-   **Dev/Test**: Scheduled shutdown (Lambda to stop instances at 8 PM), Spot only, smallest viable sizes

My dev environment auto-stops at night and on weekends. That's a 65% reduction in non-production costs.

## The Results

```
Before optimization:
  EC2:        $1,200/mo
  RDS:          $450/mo
  S3/EBS:       $320/mo
  Data Xfer:    $280/mo
  NAT/Network:  $150/mo
  Other:        $400/mo
  Total:      $2,800/mo

After optimization:
  EC2 (Spot+RI): $680/mo
  RDS (RI):       $310/mo
  S3 (Lifecycle): $180/mo
  Data Xfer:      $120/mo
  NAT (VPC EP):    $45/mo
  Other:          $265/mo
  Total:        $1,800/mo

Savings: $1,000/month (36%)
```

## Where to Start

1.  **Week 1**: Enable AWS Cost Explorer. Identify your top 5 cost drivers.
2.  **Week 2**: Right-size your instances. Delete unattached volumes.
3.  **Week 3**: Set up Spot for non-production workloads.
4.  **Week 4**: Purchase Savings Plans for your baseline.
5.  **Ongoing**: Monthly cost review. Automate cleanup.

Cost optimization isn't a one-time project. It's an ongoing discipline. Start with the biggest wins (right-sizing + Spot), then layer on the refinements.

Questions about your AWS bill? [Get in touch](../contact).
