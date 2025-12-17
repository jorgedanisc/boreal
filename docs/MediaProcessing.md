# Media Processing

> Normalized, predictable, forever-playable.

---

## Philosophy for Originals

All uploaded media is normalized to modern, universal formats for the originals:

- **Visually lossless** — You cannot perceive the difference
- **Resolution preserved** — Exact dimensions, no downscaling
- **Predictable formats** — WebP for images, H.265 for video, Opus for audio
- **Universal playback** — Works on any device from the last 5 years

---

## Storage Layout

```
s3://vault-{id}/
├── manifest.sqlite              # Standard (sync state, search index, CLIP embeddings)
├── thumbnails/                  # Standard
│   └── {year}/{month}/
│       ├── {image_id}.webp      # Static thumbnail, 720px max side, ~30-40KB
│       └── {video_id}.webp      # Animated preview, 10 frames
├── audio/                       # Standard
│   └── {year}/{month}/
│       └── {id}.opus            # 128kbps
├── originals/                   # Glacier (IR or Deep Archive - user chooses)
│   ├── images/
│   │   └── {year}/{month}/
│   │       └── {id}.webp        # Lossy 90
│   └── videos/
│       └── {year}/{month}/
│           └── {id}.mp4         # H.265 CRF 18, HDR preserved
└── memories/                    # Standard
    └── {id}.json                # Text + metadata + file references
```

---

## Memory Structure

Text lives directly in the memory record. No separate text folder—keeps atomic operations simple.

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Summer in Lisbon",
  "text": "We walked through Alfama as the sun set behind the Tagus. Maria pointed out the window where her grandmother used to hang laundry...",
  "date_range": {
    "start": "2024-07-15",
    "end": "2024-07-22"
  },
  "location": {
    "lat": 38.7223,
    "lng": -9.1393,
    "name": "Lisbon, Portugal"
  },
  "files": [
    { "id": "abc123", "type": "image" },
    { "id": "def456", "type": "video" },
    { "id": "ghi789", "type": "audio", "transcription": "..." }
  ],
  "created_at": "2024-08-01T14:32:00Z",
  "updated_at": "2024-08-01T14:32:00Z"
}
```

**Why inline text:**
- Single atomic write per memory
- No cross-reference complexity
- JSON compresses well (gzip in transit)
- Full-text search via manifest.sqlite anyway
- Memory files are tiny (few KB each)

---

## Image Processing
### Original

```bash
ffmpeg -i input.{any} \
  -c:v libwebp \
  -quality 90 \
  -preset photo \
  -metadata:s:v:0 rotate=0 \
  output.webp
```

### Thumbnail

```bash
ffmpeg -i input.{any} \
  -vf "scale=720:720:force_original_aspect_ratio=decrease:flags=lanczos"
  -c:v libwebp \
  -quality 70 \
  -preset photo \
  -compression_level 6 \
  output_thumb.webp
```

**Expected output**: ~30-40KB per thumbnail (static image)

---

## Video Processing

### Original (H.265, HDR Preserved)

```bash
ffmpeg -i input.{any} \
  -c:v libx265 \
  -crf 18 \
  -preset slow \
  -tag:v hvc1 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  -map_metadata 0 \
  output.mp4
```

### Animated Preview (10 Frames)

```bash
# Calculate frame interval based on duration
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 input.mp4)
INTERVAL=$(echo "$DURATION * 0.9 / 10" | bc -l)
START=$(echo "$DURATION * 0.05" | bc -l)

ffmpeg -i input.mp4 \
  -ss $START \
  -vf "fps=1/$INTERVAL,scale=480:-2:flags=lanczos" \
  -frames:v 10 \
  -c:v libwebp \
  -lossless 0 \
  -quality 75 \
  -loop 0 \
  -an \
  preview.webp
```

**Frame selection logic:**
- Skip first 5% (often logos, black frames)
- Skip last 5% (often credits, fade out)
- 10 evenly-spaced frames from the middle 90%
- 300ms per frame = 3 second loop

### Thumbnail (Static, from Video)

```bash
# Single frame at 10% duration
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 input.mp4)
TIMESTAMP=$(echo "$DURATION * 0.1" | bc -l)

ffmpeg -i input.mp4 \
  -ss $TIMESTAMP \
  -vframes 1 \
  -vf "scale='min(800,iw)':min'(800,ih)':force_original_aspect_ratio=decrease" \
  -c:v libwebp \
  -quality 80 \
  thumbnail.webp
```

---

## Audio Processing

### Original (Opus 128kbps)

```bash
ffmpeg -i input.{any} \
  -c:a libopus \
  -b:a 128k \
  -vn \
  -map_metadata 0 \
  output.opus
```

**Notes:**
- 128kbps Opus is transparent (indistinguishable from source) for music
- Whisper transcription works perfectly on Opus
- A 10-minute file: ~10MB WAV → ~1MB Opus

---

## Storage Tiers

| Content | S3 Tier | Rationale |
|---------|---------|-----------|
| `manifest.sqlite` | Standard | Synced every session |
| `thumbnails/` | Standard | Constant UI access |
| `audio/` | Standard | Playback needs instant access, files are tiny |
| `memories/` | Standard | Frequent reads, tiny JSON files |
| `originals/images/` | Glacier | Viewed occasionally, need fast access |
| `originals/videos/` | Glacier | Playback on demand, can't wait 12 hours |
