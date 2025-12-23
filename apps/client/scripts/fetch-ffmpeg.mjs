#!/usr/bin/env node
/**
 * Fetch FFmpeg (and ffprobe) for Tauri sidecar packaging.
 *
 * Default provider: Tyrrrz/FFmpegBin (GitHub Releases)
 * - Assets are expected to be named like: ffmpeg-{os}-{arch}.zip  (per README)
 * - We'll also *scan* the extracted archive to find ffmpeg/ffprobe even if layout differs.
 *
 * Outputs:
 *   src-tauri/binaries/ffmpeg-$TARGET_TRIPLE(.exe)
 *   src-tauri/binaries/ffprobe-$TARGET_TRIPLE(.exe)   (optional)
 *
 * Usage examples:
 *   node scripts/fetch-ffmpeg.mjs
 *   node scripts/fetch-ffmpeg.mjs --version latest --out src-tauri/binaries
 *   node scripts/fetch-ffmpeg.mjs --targets x86_64-unknown-linux-gnu,aarch64-apple-darwin
 *
 * Environment:
 *   GITHUB_TOKEN (optional) -> increases GitHub API rate limit
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

let extractZip;
try {
  ({ default: extractZip } = await import("extract-zip"));
} catch {
  extractZip = null;
}

function parseArgs(argv) {
  const args = {
    repo: "Tyrrrz/FFmpegBin",
    version: "7.1.2",
    out: path.resolve("src-tauri", "binaries"),
    cache: path.resolve(".cache", "ffmpeg"),
    targets: null,
    withFfprobe: true,
    force: false,
    quiet: false,
    binBaseName: "ffmpeg",
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];

    if (a === "--repo") args.repo = next, i++;
    else if (a === "--version") args.version = next, i++;
    else if (a === "--out") args.out = next, i++;
    else if (a === "--cache") args.cache = next, i++;
    else if (a === "--targets") args.targets = next.split(",").map(s => s.trim()).filter(Boolean), i++;
    else if (a === "--no-ffprobe") args.withFfprobe = false;
    else if (a === "--ffprobe") args.withFfprobe = true;
    else if (a === "--force") args.force = true;
    else if (a === "--quiet") args.quiet = true;
    else if (a === "--bin") args.binBaseName = next, i++;
    else if (a === "-h" || a === "--help") {
      console.log(`
fetch-ffmpeg.mjs

Options:
  --repo <owner/repo>       GitHub repo (default: Tyrrrz/FFmpegBin)
  --version <tag|latest>    GitHub release tag or "latest" (default: latest)
  --targets <t1,t2,...>     Rust target triples to fetch (default: host triple via rustc -Vv)
  --out <dir>               Output dir (default: src-tauri/binaries)
  --cache <dir>             Cache dir (default: .cache/ffmpeg)
  --bin <name>              Base sidecar name (default: ffmpeg)
  --ffprobe / --no-ffprobe  Also install ffprobe (default: on)
  --force                   Overwrite existing outputs
  --quiet                   Less logging
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }

  return args;
}

function log(args, ...msg) {
  if (!args.quiet) console.log(...msg);
}

function githubHeaders() {
  const h = {
    "User-Agent": "tauri-ffmpeg-fetch-script",
    "Accept": "application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN) {
    h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return h;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} fetching ${url}\n${text}`);
  }
  return res.json();
}

async function downloadToFile(url, filePath) {
  const res = await fetch(url, { headers: githubHeaders(), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });

  const tmp = `${filePath}.tmp-${process.pid}`;
  const nodeStream = Readable.fromWeb(res.body);
  await pipeline(nodeStream, fs.createWriteStream(tmp));
  await fsp.rename(tmp, filePath);
}

function sha256FileSync(filePath) {
  const h = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  h.update(data);
  return h.digest("hex");
}

function getHostTargetTriple() {
  const out = execSync("rustc -Vv", { stdio: ["ignore", "pipe", "inherit"] }).toString("utf8");
  const m = out.match(/^host:\s+(\S+)$/m);
  if (!m) throw new Error("Failed to determine Rust host target triple from `rustc -Vv` output");
  return m[1];
}

function mapRustTripleToOsArch(triple) {
  // OS mapping (provider-specific strings)
  let osName;
  if (triple.includes("windows")) osName = "windows";
  // Correction: Tyrrrz/FFmpegBin uses 'osx' for macOS assets (e.g. ffmpeg-osx-arm64.zip)
  else if (triple.includes("apple-darwin")) osName = "osx";
  else if (triple.includes("linux")) osName = "linux";
  else throw new Error(`Unsupported OS in target triple: ${triple}`);

  // ARCH mapping
  // Rust triples: x86_64, aarch64, i686
  let archName;
  if (triple.startsWith("x86_64")) archName = "x64";
  else if (triple.startsWith("aarch64")) archName = "arm64";
  else if (triple.startsWith("i686")) archName = "x86";
  else throw new Error(`Unsupported arch in target triple: ${triple}`);

  return { osName, archName };
}

async function resolveRelease(repo, version) {
  if (version === "latest") {
    return fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
  }

  // Try exact tag
  try {
    return await fetchJson(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(version)}`);
  } catch {
    // Try v-prefixed tag
    return await fetchJson(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent("v" + version)}`);
  }
}

function findAsset(release, assetName) {
  const assets = release.assets || [];
  return assets.find(a => a.name === assetName) || null;
}

async function unzip(zipPath, destDir) {
  await fsp.rm(destDir, { recursive: true, force: true });
  await fsp.mkdir(destDir, { recursive: true });

  if (extractZip) {
    await extractZip(zipPath, { dir: destDir });
    return;
  }

  // Fallback to system tools if extract-zip isn't installed
  if (process.platform === "win32") {
    // PowerShell Expand-Archive
    const ps = `powershell -NoProfile -Command "Expand-Archive -Force '${zipPath.replace(/'/g, "''")}' '${destDir.replace(/'/g, "''")}'"`;
    execSync(ps, { stdio: "inherit" });
  } else {
    // `unzip` must be available
    execSync(`unzip -o '${zipPath.replace(/'/g, "'\\''")}' -d '${destDir.replace(/'/g, "'\\''")}'`, { stdio: "inherit" });
  }
}

async function findFileRecursive(rootDir, fileName) {
  const entries = await fsp.readdir(rootDir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(rootDir, ent.name);
    if (ent.isFile() && ent.name === fileName) return full;
    if (ent.isDirectory()) {
      const hit = await findFileRecursive(full, fileName);
      if (hit) return hit;
    }
  }
  return null;
}

async function installBinary(srcPath, destPath, force) {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });

  if (!force && fs.existsSync(destPath)) {
    return { skipped: true };
  }

  await fsp.copyFile(srcPath, destPath);

  if (process.platform !== "win32") {
    await fsp.chmod(destPath, 0o755);
  }

  return { skipped: false };
}

async function main() {
  const args = parseArgs(process.argv);

  const targets = args.targets?.length ? args.targets : [getHostTargetTriple()];

  // If universal target is requested, ensure we have the components
  if (targets.includes("universal-apple-darwin")) {
    if (!targets.includes("x86_64-apple-darwin")) targets.push("x86_64-apple-darwin");
    if (!targets.includes("aarch64-apple-darwin")) targets.push("aarch64-apple-darwin");
  }

  log(args, `Targets: ${targets.join(", ")}`);

  log(args, `Targets: ${targets.join(", ")}`);

  // Optimization: Check if all expected outputs already exist
  let allExist = true;
  for (const triple of targets) {
    const isWin = triple.includes("windows");
    const exe = isWin ? ".exe" : "";
    const basePaths = [path.join(args.out, `${args.binBaseName}-${triple}${exe}`)];
    if (args.withFfprobe) {
      basePaths.push(path.join(args.out, `ffprobe-${triple}${exe}`));
    }

    // specific check for universal
    if (triple === "universal-apple-darwin") {
      // universal is built at the end, checks are handled there.
      // but for "allExist" logic, we should check if the RESULT exists
      // The loop below handles 'universal-apple-darwin' as a standard target string
      // constructing `ffmpeg-universal-apple-darwin`, which is exactly what we output.
    }

    for (const p of basePaths) {
      if (!fs.existsSync(p)) {
        allExist = false;
        break;
      }
    }
  }

  if (allExist && !args.force) {
    log(args, "All targets already exist in output directory. Skipping fetch.");
    return;
  }

  const release = await resolveRelease(args.repo, args.version);
  const tag = release.tag_name;
  if (!tag) throw new Error(`Could not resolve release tag_name for repo=${args.repo}, version=${args.version}`);
  log(args, `Resolved release: ${args.repo}@${tag}`);

  for (const triple of targets) {
    if (triple === "universal-apple-darwin") {
      if (process.platform !== "darwin") {
        log(args, "WARN: universal-apple-darwin build requires macOS to run `lipo`. Skipping universal binary creation.");
        continue;
      }

      // We need both x86_64-apple-darwin and aarch64-apple-darwin
      const subTargets = ["x86_64-apple-darwin", "aarch64-apple-darwin"];

      // Ensure sub-targets are fetched/installed
      for (const sub of subTargets) {
        if (!targets.includes(sub)) {
          // If not already in the list, we need to process it. 
          // We can just recurse lightly or duplicate logic. 
          // Simpler here: just run the install logic for this sub-target now.
          // However, avoiding infinite recursion if we were to push to `targets`.
          // Let's just assume the user typically requests all targets or we force fetch them.
          // BETTER APPROACH: Add them to a "to-process" list if we can, but we are inside the looop.
          // Let's just execute the fetch logic for them right here.

          // Actually, since this script is usually called with a list of targets, we can just ensure
          // we have the paths to the inputs.
        }
      }

      // Construct paths for inputs
      const exe = ""; // macOS has no extension
      const inputX64 = path.join(args.out, `${args.binBaseName}-x86_64-apple-darwin${exe}`);
      const inputArm64 = path.join(args.out, `${args.binBaseName}-aarch64-apple-darwin${exe}`);
      const outputUniversal = path.join(args.out, `${args.binBaseName}-universal-apple-darwin${exe}`);

      // Check if inputs exist. If not, we must fetch them. 
      // Since we are iterating `targets`, we can't easily jump back.
      // BUT, we can just rely on the fact that we'll process them if they are in the list.
      // If `universal-apple-darwin` is passed, we should implicitly ensure x64/arm64 are also processed.
      // Let's modify the `targets` array at the start of `main` instead.

      // WAIT. I cannot modify the loop while iterating easily. 
      // Let's just run `lipo` at the end or change how we iterate.
      // Re-writing this block isn't enough. I need to change the target list preparation.
      continue;
    }

    const { osName, archName } = mapRustTripleToOsArch(triple);

    // Default FFmpegBin naming per README:
    const assetName = `ffmpeg-${osName}-${archName}.zip`;

    const asset = findAsset(release, assetName);
    if (!asset) {
      const available = (release.assets || []).map(a => a.name).sort();
      throw new Error(
        `Asset not found: ${assetName}\n` +
        `Repo release: ${args.repo}@${tag}\n` +
        `Available assets:\n- ${available.join("\n- ")}\n`
      );
    }

    const cacheZip = path.join(args.cache, args.repo.replace("/", "__"), tag, assetName);
    if (!fs.existsSync(cacheZip)) {
      log(args, `Downloading ${assetName}...`);
      await downloadToFile(asset.browser_download_url, cacheZip);
    } else {
      log(args, `Using cached ${assetName}`);
    }

    const zipHash = sha256FileSync(cacheZip);
    log(args, `SHA256(${assetName})=${zipHash}`);

    const extractDir = path.join(args.cache, "_extract", args.repo.replace("/", "__"), tag, `${osName}-${archName}`);
    await unzip(cacheZip, extractDir);

    const exe = osName === "windows" ? ".exe" : "";

    // We scan the archive to find the actual files, regardless of internal folder layout
    const ffmpegNameInside = `ffmpeg${exe}`;
    const ffprobeNameInside = `ffprobe${exe}`;

    const ffmpegPath = await findFileRecursive(extractDir, ffmpegNameInside);
    if (!ffmpegPath) throw new Error(`Could not find ${ffmpegNameInside} inside extracted archive ${assetName}`);

    const outFfmpeg = path.join(args.out, `${args.binBaseName}-${triple}${exe}`);
    const r1 = await installBinary(ffmpegPath, outFfmpeg, args.force);
    log(args, `${r1.skipped ? "SKIP" : "OK  "} ${outFfmpeg}`);

    if (args.withFfprobe) {
      const ffprobePath = await findFileRecursive(extractDir, ffprobeNameInside);
      if (!ffprobePath) {
        log(args, `WARN: ${ffprobeNameInside} not found in ${assetName}; skipping ffprobe for ${triple}`);
      } else {
        const outFfprobe = path.join(args.out, `ffprobe-${triple}${exe}`);
        const r2 = await installBinary(ffprobePath, outFfprobe, args.force);
        log(args, `${r2.skipped ? "SKIP" : "OK  "} ${outFfprobe}`);
      }
    }
  }

  // Post-processing for universal binaries
  if (targets.includes("universal-apple-darwin") && process.platform === "darwin") {
    log(args, "Creating universal binaries...");
    const exes = [args.binBaseName, args.withFfprobe ? "ffprobe" : null].filter(Boolean);

    for (const rawName of exes) {
      const inputX64 = path.join(args.out, `${rawName}-x86_64-apple-darwin`);
      const inputArm64 = path.join(args.out, `${rawName}-aarch64-apple-darwin`);
      const outputUniversal = path.join(args.out, `${rawName}-universal-apple-darwin`);

      if (fs.existsSync(inputX64) && fs.existsSync(inputArm64)) {
        try {
          execSync(`lipo -create -output "${outputUniversal}" "${inputX64}" "${inputArm64}"`);
          log(args, `OK   ${outputUniversal}`);
        } catch (e) {
          log(args, `ERROR creating universal binary for ${rawName}: ${e.message}`);
          // Don't fail the whole script, maybe? Or should we?
          // If we can't create it, the build will fail later anyway.
          throw e;
        }
      } else {
        log(args, `WARN: Missing inputs for universal binary ${rawName}. Needed: \n  ${inputX64}\n  ${inputArm64}`);
      }
    }
  }

  log(args, "\nDone.");
}

main().catch(err => {
  console.error(err.stack || String(err));
  process.exit(1);
});
