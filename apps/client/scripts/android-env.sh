#!/bin/sh
# Basic Android Environment Setup
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_NDK_ROOT="$ANDROID_HOME/ndk/29.0.14206865"
export ANDROID_NDK="$ANDROID_NDK_ROOT"
export NDK_HOME="$ANDROID_NDK_ROOT"
export ANDROID_NDK_HOME="$ANDROID_NDK_ROOT"


export NDK_TOOLCHAIN_BIN="$ANDROID_NDK_ROOT/toolchains/llvm/prebuilt/darwin-x86_64/bin"
export ANDROID_ABI=arm64-v8a

# Set CC/CXX/AR for Rust 'cc' crate cross-compilation
# aarch64
export CC_aarch64_linux_android="$NDK_TOOLCHAIN_BIN/aarch64-linux-android24-clang"
export CXX_aarch64_linux_android="$NDK_TOOLCHAIN_BIN/aarch64-linux-android24-clang++"
export AR_aarch64_linux_android="$NDK_TOOLCHAIN_BIN/llvm-ar"
export CC_AARCH64_LINUX_ANDROID="$CC_aarch64_linux_android"
export CXX_AARCH64_LINUX_ANDROID="$CXX_aarch64_linux_android"
export AR_AARCH64_LINUX_ANDROID="$AR_aarch64_linux_android"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$NDK_TOOLCHAIN_BIN/aarch64-linux-android24-clang"

# Force global CC/CXX/AR for CMake to pick up the correct compiler
export CC="$CC_aarch64_linux_android"
export CXX="$CXX_aarch64_linux_android"
export AR="$AR_aarch64_linux_android"
export RANLIB="$NDK_TOOLCHAIN_BIN/llvm-ranlib"

# Aggressively prevent macOS/Xcode environment from interfering with cross-compilation
unset MACOSX_DEPLOYMENT_TARGET
unset SDKROOT
export CMAKE_OSX_ARCHITECTURES=""
export CMAKE_OSX_SYSROOT=""
export CMAKE_OSX_DEPLOYMENT_TARGET=""
export IPHONEOS_DEPLOYMENT_TARGET=""
export TVOS_DEPLOYMENT_TARGET=""
export WATCHOS_DEPLOYMENT_TARGET=""
export ARCHFLAGS=""

# Use custom CMake toolchain file to ensure Android settings are respected
export CMAKE_TOOLCHAIN_FILE="/Users/jorgesoares/Code/memories/apps/client/src-tauri/Android.cmake"

# Set up Android-specific CMake variables  
export CMAKE_SYSTEM_NAME=Android
export CMAKE_SYSTEM_VERSION=24
export CMAKE_ANDROID_ARCH_ABI=arm64-v8a
export CMAKE_ANDROID_NDK=$ANDROID_NDK_ROOT
export CMAKE_ANDROID_STL=c++_shared
export CMAKE_ANDROID_PLATFORM=android-24
export CMAKE_ANDROID_NATIVE_API_LEVEL=24

# Use Ninja generator and set it explicitly
export CMAKE_GENERATOR=Ninja
export CMAKE_MAKE_PROGRAM=$(which ninja)

# Use pregenerated AWS-LC sources for release builds
export AWS_LC_SYS_STATIC=1
export AWS_LC_SYS_NO_PREGENERATED_SRC=0


# armv7
export CC_armv7_linux_androideabi="$NDK_TOOLCHAIN_BIN/armv7a-linux-androideabi24-clang"
export CXX_armv7_linux_androideabi="$NDK_TOOLCHAIN_BIN/armv7a-linux-androideabi24-clang++"
export AR_armv7_linux_androideabi="$NDK_TOOLCHAIN_BIN/llvm-ar"
export CC_ARMV7_LINUX_ANDROIDEABI="$CC_armv7_linux_androideabi"
export CXX_ARMV7_LINUX_ANDROIDEABI="$CXX_armv7_linux_androideabi"
export AR_ARMV7_LINUX_ANDROIDEABI="$AR_armv7_linux_androideabi"
export CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER="$NDK_TOOLCHAIN_BIN/armv7a-linux-androideabi24-clang"

# i686
export CC_i686_linux_android="$NDK_TOOLCHAIN_BIN/i686-linux-android24-clang"
export CXX_i686_linux_android="$NDK_TOOLCHAIN_BIN/i686-linux-android24-clang++"
export AR_i686_linux_android="$NDK_TOOLCHAIN_BIN/llvm-ar"
export CC_I686_LINUX_ANDROID="$CC_i686_linux_android"
export CXX_I686_LINUX_ANDROID="$CXX_i686_linux_android"
export AR_I686_LINUX_ANDROID="$AR_i686_linux_android"
export CARGO_TARGET_I686_LINUX_ANDROID_LINKER="$NDK_TOOLCHAIN_BIN/i686-linux-android24-clang"

# x86_64
export CC_x86_64_linux_android="$NDK_TOOLCHAIN_BIN/x86_64-linux-android24-clang"
export CXX_x86_64_linux_android="$NDK_TOOLCHAIN_BIN/x86_64-linux-android24-clang++"
export AR_x86_64_linux_android="$NDK_TOOLCHAIN_BIN/llvm-ar"
export CC_X86_64_LINUX_ANDROID="$CC_x86_64_linux_android"
export CXX_X86_64_LINUX_ANDROID="$CXX_x86_64_linux_android"
export AR_X86_64_LINUX_ANDROID="$AR_x86_64_linux_android"
export CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER="$NDK_TOOLCHAIN_BIN/x86_64-linux-android24-clang"

# Generate Android-specific Cargo config (this replaces what was in .cargo/config.toml)
CARGO_CONFIG_DIR="$(cd "$(dirname "$0")/../src-tauri/.cargo" && pwd)"
mkdir -p "$CARGO_CONFIG_DIR"
cat > "$CARGO_CONFIG_DIR/config.toml" << CARGO_EOF
[target.aarch64-linux-android]
ar = "$ANDROID_NDK_ROOT/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-ar"
linker = "$ANDROID_NDK_ROOT/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android24-clang"
rustflags = [
    "-C", "link-arg=-landroid",
    "-C", "link-arg=-llog",
    "-C", "link-arg=-lOpenSLES"
]
CARGO_EOF

exec "$@"
