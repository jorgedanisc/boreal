# Sharing and Access Control

## The Physical Key Model

Boreal implements a novel sharing paradigm that treats AWS IAM credentials as physical keys. When you share an album, you're literally creating a unique key that can only open one specific door.

### Core Concepts

1. **No Central Authority**: We don't track who shares what with whom
2. **Cryptographic Isolation**: Each album has its own access credentials
3. **Instant Revocation**: Deleting the IAM user instantly invalidates all copies of the key
4. **Minimal Blast Radius**: A compromised key can only access its designated album

## Sharing Workflow

### Step 1: Album Creation

When creating a new album:
1. Create album folder structure in S3
2. Copy thumbnails for shared files
3. Generate manifest with file list and metadata
4. Save manifest to album folder

### Step 2: Share Key Generation

1. Create IAM user with minimal permissions
2. Attach policy with access only to this album
3. Create access keys for the IAM user
4. Generate encrypted share file containing credentials

### Step 3: Key Distribution

The share key can be distributed in multiple formats:

#### QR Code (for mobile sharing)
- Encrypted share file converted to QR code
- Can be scanned with any QR reader
- Contains all necessary connection information

#### Encrypted File
- JSON format with AES-encrypted credentials
- Can be shared via email, messaging apps, or USB drive
- Includes checksum for integrity verification

#### Share URL
- Encrypted payload in URL parameters
- Works with Boreal app on any platform
- Includes optional expiration timestamp

## Access Control Implementation

### Permission Matrix

| Actor | Library | Albums | Create Album | Share Album |
|-------|---------|--------|--------------|-------------|
| **Owner** | ✅ Full | ✅ Full | ✅ | ✅ |
| **Album Viewer** | ❌ | ✅ Read-only | ❌ | ❌ |
| **Album Editor** | ❌ | ✅ Read-write | ❌ | ✅ (with restrictions) |

### IAM Policy Templates

#### Album Viewer Policy
- Read-only access to specific album folder
- Cannot modify or delete any files
- Cannot access library or other albums

#### Album Editor Policy
- Read and write access within album
- Cannot move files from library to album
- Cannot delete the album or access other folders

## Security Considerations

### Key Management

1. **No Master Keys in Share Files**: Share keys contain only album-specific credentials
2. **Temporary by Default**: Keys can have built-in expiration dates
3. **Rate Limiting**: IAM policies include rate limits to prevent abuse
4. **Audit Logging**: All access attempts are logged to CloudTrail

### Revocation Process

1. Delete all access keys for the IAM user
2. Delete the IAM user from AWS
3. Update local tracking (if any)
4. Notify user that revocation is complete

### Compromise Response

If a share key is suspected to be compromised:
1. **Immediate Revocation**: Use the revoke function above
2. **Optional: Bucket Policy Update**: Add deny rules for specific patterns
3. **Notification**: Alert all album viewers (if contact info available)

## User Experience

### Sharing UI Flow

1. **User selects "Share Album"**
2. **App shows sharing options:**
   - View-only (default)
   - Can add/remove photos
   - Set expiration date
3. **App generates share key**
4. **User chooses distribution method:**
   - Save as file
   - Generate QR code
   - Copy share link

### Receiving UI Flow

1. **User opens share link or scans QR**
2. **App decrypts and validates the share key**
3. **App shows album preview**
4. **User confirms "Add to My Albums"**
5. **App stores credentials securely**

### Cross-Platform Support

- **Desktop**: Native file save/load
- **Mobile**: QR code scanning
- **Web**: Encrypted URL (coming soon)

## Performance Optimizations

1. **Bulk Operations**: Copy thumbnails in batches using S3 Batch Operations
2. **Parallel Processing**: Generate multiple share keys concurrently
3. **Caching**: Cache album manifests locally for faster access
4. **Delta Updates**: Only copy new/changed thumbnails when updating an album

## Future Enhancements

1. **Multi-Album Keys**: Keys that can access multiple related albums
2. **Hierarchical Permissions**: View some albums fully, others thumbnails-only
3. **Time-Bound Access**: Keys that automatically expire after certain date
4. **Watermarking**: Automatic watermarking for shared content
5. **Analytics**: Track which albums are most shared (locally, not server-side)