# Boreal

> Cold private storage, vivid memories.

*Most of the time, your memories rest quietly in the "boreal" cold. When you open an album, they light up like auroras on a dark sky.*

Boreal is a self-hosted photo and video archival system. You bring your own AWS account. Your data is encrypted on your device before it ever leaves. No servers, no subscriptions, no third-party access.

---

## How It Works

**One file unlocks everything.**

When you create a vault, Boreal generates a **Vault File**—a small file containing your AWS credentials and encryption key. This file is the only way to access your data.

- Have the file → Full access
- Lose the file → Data is unrecoverable
- Share the file → That person has full access

There are no accounts, no passwords, no recovery emails. Your vault file is your key to your memories.

All encryption and decryption happens locally. AWS only ever sees encrypted blobs. Even if someone breaches your S3 bucket, they get nothing without your vault file.

*For technical details, see [Encryption](./concepts/Encryption.md).*

---

## Storage Tiers

Choose your tradeoff between cost and convenience.

| | **Deep Archive** | **Instant Retrieval** |
|---|---|---|
| **Best for** | Infrequently accessed originals | Frequently accessed originals |
| **Cost** | ~$1/TB/month | ~$4/TB/month |
| **Thumbnails** | Instant | Instant |
| **Originals** | 12-48 hour restore | Instant |

Thumbnails are always instantly accessible. Only original files follow the storage tier you choose.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  YOUR DEVICE                                                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Boreal App                                         │    │
│  │  - Generate thumbnails                              │    │
│  │  - Encrypt everything                               │    │
│  │  - Extract metadata                                 │    │
│  │  - Run AI search                                    │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                 │
│                           │ encrypted uploads/downloads     │
│                           ▼                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  YOUR AWS ACCOUNT                                           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  S3 Bucket                                          │    │
│  │  ├── vault-key.enc      (encrypted key)             │    │
│  │  ├── originals/         (Glacier)                   │    │
│  │  ├── thumbnails/        (Standard)                  │    │
│  │  └── manifest.db.enc    (encrypted database)        │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

Everything is processed on your device. AWS is just encrypted storage.

*For technical details, see [Architecture](./concepts/Architecture.md).*

---

## Features

**Offline-First**
Browse your entire library without internet. Thumbnails and metadata sync locally.

**Advanced Search**
Natural language search ("dog on beach", "birthday party") runs entirely on your device using local embeddings.

**Memories**
Group photos into journal-like entries with notes, locations, and audio recordings.

**Multi-Device**
Import your vault file on any device. Changes sync through S3.

**Geomap**
Browse photos by location on an interactive map.

---

## Sharing

Boreal uses an all-or-nothing sharing model.

To share a vault, you give someone your vault file. They get complete access—view, upload, delete. To revoke access, you rotate your credentials from within the app. Their vault file stops working.

If you want to share only specific photos, create a separate vault with just those files.

---

## Getting Started

### Create Your First Vault

1. Click **Create Vault** in the app
2. Choose the closest region to you and storage tier
3. Click **Open AWS Console** — your browser opens to AWS CloudFormation
4. Log into your AWS account (or create one- if you do, make sure to enable MFA and a payment method)
5. Review the stack and click **Create Stack**
6. Wait ~30 seconds for setup to complete
7. Copy the **Vault Code** from the Outputs tab
8. Paste it into the app

That's it. Your vault is ready.

The Vault Code contains your credentials and encryption key. Save it somewhere safe or across multiple devices — it's the only way to access your vault from other devices.

### Add Another Device

Export your vault file from the first device (Settings → Export Vault) and import it on the new device.

### Create Additional Vaults

Just repeat the setup flow. Each vault is completely independent with its own credentials and encryption key.
---

## Cost Example

For 1TB of photos (~200,000 files):

| Component | Deep Archive | Instant Retrieval |
|-----------|--------------|-------------------|
| Originals | $0.99 | $4.00 |
| Thumbnails (6GB) | $0.14 | $0.14 |
| Manifest | <$0.01 | <$0.01 |
| Requests | ~$0.05 | ~$0.05 |
| **Total** | **~$1.20/mo** | **~$4.20/mo** |

---

## License

[MIT](./LICENSE)