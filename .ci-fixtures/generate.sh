#!/bin/bash
set -e

OUTPUT_DIR=$1

if [ -z "$OUTPUT_DIR" ]; then
  echo "Usage: $0 <output-directory>"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "Generating fixtures in $OUTPUT_DIR..."

# --- 1. Images ---
# High-detail noise (JPEG)
ffmpeg -f lavfi -i testsrc=size=3840x2160:rate=1 -frames:v 1 -q:v 2 -y "$OUTPUT_DIR/img_01_uhd_testsrc.jpg"
# Gradient / Color (PNG)
ffmpeg -f lavfi -i color=c=red:size=1920x1080:rate=1 -frames:v 1 -y "$OUTPUT_DIR/img_02_red_1080p.png"
# Random noise
ffmpeg -f lavfi -i "nullsrc=s=1280x720,geq=random(1)*255:128:128" -frames:v 1 -y "$OUTPUT_DIR/img_03_noise.png"
# Text overlay
ffmpeg -f lavfi -i "color=000000:1080x720:d=1,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='Benchmark':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2" -frames:v 1 -y "$OUTPUT_DIR/img_04_text.jpg" 2>/dev/null || \
ffmpeg -f lavfi -i "color=000000:1080x720:d=1" -frames:v 1 -y "$OUTPUT_DIR/img_04_black.jpg" 
# BMP Image (Uncompressed)
ffmpeg -f lavfi -i testsrc=size=640x480:rate=1 -frames:v 1 -y "$OUTPUT_DIR/img_05_test.bmp"
# TIFF Image
ffmpeg -f lavfi -i "mandelbrot=size=800x600" -frames:v 1 -pix_fmt rgb24 -compression_algo lzw -y "$OUTPUT_DIR/img_06_fractal.tiff"

# Additional Images for volume
for i in {05..10}; do
    ffmpeg -f lavfi -i color=c=blue:size=1024x768 -frames:v 1 -y "$OUTPUT_DIR/img_${i}_blue.jpg"
done

# --- 2. Videos ---
# Standard H.264
ffmpeg -f lavfi -i testsrc=duration=5:size=1920x1080:rate=30 -c:v libx264 -pix_fmt yuv420p -y "$OUTPUT_DIR/vid_01_h264_1080p.mp4"
# High frame rate
ffmpeg -f lavfi -i mandelbrot=size=1280x720:rate=60 -t 5 -c:v libx264 -pix_fmt yuv420p -y "$OUTPUT_DIR/vid_02_hfr_720p.mp4"
# WebM (VP9 if available, else VP8)
ffmpeg -f lavfi -i yuvtestsrc=duration=3:size=640x480 -c:v libvpx-vp9 -b:v 1M -y "$OUTPUT_DIR/vid_03_vp9_480p.webm" 2>/dev/null || \
ffmpeg -f lavfi -i yuvtestsrc=duration=3:size=640x480 -c:v libvpx -b:v 1M -y "$OUTPUT_DIR/vid_03_vp8_480p.webm"

# Noisy video
ffmpeg -f lavfi -i "life=s=320x240:mold=10:r=30:ratio=0.1:death_color=#C83232:life_color=#00ff00,scale=1280:720" -t 5 -c:v libx264 -pix_fmt yuv420p -y "$OUTPUT_DIR/vid_04_noise.mp4"

# Vertical Video (9:16) - Common on Mobile
ffmpeg -f lavfi -i testsrc=duration=3:size=720x1280:rate=30 -c:v libx264 -pix_fmt yuv420p -y "$OUTPUT_DIR/vid_05_vertical_9_16.mp4"

# Square Video (1:1)
ffmpeg -f lavfi -i "mandelbrot=size=720x720:rate=30" -t 3 -c:v libx264 -pix_fmt yuv420p -y "$OUTPUT_DIR/vid_06_square_1_1.mp4"

# Additional Videos
for i in {05..10}; do
    ffmpeg -f lavfi -i testsrc=duration=2:size=800x600:rate=24 -c:v libx264 -pix_fmt yuv420p -y "$OUTPUT_DIR/vid_${i}_short.mp4"
done

# --- 3. Audio ---
# Sine Wave (OGG)
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -c:a libvorbis -y "$OUTPUT_DIR/aud_01_sine.ogg"
# White Noise (WAV) -- wav is not compressed, good baseline
ffmpeg -f lavfi -i "anoisesrc=d=5:c=pink:r=44100:a=0.5" -y "$OUTPUT_DIR/aud_02_pink_noise.wav"
# FLAC (Lossless)
ffmpeg -f lavfi -i "sine=frequency=880:duration=5" -c:a flac -y "$OUTPUT_DIR/aud_03_sine.flac"
# Mixed tones (MP3 if avail, else OGG)
ffmpeg -f lavfi -i "sine=frequency=1000:duration=5" -c:a libmp3lame -q:a 2 -y "$OUTPUT_DIR/aud_03_sine_1khz.mp3" 2>/dev/null || \
ffmpeg -f lavfi -i "sine=frequency=1000:duration=5" -c:a libvorbis -q:a 5 -y "$OUTPUT_DIR/aud_03_sine_1khz.ogg"

# Additional Audio
for i in {04..10}; do
    ffmpeg -f lavfi -i "sine=frequency=$((100 * i)):duration=3" -c:a libvorbis -y "$OUTPUT_DIR/aud_${i}_tone.ogg"
done

# =============================================================================
# ADDITIONAL FILE TYPES - For comprehensive passthrough testing
# =============================================================================

# --- Animated GIF (Tests conversion to animated WebP) ---
ffmpeg -f lavfi -i "life=s=320x240:mold=10:r=10:ratio=0.1:death_color=#C83232:life_color=#00ff00" \
    -t 3 -vf "split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
    -loop 0 -y "$OUTPUT_DIR/img_11_animated.gif" 2>/dev/null || echo "WARN: Animated GIF failed"

# --- HEVC Video (iPhone default since 2017) ---
ffmpeg -f lavfi -i testsrc=duration=3:size=1920x1080:rate=30 \
    -c:v libx265 -crf 28 -preset fast -tag:v hvc1 -pix_fmt yuv420p \
    -y "$OUTPUT_DIR/vid_11_hevc_1080p.mp4" 2>/dev/null || echo "WARN: libx265 missing"

# --- MOV Container (iPhone video format) ---
ffmpeg -f lavfi -i testsrc=duration=2:size=1280x720:rate=30 \
    -c:v libx264 -pix_fmt yuv420p \
    -y "$OUTPUT_DIR/vid_12_quicktime.mov"

# --- ProRes (Professional cameras / Final Cut exports) ---
ffmpeg -f lavfi -i testsrc=duration=1:size=1920x1080:rate=24 \
    -c:v prores_ks -profile:v 0 -pix_fmt yuv422p10le \
    -y "$OUTPUT_DIR/vid_13_prores.mov" 2>/dev/null || echo "WARN: ProRes missing"

# --- HDR / 10-bit Video ---
ffmpeg -f lavfi -i testsrc=duration=2:size=1920x1080:rate=24 \
    -pix_fmt yuv420p10le \
    -c:v libx265 -x265-params "colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc" \
    -y "$OUTPUT_DIR/vid_14_hdr_10bit.mp4" 2>/dev/null || echo "WARN: HDR/x265 missing"

# --- Transparency PNG (with alpha channel) ---
ffmpeg -f lavfi -i "color=c=black@0.0:size=512x512" \
    -frames:v 1 -c:v png -pix_fmt rgba \
    -y "$OUTPUT_DIR/img_12_transparent.png"

# --- High-Entropy Image (Worst case for compression) ---
ffmpeg -f lavfi -i "mandelbrot=size=3840x2160:start_scale=0.00000005" \
    -frames:v 1 -q:v 2 \
    -y "$OUTPUT_DIR/img_13_high_entropy.jpg"

# --- WebP Input (Already compressed - test passthrough logic) ---
ffmpeg -f lavfi -i testsrc=size=1280x720 -frames:v 1 \
    -c:v libwebp -quality 80 \
    -y "$OUTPUT_DIR/img_17_already_webp.webp"

# --- AAC Audio (Most common mobile audio) ---
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" \
    -c:a aac -b:a 128k \
    -y "$OUTPUT_DIR/aud_11_aac.m4a"

# --- High Bitrate Audio (24-bit Lossless) ---
ffmpeg -f lavfi -i "anoisesrc=d=5:c=white:r=48000" \
    -c:a pcm_s24le \
    -y "$OUTPUT_DIR/aud_12_24bit.wav"

# =============================================================================
# BITRATE VARIATIONS - Critical for testing passthrough heuristic
# =============================================================================

# --- Very Low Bitrate (Should ALWAYS passthrough) ---
ffmpeg -f lavfi -i testsrc=duration=3:size=1280x720:rate=30 \
    -c:v libx264 -b:v 200k -maxrate 200k -bufsize 400k \
    -y "$OUTPUT_DIR/vid_15_low_bitrate_200k.mp4"

# --- Medium Bitrate (Borderline - tests threshold) ---
ffmpeg -f lavfi -i testsrc=duration=3:size=1920x1080:rate=30 \
    -c:v libx264 -b:v 4M -maxrate 4M -bufsize 8M \
    -y "$OUTPUT_DIR/vid_16_medium_bitrate_4M.mp4"

# --- High Bitrate (Should compress significantly) ---
ffmpeg -f lavfi -i testsrc=duration=3:size=1920x1080:rate=30 \
    -c:v libx264 -b:v 20M -maxrate 20M -bufsize 40M \
    -y "$OUTPUT_DIR/vid_17_high_bitrate_20M.mp4"

# --- Screen Recording Simulation (Very high bitrate, CRF 1) ---
ffmpeg -f lavfi -i testsrc=duration=2:size=1920x1080:rate=60 \
    -c:v libx264 -crf 1 \
    -y "$OUTPUT_DIR/vid_18_screen_recording.mp4"

echo "Fixtures generated successfully in $OUTPUT_DIR"
ls -lh "$OUTPUT_DIR"

