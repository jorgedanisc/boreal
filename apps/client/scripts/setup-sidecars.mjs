import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpegPath from 'ffmpeg-static';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Target directory: ../src-tauri/bin
const TARGET_DIR = path.resolve(__dirname, '../src-tauri/bin');

function getTargetTriple() {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === 'darwin') {
    return arch === 'arm64'
      ? 'aarch64-apple-darwin'
      : 'x86_64-apple-darwin';
  }
  if (platform === 'win32') {
    return arch === 'x64'
      ? 'x86_64-pc-windows-msvc'
      : 'i686-pc-windows-msvc';
  }
  if (platform === 'linux') {
    return arch === 'arm64'
      ? 'aarch64-unknown-linux-gnu'
      : 'x86_64-unknown-linux-gnu';
  }
  throw new Error(`Unsupported platform: ${platform} ${arch}`);
}

async function main() {
  const triple = getTargetTriple();
  const platform = os.platform();
  const ext = platform === 'win32' ? '.exe' : '';
  const targetName = `ffmpeg-${triple}${ext}`;
  const targetPath = path.join(TARGET_DIR, targetName);

  // Ensure target directory exists
  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  // Copy ffmpeg binary
  if (!ffmpegPath) {
    console.error('ffmpeg-static did not provide a binary path.');
    process.exit(1);
  }

  console.log(`Copying FFmpeg from ${ffmpegPath} to ${targetPath}...`);
  fs.copyFileSync(ffmpegPath, targetPath);

  // Choose correct permissions
  if (platform !== 'win32') {
    fs.chmodSync(targetPath, 0o755);
  }

  console.log('FFmpeg sidecar setup complete.');
}

main().catch(console.error);
