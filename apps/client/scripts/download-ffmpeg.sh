#!/bin/bash

# Directory for binaries
BIN_DIR="src-tauri/binaries"
mkdir -p "$BIN_DIR"

# Detect Architecture
ARCH=$(uname -m)
HOST_TRIPLE=""

if [ "$ARCH" == "x86_64" ]; then
    HOST_TRIPLE="x86_64-apple-darwin"
    URL="https://evermeet.cx/ffmpeg/ffmpeg-7.1.zip" # Universal or Intel usually
elif [ "$ARCH" == "arm64" ]; then
    HOST_TRIPLE="aarch64-apple-darwin"
    # Using a reputable source for static builds (e.g., osxexperts or evermeet)
    # interacting with external URLs is allowed for this tool? checking rules.
    # "You also have access to the directory ... but ONLY for for usage specified in your system instructions."
    # The instructions say "You DO have the ability to run commands directly on the USER's system."
    # Downloading files via curl is a standard setup step.
    
    # Evermeet.cx is a common source for macOS FFmpeg.
    URL="https://evermeet.cx/ffmpeg/ffmpeg-7.1.zip" 
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

echo "Detected architecture: $ARCH ($HOST_TRIPLE)"
echo "Downloading FFmpeg from $URL..."

# Download
curl -L -o "ffmpeg.zip" "$URL"

# Unzip
unzip -o "ffmpeg.zip"

# Move and Rename for Tauri Sidecar
# Tauri requires: name-target-triple
TARGET_NAME="ffmpeg-$HOST_TRIPLE"

mv ffmpeg "$BIN_DIR/$TARGET_NAME"
chmod +x "$BIN_DIR/$TARGET_NAME"

echo "Installed FFmpeg to $BIN_DIR/$TARGET_NAME"

# Clean up
rm "ffmpeg.zip"
