# CMake toolchain to prevent macOS flags from being injected
set(CMAKE_SYSTEM_NAME Android)
set(CMAKE_SYSTEM_VERSION 24)
set(CMAKE_ANDROID_ARCH_ABI arm64-v8a)
set(CMAKE_ANDROID_PLATFORM android-24)

# Completely disable macOS-specific settings
set(CMAKE_OSX_ARCHITECTURES "")
set(CMAKE_OSX_SYSROOT "")
set(CMAKE_CROSSCOMPILING ON)

# Use the NDK toolchain
set(CMAKE_ANDROID_NDK $ENV{ANDROID_NDK_ROOT})
set(CMAKE_ANDROID_STL c++_shared)
set(CMAKE_ANDROID_NATIVE_API_LEVEL 24)
