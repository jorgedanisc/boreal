# Storage Architecture

## Physical Partitioning Model

Boreal treats your S3 bucket like a physical vault with distinct zones. Each zone has its own access controls, functioning like separate digital USB drives.

### Bucket Structure

```
your-bucket/
├── library/                    # Master zone (full access)
│   ├── originals/             # Full resolution files
│   │   ├── 2024/
│   │   └── 2023/
│   ├── thumbnails/            # 200px previews
│   │   ├── 2024/
│   │   └── 2023/
│   └── metadata.db            # SQLite database
│
└── albums/                    # Shared zones (restricted access)
    ├── summer-trip-2024/
    │   ├── thumbnails/        # Copy of thumbnails for this album
    │   └── manifest.json      # Album metadata and file list
    └── project-x/
        ├── thumbnails/
        └── manifest.json
```

### Storage Class Selection

Users can choose between two storage classes based on their needs:

| Storage Class | Use Case | Cost | Retrieval Time |
|---------------|----------|------|----------------|
| **Glacier Deep Archive** | Long-term archival | ~$0.99/TB/month | 12-48 hours |
| **Glacier Instant Retrieval** | Active libraries | ~$4.00/TB/month | Milliseconds |

**Implementation Details:**
- Original files are stored according to the selected storage class
- Thumbnails and metadata are always in Standard S3 for instant access
- Storage class is selected at the library level during initial setup

### Data Retention

Default retention policies for all storage classes:

- **Original files**: Permanent storage (unless manually deleted)
- **Common for all classes**: Optional auto-delete for thumbnails and metadata after 1-7 years (user configurable)

## Data Redundancy and Durability

- **S3 Standard**: 99.999999999% durability (11 9's)
- **Glacier**: 99.999999999% durability (11 9's)
- **Cross-Region Replication**: Optional for critical data
- **Local Backups**: Metadata and thumbnails cached locally

## Implementation Overview

### Upload Process Flow

1. **Thumbnail Generation**: Create 200px preview locally
2. **Original Upload**: Store full resolution file with selected storage class
3. **Thumbnail Upload**: Always store thumbnail in Standard S3
4. **Metadata Update**: Record file information in local database
5. **Sync**: Update manifest in S3 for multi-device synchronization

### Storage Migration

The system provides utilities to migrate between storage classes:
- One-time migration from Instant Retrieval to Deep Archive (or vice versa)
- Tracks migration progress
- Provides cost estimates before migration

## Storage Optimization

### Key Strategies

1. **Thumbnail Deduplication**: Shared albums only copy thumbnails, not originals
2. **Compression**: Optional compression for compatible file types
3. **Efficient Storage**: Choose the appropriate storage class for your use case

### Performance Considerations

- **Fast Browsing**: Thumbnails and metadata always instantly accessible
- **Efficient Sync**: Only sync changes, not entire library
- **Background Processing**: Indexing and migration run in background
- **Local Caching**: Frequently accessed items cached locally