#!/usr/bin/env node

/**
 * Fetch Nomic embedding models from HuggingFace
 * Downloads ONNX models for semantic image search
 */

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(__dirname, '..', 'src-tauri', 'models');

const MODELS = [
  {
    name: 'Vision ONNX Model',
    url: 'https://huggingface.co/nomic-ai/nomic-embed-vision-v1.5/resolve/main/onnx/model.onnx',
    path: 'nomic-embed-vision-v1.5/model.onnx',
    sizeHint: '~100MB',
  },
  {
    name: 'Text ONNX Model',
    url: 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5/resolve/main/onnx/model.onnx',
    path: 'nomic-embed-text-v1.5/model.onnx',
    sizeHint: '~100MB',
  },
  {
    name: 'Tokenizer',
    url: 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5/resolve/main/tokenizer.json',
    path: 'nomic-embed-text-v1.5/tokenizer.json',
    sizeHint: '~700KB',
  },
];

async function downloadFile(url, destPath) {
  const dir = dirname(destPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Boreal/1.0' },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const fileStream = createWriteStream(destPath);
  await pipeline(response.body, fileStream);
}

async function main() {
  console.log('🔍 Fetching Nomic embedding models for semantic search...\n');

  for (const model of MODELS) {
    const destPath = join(MODELS_DIR, model.path);

    if (existsSync(destPath)) {
      console.log(`✅ ${model.name} already exists, skipping`);
      continue;
    }

    console.log(`📥 Downloading ${model.name} (${model.sizeHint})...`);
    console.log(`   URL: ${model.url}`);
    console.log(`   Dest: ${destPath}`);

    try {
      await downloadFile(model.url, destPath);
      console.log(`   ✅ Done\n`);
    } catch (error) {
      console.error(`   ❌ Failed: ${error.message}\n`);
      process.exit(1);
    }
  }

  console.log('✨ All models downloaded successfully!');
  console.log(`   Location: ${MODELS_DIR}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
