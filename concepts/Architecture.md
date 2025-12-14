# Architecture

Boreal is three decoupled components:

1. **Bootstrap**: Terraform/CloudFormation that provisions AWS infrastructure
2. **Protocol**: How clients interact with a vault (S3 layout, encryption scheme)
3. **Clients**: Apps that implement the protocol

Anyone can build a client. You just need a vault file.

---

## Bootstrap

When you create a vault, the app opens AWS CloudFormation in your browser with a pre-configured template. CloudFormation creates:

- S3 bucket with lifecycle rules
- IAM user with scoped permissions
- Initial vault-key.enc (encrypted vault key)

The stack outputs a **Vault Code**—a base64-encoded vault file containing your credentials and KEK. Paste this into the app to complete setup.

Each vault is a separate CloudFormation stack. Create as many as you need.

### IAM Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:RestoreObject"
      ],
      "Resource": [
        "arn:aws:s3:::boreal-vault-{id}",
        "arn:aws:s3:::boreal-vault-{id}/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "iam:CreateAccessKey",
        "iam:DeleteAccessKey",
        "iam:ListAccessKeys"
      ],
      "Resource": "arn:aws:iam::*:user/${aws:username}"
    }
  ]
}
```

The IAM user can manage its own access keys, enabling in-app credential rotation.

---

## S3 Layout

```
boreal-vault-{id}/
├── vault-key.enc                   # KEK-encrypted vault key
├── originals/
│   └── {uuid}.enc                  # Glacier Deep Archive or Instant Retrieval
├── thumbnails/
│   └── {uuid}.enc                  # S3 Standard
└── manifest.db.enc                 # Encrypted SQLite database
```

### Lifecycle Rules

```yaml
Rules:
  - ID: transition-originals-to-glacier
    Filter:
      Prefix: originals/
    Status: Enabled
    Transitions:
      - Days: 0
        StorageClass: DEEP_ARCHIVE  # or GLACIER_IR
```

Thumbnails stay in Standard for instant access.

---

## Manifest

The manifest is an encrypted SQLite database. It contains:

```sql
-- Files
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  hash TEXT,
  filename TEXT,
  size INTEGER,
  mime_type TEXT,
  created_at TEXT,
  uploaded_at TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,  -- for video/audio
  location_lat REAL,
  location_lng REAL,
  camera_make TEXT,
  camera_model TEXT
);

-- Full-text search
CREATE VIRTUAL TABLE files_fts USING fts5(
  filename, 
  content='files'
);

-- AI embeddings for semantic search
CREATE TABLE embeddings (
  file_id TEXT PRIMARY KEY,
  vector BLOB  -- 512-dim float32, 2KB per file
);

-- Memories (journal entries)
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  title TEXT,
  notes TEXT,
  date_start TEXT,
  date_end TEXT,
  location_lat REAL,
  location_lng REAL,
  created_at TEXT
);

CREATE TABLE memory_files (
  memory_id TEXT,
  file_id TEXT,
  PRIMARY KEY (memory_id, file_id)
);

-- Audio recordings in memories
CREATE TABLE audio (
  id TEXT PRIMARY KEY,
  memory_id TEXT,
  duration_ms INTEGER,
  transcript TEXT
);

-- Geo index for map view
CREATE VIRTUAL TABLE files_geo USING rtree(
  id,
  min_lat, max_lat,
  min_lng, max_lng
);
```

The manifest is the source of truth. Devices sync by pulling the latest manifest and merging.

---

## Client Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri App                                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Web UI (gallery, search, memories)                 │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                 │
│                           │ IPC                             │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Rust Core                                          │    │
│  │  - Encryption (libsodium / age)                     │    │
│  │  - S3 operations (aws-sdk-rust)                     │    │
│  │  - SQLite (rusqlite)                                │    │
│  │  - Thumbnail generation (image-rs)                  │    │
│  │  - EXIF extraction                                  │    │
│  │  - CLIP embeddings (ort / onnxruntime)              │    │
│  │  - Whisper transcription (whisper-rs)               │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Local Storage                                      │    │
│  │  - manifest.db (decrypted, local copy)              │    │
│  │  - thumbnails/ (decrypted cache)                    │    │
│  │  - vaults.json (list of known vaults)               │    │
│  │  - OS Keychain (vault files, optional)              │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## Sync Protocol

### Pull

```
1. GET manifest.db.enc from S3
2. Decrypt with vault key
3. Compare with local manifest
4. Merge changes (last-write-wins per record)
5. Download missing thumbnails
6. Decrypt and cache thumbnails locally
```

### Push

```
1. Encrypt local manifest with vault key
2. PUT manifest.db.enc to S3
```

For conflicts (rare, usually from simultaneous edits on two devices), the app shows both versions and lets the user choose.

---

## Upload Flow

```mermaid
sequenceDiagram
    participant User
    participant App
    participant S3

    User->>App: Select files
    App->>App: For each file:
    App->>App: Generate thumbnail (AVIF, 50KB max)
    App->>App: Extract EXIF metadata
    App->>App: Generate CLIP embedding
    App->>App: Encrypt original
    App->>App: Encrypt thumbnail
    App->>S3: PUT originals/{uuid}.enc
    App->>S3: PUT thumbnails/{uuid}.enc
    App->>App: Update local manifest
    App->>App: Encrypt manifest
    App->>S3: PUT manifest.db.enc
    App->>User: Upload complete
```

---

## Retrieval Flow (Deep Archive)

```mermaid
sequenceDiagram
    participant User
    participant App
    participant S3
    participant Glacier

    User->>App: Request original
    App->>S3: HEAD originals/{uuid}.enc
    S3-->>App: Storage class: DEEP_ARCHIVE
    App->>S3: RestoreObject (Bulk, 48hr)
    App->>User: Restore requested, check back later
    
    Note over Glacier: 12-48 hours pass
    
    User->>App: Check status
    App->>S3: HEAD originals/{uuid}.enc
    S3-->>App: Restore complete
    App->>S3: GET originals/{uuid}.enc
    App->>App: Decrypt
    App->>User: Here's your file
```

---

## Offline Capability

After initial sync, these work offline:

- Browse all thumbnails
- Search by metadata, text, AI embeddings
- View memories
- Edit tags and notes
- Create new memories

These require network:

- Upload new files
- Sync changes to/from S3
- Retrieve originals from Glacier
- Download thumbnails not yet cached

---

## Search

All search is local.

**Metadata**: SQLite queries on dates, locations, camera, dimensions.

**Text**: FTS5 on filenames, memory notes, audio transcripts.

**AI**: Analyzes input for semantic search, image classification. Details on [Image Search](./ImageSearch.md).

**Geo**: R-tree index for "photos near this point" queries.

No API calls. No data leaves your device for search.