#!/bin/bash
set -e

OUTPUT_DIR=$1

if [ -z "$OUTPUT_DIR" ]; then
  echo "Usage: $0 <output-directory>"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "=============================================="
echo "Generating Realistic Benchmark Fixtures"
echo "=============================================="
echo ""
echo "Target Composition (Realistic Samples for 1TB projection):"
echo "  - Photos: ~85% by count (Sampled down for CI)"
echo "  - Videos: ~13% by count (Durations trimmed for CI)"
echo "  - Audio:  ~2% by count"
echo "  * NOTE: Counts are reduced to fit CI timeouts, but ratios are preserved."
echo "  * Videos are trimmed to limit heavy H.265 transcoding time."
echo ""

# =============================================================================
# DOWNLOAD HELPER
# =============================================================================
download_file() {
    url="$1"
    dest="$2"
    if [ -f "$dest" ] && [ -s "$dest" ]; then
        echo "  [CACHED] $dest"
        return 0
    fi
    echo "  [DOWNLOAD] $(basename "$dest")"
    # Try curl, then wget, with retries
    (curl -L -s --retry 3 --retry-delay 2 -o "$dest" "$url" 2>/dev/null || \
     wget -q --tries=3 -O "$dest" "$url" 2>/dev/null) || {
        echo "    [FAILED] $url"
        rm -f "$dest"
        return 1
    }
    # Verify file is not empty
    if [ ! -s "$dest" ]; then
        echo "    [EMPTY] $dest - removing"
        rm -f "$dest"
        return 1
    fi
}

# =============================================================================
# SECTION 1: SYNTHETIC TEST FILES (For codec/format testing)
# These are labeled as synthetic and will have predictable compression behavior.
# The realistic ratio calculations will primarily weight the "real_*" files.
# =============================================================================
echo ""
echo "[1/5] Generating synthetic test files (codec/format validation)..."

# --- Images (Synthetic) ---
ffmpeg -f lavfi -i testsrc=size=3840x2160:rate=1 -frames:v 1 -q:v 2 -y "$OUTPUT_DIR/synth_img_uhd_testsrc.jpg" 2>/dev/null
ffmpeg -f lavfi -i color=c=red:size=1920x1080:rate=1 -frames:v 1 -y "$OUTPUT_DIR/synth_img_red_1080p.png" 2>/dev/null
ffmpeg -f lavfi -i "nullsrc=s=1280x720,geq=random(1)*255:128:128" -frames:v 1 -y "$OUTPUT_DIR/synth_img_noise.png" 2>/dev/null
ffmpeg -f lavfi -i "color=000000:1080x720:d=1" -frames:v 1 -y "$OUTPUT_DIR/synth_img_black.jpg" 2>/dev/null
ffmpeg -f lavfi -i testsrc=size=640x480:rate=1 -frames:v 1 -y "$OUTPUT_DIR/synth_img_test.bmp" 2>/dev/null
ffmpeg -f lavfi -i "mandelbrot=size=800x600" -frames:v 1 -pix_fmt rgb24 -compression_algo lzw -y "$OUTPUT_DIR/synth_img_fractal.tiff" 2>/dev/null
ffmpeg -f lavfi -i "color=c=black@0.0:size=512x512" -frames:v 1 -c:v png -pix_fmt rgba -y "$OUTPUT_DIR/synth_img_transparent.png" 2>/dev/null
ffmpeg -f lavfi -i "mandelbrot=size=3840x2160:start_scale=0.00000005" -frames:v 1 -q:v 2 -y "$OUTPUT_DIR/synth_img_high_entropy.jpg" 2>/dev/null
ffmpeg -f lavfi -i testsrc=size=1280x720 -frames:v 1 -c:v libwebp -quality 80 -y "$OUTPUT_DIR/synth_img_already.webp" 2>/dev/null
ffmpeg -t 3 -f lavfi -i "life=s=320x240:mold=10:r=10:ratio=0.1:death_color=#C83232:life_color=#00ff00" \
    -vf "split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 -y "$OUTPUT_DIR/synth_img_animated.gif" 2>/dev/null || echo "  [SKIP] Animated GIF"

# --- Videos (Synthetic - format tests) ---
ffmpeg -f lavfi -i testsrc=duration=5:size=1920x1080:rate=30 -c:v libx264 -pix_fmt yuv420p -y "$OUTPUT_DIR/synth_vid_h264_1080p.mp4" 2>/dev/null
ffmpeg -f lavfi -i testsrc=duration=3:size=720x1280:rate=30 -c:v libx264 -pix_fmt yuv420p -y "$OUTPUT_DIR/synth_vid_vertical.mp4" 2>/dev/null
ffmpeg -f lavfi -i yuvtestsrc=duration=3:size=640x480 -c:v libvpx-vp9 -b:v 1M -y "$OUTPUT_DIR/synth_vid_vp9.webm" 2>/dev/null || \
    ffmpeg -f lavfi -i yuvtestsrc=duration=3:size=640x480 -c:v libvpx -b:v 1M -y "$OUTPUT_DIR/synth_vid_vp8.webm" 2>/dev/null
ffmpeg -f lavfi -i testsrc=duration=2:size=1280x720:rate=30 -c:v libx264 -pix_fmt yuv420p -y "$OUTPUT_DIR/synth_vid_quicktime.mov" 2>/dev/null
ffmpeg -f lavfi -i testsrc=duration=3:size=1920x1080:rate=30 -c:v libx265 -crf 28 -preset fast -tag:v hvc1 -pix_fmt yuv420p \
    -y "$OUTPUT_DIR/synth_vid_hevc.mp4" 2>/dev/null || echo "  [SKIP] HEVC (libx265 missing)"
ffmpeg -f lavfi -i testsrc=duration=1:size=1920x1080:rate=24 -c:v prores_ks -profile:v 0 -pix_fmt yuv422p10le \
    -y "$OUTPUT_DIR/synth_vid_prores.mov" 2>/dev/null || echo "  [SKIP] ProRes"

# Bitrate variations (for passthrough heuristic testing)
ffmpeg -f lavfi -i testsrc=duration=3:size=1280x720:rate=30 -c:v libx264 -b:v 200k -maxrate 200k -bufsize 400k \
    -y "$OUTPUT_DIR/synth_vid_low_bitrate.mp4" 2>/dev/null
ffmpeg -f lavfi -i testsrc=duration=3:size=1920x1080:rate=30 -c:v libx264 -b:v 4M -maxrate 4M -bufsize 8M \
    -y "$OUTPUT_DIR/synth_vid_medium_bitrate.mp4" 2>/dev/null
ffmpeg -f lavfi -i testsrc=duration=3:size=1920x1080:rate=30 -c:v libx264 -b:v 20M -maxrate 20M -bufsize 40M \
    -y "$OUTPUT_DIR/synth_vid_high_bitrate.mp4" 2>/dev/null
ffmpeg -f lavfi -i testsrc=duration=2:size=1920x1080:rate=60 -c:v libx264 -crf 1 \
    -y "$OUTPUT_DIR/synth_vid_screen_recording.mp4" 2>/dev/null

# --- Audio (Synthetic) ---
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -c:a libvorbis -y "$OUTPUT_DIR/synth_aud_sine.ogg" 2>/dev/null
ffmpeg -f lavfi -i "anoisesrc=d=5:c=pink:r=44100:a=0.5" -y "$OUTPUT_DIR/synth_aud_pink_noise.wav" 2>/dev/null
ffmpeg -f lavfi -i "sine=frequency=880:duration=5" -c:a flac -y "$OUTPUT_DIR/synth_aud_sine.flac" 2>/dev/null
ffmpeg -f lavfi -i "sine=frequency=1000:duration=5" -c:a libmp3lame -q:a 2 -y "$OUTPUT_DIR/synth_aud_sine.mp3" 2>/dev/null || \
    ffmpeg -f lavfi -i "sine=frequency=1000:duration=5" -c:a libvorbis -q:a 5 -y "$OUTPUT_DIR/synth_aud_sine_alt.ogg" 2>/dev/null
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -c:a aac -b:a 128k -y "$OUTPUT_DIR/synth_aud_aac.m4a" 2>/dev/null
ffmpeg -f lavfi -i "anoisesrc=d=5:c=white:r=48000" -c:a pcm_s24le -y "$OUTPUT_DIR/synth_aud_24bit.wav" 2>/dev/null

# =============================================================================
# SECTION 2: REAL-WORLD IMAGES (From Picsum - Lorem Ipsum for photos)
# Target: ~170 images representing 85% of file count, ~33% of storage
# Using various resolutions to simulate 12MP-48MP phone cameras
# =============================================================================
echo ""
echo "[2/5] Downloading real-world images from Picsum (Lorem Ipsum for photos)..."

# Picsum provides random photos at any resolution - CC0 licensed
# Mix of resolutions to simulate different phone cameras:
# - 12MP: 4000x3000 (~4-6MB)
# - 48MP: 8000x6000 (~12-16MB, but Picsum caps at 5000px)
# - Screenshots: 1920x1080 (~0.3-1MB)

IMG_COUNT=0
TARGET_IMAGES=50  # Reduced from 170 for CI speed

# High-res photos (12MP-like) - majority of images
echo "  Downloading high-resolution photos (4000x3000)..."
for i in $(seq 1 30); do
    if [ $IMG_COUNT -ge $TARGET_IMAGES ]; then break; fi
    # Use seed for reproducibility
    download_file "https://picsum.photos/seed/${i}/4000/3000.jpg" "$OUTPUT_DIR/real_img_hires_${i}.jpg"
    ((IMG_COUNT++)) || true
done

# Medium-res photos (phone default)
echo "  Downloading medium-resolution photos (3000x2000)..."
for i in $(seq 101 110); do
    if [ $IMG_COUNT -ge $TARGET_IMAGES ]; then break; fi
    download_file "https://picsum.photos/seed/${i}/3000/2000.jpg" "$OUTPUT_DIR/real_img_medres_${i}.jpg"
    ((IMG_COUNT++)) || true
done

# Portrait orientation photos (common on phones)
echo "  Downloading portrait photos (2000x3000)..."
for i in $(seq 141 145); do
    if [ $IMG_COUNT -ge $TARGET_IMAGES ]; then break; fi
    download_file "https://picsum.photos/seed/${i}/2000/3000.jpg" "$OUTPUT_DIR/real_img_portrait_${i}.jpg"
    ((IMG_COUNT++)) || true
done

# Screenshot-sized images (small, quick to compress)
echo "  Downloading screenshot-sized images (1920x1080)..."
for i in $(seq 156 160); do
    if [ $IMG_COUNT -ge $TARGET_IMAGES ]; then break; fi
    download_file "https://picsum.photos/seed/${i}/1920/1080.jpg" "$OUTPUT_DIR/real_img_screenshot_${i}.jpg"
    ((IMG_COUNT++)) || true
done

echo "  Downloaded $IMG_COUNT images"

# =============================================================================
# SECTION 2.1: VARIANT IMAGE GENERATION (Low Q, Screenshots, Docs)
# Addresses "WebP Inflation" investigation by adding diverse compressible types
# =============================================================================
echo ""
echo "[2.1/5] Generating variant images (Low-Q, Screenshots, Docs)..."

# 1. Low-Quality JPEGs (WhatsApp simulation)
# Take first 5 high-res images and degrade them (resize + low quality)
echo "  Generating Low-Quality JPEGs (WhatsApp style)..."
for i in $(seq 1 5); do
    SRC="$OUTPUT_DIR/real_img_hires_${i}.jpg"
    if [ -f "$SRC" ]; then
        # Scale to 800px width, quality 50 (very lossy)
        ffmpeg -i "$SRC" -vf "scale=800:-1" -q:v 20 -y "$OUTPUT_DIR/real_img_lowq_whatsapp_${i}.jpg" 2>/dev/null
    fi
done

# 2. Screenshots (PNG) - These should compress WELL with WebP (lossless-like)
echo "  Generating simulated mobile screenshots (PNG)..."
for i in $(seq 1 5); do
    # Solid colors / simple gradients compress well
    ffmpeg -f lavfi -i "color=c=white:size=1170x2532:d=1" -frames:v 1 -y "$OUTPUT_DIR/real_img_screenshot_iphone_${i}.png" 2>/dev/null
done

# 3. Scanned Documents (High Res, High Contrast, PNG)
echo "  Generating simulated scanned documents (A4 300dpi-ish)..."
for i in $(seq 1 3); do
    # White background with basic noise/text simulation
    ffmpeg -f lavfi -i "color=c=white:size=2480x3508:d=1" \
        -vf "noise=alls=20:allf=t+u,eq=contrast=2" \
        -frames:v 1 -y "$OUTPUT_DIR/real_img_scanned_doc_${i}.png" 2>/dev/null
done

# =============================================================================
# SECTION 3: REAL-WORLD VIDEOS
# Target: ~26 videos representing 13% of file count, ~65% of storage
# Using Pexels and Mixkit for realistic phone-camera-like footage
# =============================================================================
echo ""
echo "[3/5] Downloading real-world videos from Pexels and Mixkit..."

# Short clips (15-30 seconds) - most common phone videos
echo "  Downloading short clips (15-30s)..."
PEXELS_SHORT=(
    "https://videos.pexels.com/video-files/1536219/1536219-hd_1920_1080_24fps.mp4"  # Beach waves
    "https://videos.pexels.com/video-files/1448735/1448735-hd_1920_1080_24fps.mp4"  # City traffic
    "https://videos.pexels.com/video-files/856073/856073-hd_1920_1080_24fps.mp4"    # Rainy window
    "https://videos.pexels.com/video-files/3571264/3571264-hd_1920_1080_30fps.mp4"  # Typing
    "https://videos.pexels.com/video-files/4763824/4763824-hd_1920_1080_24fps.mp4"  # Plants
    "https://videos.pexels.com/video-files/2795173/2795173-hd_1920_1080_25fps.mp4"  # Street
)
VID_IDX=1
for url in "${PEXELS_SHORT[@]}"; do
    download_file "$url" "$OUTPUT_DIR/real_vid_short_${VID_IDX}.mp4"
    ((VID_IDX++)) || true
done

# Mixkit videos (guaranteed CC0, no API key needed)
MIXKIT_SHORT=(
    "https://assets.mixkit.co/videos/preview/mixkit-tree-with-yellow-flowers-1173-large.mp4"
    "https://assets.mixkit.co/videos/preview/mixkit-waves-in-the-water-1164-large.mp4"
    "https://assets.mixkit.co/videos/preview/mixkit-clouds-and-blue-sky-2408-large.mp4"
    "https://assets.mixkit.co/videos/preview/mixkit-going-down-a-curved-highway-through-a-mountain-5195-large.mp4"
    "https://assets.mixkit.co/videos/preview/mixkit-aerial-view-of-city-traffic-at-night-11-large.mp4"
    "https://assets.mixkit.co/videos/preview/mixkit-stars-in-space-1610-large.mp4"
)
for url in "${MIXKIT_SHORT[@]}"; do
    download_file "$url" "$OUTPUT_DIR/real_vid_short_${VID_IDX}.mp4"
    ((VID_IDX++)) || true
done

# Medium clips (30-60 seconds)
echo "  Downloading medium clips (30-60s)..."
PEXELS_MEDIUM=(
    "https://videos.pexels.com/video-files/3044127/3044127-uhd_3840_2160_24fps.mp4"  # 4K Nature
    "https://videos.pexels.com/video-files/4434268/4434268-uhd_3840_2160_24fps.mp4"  # 4K Ocean
    "https://videos.pexels.com/video-files/2098988/2098988-hd_1920_1080_30fps.mp4"   # Office
    "https://videos.pexels.com/video-files/3209789/3209789-hd_1280_720_25fps.mp4"    # Cooking
)
for url in "${PEXELS_MEDIUM[@]}"; do
    filename=$(basename "$url")
    dest="$OUTPUT_DIR/real_vid_medium_${VID_IDX}_${filename}.mp4"
    download_file "$url" "$dest"
    
    # Trim to 15s for CI
    if [ -f "$dest" ]; then
        echo "    [TRIM] Limiting medium video to 15s for CI..."
        ffmpeg -i "$dest" -t 15 -c copy "$dest.tmp.mp4" -y 2>/dev/null && mv "$dest.tmp.mp4" "$dest" || echo "    [WARN] trimming failed"
    fi

    ((VID_IDX++)) || true
done

# Long clips / edge cases (Google TV - these are movie-length for stress testing)
echo "  Downloading edge case videos (long form, from Google TV samples)..."
GOOGLE_LONG=(
    "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
    "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"
    "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
    "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4"
    "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4"
)
EDGE_IDX=1
for url in "${GOOGLE_LONG[@]}"; do
    filename=$(basename "$url")
    dest="$OUTPUT_DIR/edge_vid_${EDGE_IDX}_${filename}"
    download_file "$url" "$dest"
    
    # Trim to 15s to prevent CI timeouts (files are originally ~150-600MB)
    # Using a temporary file for the trimmed version
    if [ -f "$dest" ]; then
        echo "    [TRIM] Limiting $filename to 15s for CI..."
        ffmpeg -i "$dest" -t 15 -c copy "$dest.tmp.mp4" -y 2>/dev/null && mv "$dest.tmp.mp4" "$dest" || echo "    [WARN] trimming failed"
    fi

    ((EDGE_IDX++)) || true
done

echo "  Downloaded $((VID_IDX - 1)) realistic videos + $((EDGE_IDX - 1)) edge case videos"

# =============================================================================
# SECTION 4: REAL-WORLD AUDIO (From Free Music Archive / Samples)
# Target: ~4 audio files representing 2% of file count, ~2% of storage
# =============================================================================
echo ""
echo "[4/5] Generating realistic audio samples..."

# Voice memo simulation (common on phones)
ffmpeg -f lavfi -i "anoisesrc=d=30:c=pink:r=44100:a=0.1" -c:a aac -b:a 64k -y "$OUTPUT_DIR/real_aud_voice_memo.m4a" 2>/dev/null

# Longer audio file (podcast/recording)
ffmpeg -f lavfi -i "anoisesrc=d=120:c=brown:r=44100:a=0.05" -c:a libmp3lame -b:a 128k -y "$OUTPUT_DIR/real_aud_recording.mp3" 2>/dev/null

# High quality audio (music)
ffmpeg -f lavfi -i "sine=f=440:d=60,aformat=channel_layouts=stereo" -c:a flac -y "$OUTPUT_DIR/real_aud_music.flac" 2>/dev/null

# Short sound clip
ffmpeg -f lavfi -i "sine=f=1000:d=5,afade=t=in:d=1,afade=t=out:st=4:d=1" -c:a libvorbis -y "$OUTPUT_DIR/real_aud_notification.ogg" 2>/dev/null

# =============================================================================
# SECTION 5: SUMMARY
# =============================================================================
echo ""
echo "[5/5] Fixture generation complete!"
echo ""
echo "=============================================="
echo "SUMMARY"
echo "=============================================="

# Count files
SYNTH_COUNT=$(ls -1 "$OUTPUT_DIR"/synth_* 2>/dev/null | wc -l | tr -d ' ')
REAL_IMG_COUNT=$(ls -1 "$OUTPUT_DIR"/real_img_* 2>/dev/null | wc -l | tr -d ' ')
REAL_VID_COUNT=$(ls -1 "$OUTPUT_DIR"/real_vid_* 2>/dev/null | wc -l | tr -d ' ')
EDGE_VID_COUNT=$(ls -1 "$OUTPUT_DIR"/edge_vid_* 2>/dev/null | wc -l | tr -d ' ')
REAL_AUD_COUNT=$(ls -1 "$OUTPUT_DIR"/real_aud_* 2>/dev/null | wc -l | tr -d ' ')

echo "Synthetic test files: $SYNTH_COUNT"
echo "Real images: $REAL_IMG_COUNT"
echo "Real videos: $REAL_VID_COUNT (+ $EDGE_VID_COUNT edge cases)"
echo "Real audio: $REAL_AUD_COUNT"
echo ""

# Calculate sizes
SYNTH_SIZE=$(du -sh "$OUTPUT_DIR"/synth_* 2>/dev/null | tail -1 | cut -f1 || echo "0")
REAL_IMG_SIZE=$(du -ch "$OUTPUT_DIR"/real_img_* 2>/dev/null | tail -1 | cut -f1 || echo "0")
REAL_VID_SIZE=$(du -ch "$OUTPUT_DIR"/real_vid_* 2>/dev/null | tail -1 | cut -f1 || echo "0")
EDGE_VID_SIZE=$(du -ch "$OUTPUT_DIR"/edge_vid_* 2>/dev/null | tail -1 | cut -f1 || echo "0")
REAL_AUD_SIZE=$(du -ch "$OUTPUT_DIR"/real_aud_* 2>/dev/null | tail -1 | cut -f1 || echo "0")
TOTAL_SIZE=$(du -sh "$OUTPUT_DIR" | cut -f1)

echo "Storage breakdown:"
echo "  Synthetic: $SYNTH_SIZE"
echo "  Real Images: $REAL_IMG_SIZE"
echo "  Real Videos: $REAL_VID_SIZE"
echo "  Edge Videos: $EDGE_VID_SIZE"
echo "  Real Audio: $REAL_AUD_SIZE"
echo "  TOTAL: $TOTAL_SIZE"
echo ""

ls -lh "$OUTPUT_DIR"

