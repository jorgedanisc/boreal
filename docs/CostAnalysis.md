# Cost Analysis

## Storage Costs (AWS us-east-1 pricing)

| Storage Class | Cost per TB/month | Use Case |
|---------------|-------------------|----------|
| S3 Standard | $23.00 | Thumbnails, manifest |
| S3 Glacier Instant Retrieval | $4.00 | Active photo libraries |
| S3 Glacier Deep Archive | $0.99 | Long-term archival |

## Detailed Cost Scenarios

### Example: 10,000 Photos (50GB originals)

#### Deep Archive Option
| Component | Size | Storage Class | Monthly Cost |
|-----------|------|---------------|--------------|
| Original photos | 50 GB | Deep Archive | $0.05 |
| Thumbnails (25KB avg) | 250 MB | Standard | $0.006 |
| Manifest | <1 MB | Standard | <$0.001 |
| **Total Storage** | | | **$0.06/month** |

#### Instant Retrieval Option
| Component | Size | Storage Class | Monthly Cost |
|-----------|------|---------------|--------------|
| Original photos | 50 GB | Instant Retrieval | $0.20 |
| Thumbnails (25KB avg) | 250 MB | Standard | $0.006 |
| Manifest | <1 MB | Standard | <$0.001 |
| **Total Storage** | | | **$0.21/month** |

### Example: 100,000 Photos (500GB originals)

#### Deep Archive Option
| Component | Size | Storage Class | Monthly Cost |
|-----------|------|---------------|--------------|
| Original photos | 500 GB | Deep Archive | $0.50 |
| Thumbnails | 2.5 GB | Standard | $0.06 |
| Manifest | <5 MB | Standard | <$0.001 |
| **Total Storage** | | | **$0.56/month** |

#### Instant Retrieval Option
| Component | Size | Storage Class | Monthly Cost |
|-----------|------|---------------|--------------|
| Original photos | 500 GB | Instant Retrieval | $2.00 |
| Thumbnails | 2.5 GB | Standard | $0.06 |
| Manifest | <5 MB | Standard | <$0.001 |
| **Total Storage** | | | **$2.06/month** |

### Example: 1TB Mixed Media (Photos + Videos)

#### Deep Archive Option
| Component | Size | Storage Class | Monthly Cost |
|-----------|------|---------------|--------------|
| Original files | 1 TB | Deep Archive | $0.99 |
| Thumbnails | 5 GB | Standard | $0.12 |
| Manifest | <10 MB | Standard | <$0.001 |
| **Total Storage** | | | **$1.11/month** |

#### Instant Retrieval Option
| Component | Size | Storage Class | Monthly Cost |
|-----------|------|---------------|--------------|
| Original files | 1 TB | Instant Retrieval | $4.00 |
| Thumbnails | 5 GB | Standard | $0.12 |
| Manifest | <10 MB | Standard | <$0.001 |
| **Total Storage** | | | **$4.12/month** |


## Additional Costs

### Data Transfer Costs

| Operation | Cost | Notes |
|-----------|------|-------|
| Upload (ingress) | Free | No charge for data into S3 |
| Download (egress) | $0.09/GB | First sync only, then cached locally |
| CloudFront (CDN) | $0.085/GB | Optional for shared album access |

### Glacier Retrieval Costs

| Retrieval Tier | Cost | Speed | Use Case |
|----------------|------|-------|----------|
| Bulk | $0.0025/GB | 12-48 hours | Large archival restores |
| Standard | $0.02/GB | 3-5 hours | Regular access needs |
| Expedited | $0.03/GB | 1-5 minutes | Emergency access |

### Compute and Request Costs

| Operation | Cost | Frequency |
|-----------|------|-----------|
| Lambda invocations | ~$0.20/million | Thumbnail generation |
| PUT requests | $0.005/1000 | File uploads |
| GET requests | $0.0004/1000 | File downloads |
| LIST requests | $0.005/1000 | Directory listing |

## First Year Cost Estimate (1TB library)

### Deep Archive Option
| Item | Cost | Notes |
|------|------|-------|
| Storage (12 months) | $13.32 | Deep Archive |
| Initial thumbnail sync (5GB egress) | $0.45 | One-time |
| Lambda (100K invocations) | $0.02 | Initial processing |
| Occasional Glacier restores (10GB/year) | $0.25 | Bulk tier |
| **Total First Year** | **~$14** | |

### Instant Retrieval Option
| Item | Cost | Notes |
|------|------|-------|
| Storage (12 months) | $48.00 | Instant Retrieval |
| Initial thumbnail sync (5GB egress) | $0.45 | One-time |
| Lambda (100K invocations) | $0.02 | Initial processing |
| No restore costs | $0.00 | Instant access |
| **Total First Year** | **~$48.50** | |

## Cost Comparison to Alternatives

### Cloud Storage Services

| Service | 1TB Cost/year | Privacy | Offline | You Own Data | Lock-in |
|---------|---------------|---------|---------|--------------|---------|
| **Boreal (Deep Archive)** | ~$14 | Full | Yes | Yes | None (relative to the App, not the AWS account) |
| **Boreal (Instant Retrieval)** | ~$48 | Full | Yes | Yes | None (relative to the App, not the AWS account) |
| Google Photos | $100 (Google One) | Low | Partial | No | High |
| iCloud | $120 | Medium | Partial | No | High |
| Amazon Photos | $60 (Prime) | Low | Partial | No | Medium |
| Dropbox | $120 | Medium | Yes | No | Medium |
| Backblaze B2 | $60 | High | No | Yes | Low |

### Self-Hosted Solutions

| Solution | Storage Cost | Complexity | Thumbnail Support | Multi-Device |
|----------|--------------|------------|-------------------|--------------|
| **Boreal (Deep Archive)** | ~$1/TB/mo | Low | Automatic | Yes |
| **Boreal (Instant Retrieval)** | ~$4/TB/mo | Low | Automatic | Yes |
| PhotoPrism + NAS | Hardware cost | High | Yes | Complex |
| Immich + NAS | Hardware cost | High | Yes | Yes |
| Nextcloud + NAS | Hardware cost | High | Plugin | Yes |
| Raw S3 + scripts | ~$1/TB/mo | Very High | Manual | No |

### Traditional Storage Options

| Feature | Boreal | Typical Cloud | 1-Bay NAS | 2-Bay NAS (RAID 1) | 4+ Bay NAS (RAID 5/6) | SSD (Consumer) | HDD (Consumer) |
|---------|-----------------|---------------|-----------|-------------------|---------------------|----------------|----------------|
| Monthly cost (1TB) | ~$1 | $5-10 | Electricity | Electricity | Electricity | N/A (hardware) | N/A (hardware) |
| Initial hardware cost (/TB) | $0 | $0 | $50-100 | $60-120 | $40-80 | $80-200 | $40-100 |
| Data location | User's AWS | Provider's servers | User's home | User's home | User's home | User's home | User's home |
| Maintenance | None | None | User responsibility | User responsibility | User responsibility | User responsibility | User responsibility |
| Durability | 99.999999999% | ~99.99% | ~99.95% (single drive) | ~99.999% (RAID 1) | ~99.9999% (RAID 5/6) | ~99.99% (MTBF 1-1.5M hrs) | ~99.95% (MTBF 1-1.5M hrs) |
| Annual failure rate | N/A | N/A | 2-8% | 0.1-0.5% | 0.01-0.1% | 0.8-1.2% | 2-8% |
| Min drives for redundancy | N/A | N/A | 1 (backup) | 2 | 3 (RAID 5) / 4 (RAID 6) | N/A | N/A |
| Disaster recovery | Built-in | Built-in | User must configure | User must configure | User must configure | User must configure | User must configure |
| Internet required | Sync only | Always | Local network | Local network | Local network | Local network | Local network |
| Scales to | Unlimited | Plan limits | Disk capacity | Disk capacity | Disk capacity | Disk capacity | Disk capacity |
| Power efficiency | High | N/A | Medium | Medium-High | Medium | Very high | Medium |

## Cost Optimization Strategies

### 1. Smart Thumbnail Management

- Default thumbnail size: 200px (~25KB each)
- Optional larger thumbnails: 800px (~100KB each)
- Shared albums only copy thumbnails, not originals
- Automatic thumbnail cleanup after 1 year

### 2. Intelligent Archiving

- Manual override options
- Bulk operations for cost savings
- Predictive cost estimation

## Hidden Costs to Consider

### When Using Boreal

| Item | Potential Cost | Mitigation |
|------|----------------|------------|
| AWS Account (free tier expires) | ~$0.50/month | Use AWS Free Tier effectively |
| Data requests (high frequency) | ~$1-5/month | Cache locally, batch operations |
| Restore costs (frequent) | ~$10-50/year | Plan restores, use bulk tier |

### When Self-Hosting

| Item | Cost Range | Notes |
|------|------------|-------|
| Initial NAS hardware | $300-2000+ | Depends on capacity and redundancy |
| Electricity (24/7) | $120-300/year | Varies by efficiency |
| Replacement drives | $50-200 each | Every 3-5 years |
| Backup solution | $100-500 | Off-site backup recommended |
| Time investment | 10-50+ hours | Setup and maintenance |

## Regional Price Variations

AWS S3 pricing varies by region. Here are some examples for both storage classes:

### Deep Archive Pricing
| Region | Cost/TB/month | Difference from us-east-1 |
|--------|----------------|--------------------------|
| us-east-1 (N. Virginia) | $0.99 | Baseline |
| us-west-1 (N. California) | $0.99 | Same |
| eu-west-1 (Ireland) | $0.99 | Same |
| ap-southeast-1 (Singapore) | $0.99 | Same |
| sa-east-1 (São Paulo) | $1.35 | +36% |

### Instant Retrieval Pricing
| Region | Cost/TB/month | Difference from us-east-1 |
|--------|----------------|--------------------------|
| us-east-1 (N. Virginia) | $4.00 | Baseline |
| us-west-1 (N. California) | $4.00 | Same |
| eu-west-1 (Ireland) | $4.50 | +13% |
| ap-southeast-1 (Singapore) | $4.80 | +20% |
| sa-east-1 (São Paulo) | $6.80 | +70% |

*Tip: Choose the region closest to you for better latency and potentially lower data transfer costs.*

## Break-Even Analysis

### Boreal vs Self-Hosting

**Assumptions:**
- 2TB initial storage growing 20% annually
- 5-year ownership period
- DIY NAS: $800 initial cost + $150/year electricity

#### Boreal Deep Archive vs NAS
| Year | Boreal Cost | DIY NAS Cost | Difference |
|------|-------------|--------------|------------|
| Year 1 | $24 | $950 | -$926 |
| Year 2 | $28.80 | $150 | -$121.20 |
| Year 3 | $34.56 | $150 | -$115.44 |
| Year 4 | $41.47 | $150 | -$108.53 |
| Year 5 | $49.77 | $150 | -$100.23 |
| **Total 5 Years** | **$178.60** | **$1550** | **-$1371.40** |

#### Boreal Instant Retrieval vs NAS
| Year | Boreal Cost | DIY NAS Cost | Difference |
|------|-------------|--------------|------------|
| Year 1 | $96 | $950 | -$854 |
| Year 2 | $115.20 | $150 | -$34.80 |
| Year 3 | $138.24 | $150 | -$11.76 |
| Year 4 | $165.89 | $150 | $15.89 |
| Year 5 | $199.07 | $150 | $49.07 |
| **Total 5 Years** | **$714.40** | **$1550** | **-$835.60** |

**Conclusion**:
- **Deep Archive**: Boreal is significantly more cost-effective for archival use cases where retrieval time is acceptable.
- **Instant Retrieval**: Still more cost-effective than DIY NAS over 5 years, with less upfront investment and no maintenance.

## Cost Calculator Formulas

### Monthly Storage Cost
```
# Deep Archive Option
Cost = (StandardGB * $0.023) + (DeepArchiveGB * $0.00099)

# Instant Retrieval Option
Cost = (StandardGB * $0.023) + (InstantRetrievalGB * $0.004)
```

### Yearly Total Cost
```
Yearly = (MonthlyCost * 12) + InitialSync + RestoreCosts + LambdaInvocations
```

### Payback Period for NAS
```
PaybackMonths = NASHardwareCost / (MonthlyCloudCost - MonthlyNASCost)
```

## Tips for Minimizing Costs

1. **Choose the Right Storage Class**:
   - Deep Archive for long-term storage and infrequent access
   - Instant Retrieval for active libraries and immediate access
2. **Optimize Thumbnail Sizes**: Balance quality and storage needs
3. **Batch Operations**: Group uploads and downloads to reduce request costs
4. **Monitor Usage**: Regular reviews identify optimization opportunities
5. **Choose Optimal Region**: Consider both storage and data transfer costs