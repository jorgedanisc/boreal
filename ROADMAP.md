# Boreal Roadmap

## Phase 1: Foundation

**Goal**: One device can create a vault, upload photos, and browse them.

- [ ] CloudFormation template (S3 bucket, IAM user, lifecycle rules, vault code output)
- [ ] Rust core library
  - [ ] Vault file parsing
  - [ ] Encryption/decryption (libsodium or age)
  - [ ] S3 operations (aws-sdk-rust)
  - [ ] Manifest database schema (SQLite)
- [ ] Tauri app shell
  - [ ] Import vault code flow
  - [ ] Store vault file in OS keychain
- [ ] Upload flow
  - [ ] Thumbnail generation (AVIF, 50KB max)
  - [ ] EXIF extraction
  - [ ] Encrypt original + thumbnail
  - [ ] Upload to S3
  - [ ] Update manifest
- [ ] Browse flow
  - [ ] Download and decrypt manifest
  - [ ] Download and cache thumbnails
  - [ ] Basic grid gallery

**Milestone**: You can create a vault, upload 100 photos, close the app, reopen, and see your photos.

---

## Phase 2: Offline & Sync

**Goal**: Works offline. Works across multiple devices.

- [ ] Local manifest caching
  - [ ] Persist decrypted manifest locally
  - [ ] Track sync state (last sync timestamp)
- [ ] Sync protocol
  - [ ] Pull remote manifest on app open
  - [ ] Merge strategy (last-write-wins per record)
  - [ ] Push local changes
- [ ] Thumbnail cache management
  - [ ] Download thumbnails on demand or background sync
  - [ ] Cache eviction policy (LRU, configurable size limit)
- [ ] Offline indicators in UI
  - [ ] Show sync status
  - [ ] Queue uploads when offline, sync when online

**Milestone**: Install on second device, import same vault code, see same photos. Edit on one device, see changes on the other after sync.

---

## Phase 3: Core UX

**Goal**: Actually pleasant to use.

- [ ] Gallery improvements
  - [ ] Infinite scroll / virtualized grid
  - [ ] Zoom levels (day, month, year)
  - [ ] Date headers
- [ ] Photo viewer
  - [ ] Full-screen view (thumbnail first, original on request)
  - [ ] Swipe navigation
  - [ ] Pinch to zoom
- [ ] Metadata search
  - [ ] Search by date range
  - [ ] Search by location (if EXIF has GPS)
  - [ ] Search by filename
- [ ] Bulk operations
  - [ ] Multi-select
  - [ ] Bulk delete
  - [ ] Bulk download originals
- [ ] Glacier retrieval flow
  - [ ] Request original (initiate restore)
  - [ ] Show restore status
  - [ ] Notify when ready

**Milestone**: Non-technical friend can use it without asking questions.

---

## Phase 4: AI Search

**Goal**: "Show me photos of dogs at the beach"

- [ ] Model download flow
  - [ ] Download SigLIP2-so400m ONNX on first use
  - [ ] Progress indicator
  - [ ] Store in app data directory
- [ ] Embedding generation
  - [ ] Generate on import (background)
  - [ ] Store in manifest
  - [ ] Backfill existing photos
- [ ] Text-to-image search
  - [ ] Embed query text
  - [ ] Cosine similarity search
  - [ ] Results UI
- [ ] Search UX
  - [ ] Search bar in header
  - [ ] Debounced input
  - [ ] Fallback to metadata if no model

**Milestone**: Search "sunset" and get sunset photos.

---

## Phase 5: Identities

**Goal**: "Show me photos of Mom"

- [ ] Identity creation
  - [ ] Select photos, enter name
  - [ ] Compute mean embedding
  - [ ] Store in manifest
- [ ] Identity search
  - [ ] "Photos of Mom" → identity-only search
  - [ ] "Mom at the beach" → hybrid search
- [ ] Identity management
  - [ ] Edit (add/remove photos)
  - [ ] Rename
  - [ ] Delete

**Milestone**: Tag 5 photos of a person, search by name, get relevant results.

---

## Phase 6: Memories

**Goal**: Journal-like entries grouping photos with notes.

- [ ] Memory data model
  - [ ] Title, date range, location, notes (markdown)
  - [ ] Linked photos
  - [ ] Optional audio recordings
- [ ] Memory creation
  - [ ] Select photos → "Create Memory"
  - [ ] Add title, notes
  - [ ] Record audio (optional)
- [ ] Memory browser
  - [ ] Timeline view
  - [ ] Memory cards with cover photo
- [ ] Audio transcription (optional)
  - [ ] Bundle whisper.cpp or whisper-rs
  - [ ] Transcribe on device
  - [ ] Index transcripts for search

**Milestone**: Create a "Summer Trip 2024" memory with 50 photos and a voice note, find it by searching "summer trip".

---

## Phase 7: Geomap

**Goal**: Browse photos by location.

- [ ] Extract GPS from EXIF on import
- [ ] Geo index in manifest (R-tree via SQLite)
- [ ] Map view
  - [ ] Cluster markers at zoom levels
  - [ ] Click cluster → show photos
  - [ ] Click photo → open viewer
- [ ] "Photos near here" search

**Milestone**: Open map, see clusters around places you've been, click to browse.

---

## Phase 8: Sharing & Revocation

**Goal**: Share a vault, revoke access.

- [ ] Export vault file
  - [ ] As file
  - [ ] As QR code
  - [ ] As deep link (boreal://import?data=...)
- [ ] Revoke access flow
  - [ ] Rotate AWS credentials (in-app)
  - [ ] Generate new KEK
  - [ ] Re-encrypt vault-key.enc
  - [ ] Generate new vault file
  - [ ] Clear instructions in UI
- [ ] Multi-vault support
  - [ ] Vault switcher in sidebar
  - [ ] Lock/unlock individual vaults

**Milestone**: Share vault with friend, they can browse. Revoke access, their app stops working.

---

## Phase 9: Video Support

**Goal**: Videos are first-class citizens.

- [ ] Video upload
  - [ ] Generate thumbnail (first frame or middle frame)
  - [ ] Extract duration, resolution
- [ ] Video playback
  - [ ] Stream from S3 (if Instant Retrieval)
  - [ ] Download first for Deep Archive
- [ ] Video in Memories
  - [ ] Include in Memory
  - [ ] Playback in Memory view

**Milestone**: Upload vacation videos, browse alongside photos, play them.

---

## Phase 10: Polish & Edge Cases

**Goal**: Robust for daily use.

- [ ] Error handling
  - [ ] Network failures
  - [ ] Corrupt files
  - [ ] S3 quota limits
- [ ] Progress indicators
  - [ ] Upload progress (per file, total)
  - [ ] Sync progress
  - [ ] Retrieval progress
- [ ] Settings
  - [ ] Cache size limit
  - [ ] Thumbnail quality
  - [ ] Storage tier preference for new uploads
- [ ] Duplicate detection
  - [ ] Hash-based deduplication
  - [ ] "This file already exists" warning
- [ ] Import from
  - [ ] Folder (bulk import)
  - [ ] Google Photos export
  - [ ] Apple Photos export

**Milestone**: Can be someone's primary photo storage without anxiety.


## Notes

- On uploading always order the upload items by biggest file size first