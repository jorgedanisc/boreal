# Encryption

Boreal uses client-side encryption. Your data is encrypted on your device before upload. AWS never sees plaintext.

---

## Key Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│  VAULT FILE (stored on your device, never uploaded)        │
│  Contains: AWS credentials + KEK                           │
└────────────────────────────┬────────────────────────────────┘
                             │
                             │ KEK decrypts
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  VAULT KEY (stored encrypted in S3 as vault-key.enc)       │
│  Random 256-bit key, generated once                        │
└────────────────────────────┬────────────────────────────────┘
                             │
                             │ Vault key encrypts
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  YOUR DATA                                                  │
│  Originals, thumbnails, manifest                            │
└─────────────────────────────────────────────────────────────┘
```

**KEK** (Key Encryption Key): A random 256-bit key stored in your vault file. Protects the vault key.

**Vault Key**: A random 256-bit key stored encrypted in S3. Actually encrypts your files.

---

## Why Two Keys?

When you revoke someone's access, you need to re-encrypt. With a single key, that means downloading and re-encrypting terabytes of data.

With two keys:
1. Generate new KEK
2. Download vault-key.enc (tiny, ~100 bytes)
3. Decrypt with old KEK, re-encrypt with new KEK
4. Upload new vault-key.enc
5. Rotate AWS credentials

Done. The old vault file no longer works. Your terabytes of photos stay untouched.

---

## What's in the Vault File

```json
{
  "version": 1,
  "vault_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Family Photos",
  "bucket": "boreal-vault-a1b2c3",
  "region": "eu-west-1",
  "credentials": {
    "access_key_id": "AKIAIOSFODNN7EXAMPLE",
    "secret_access_key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
  },
  "kek": "base64-encoded-32-random-bytes"
}
```

This file never leaves your device. Never upload it anywhere. Treat it like a physical key.

---

## S3 Structure

```
boreal-vault-{id}/
├── vault-key.enc           # Vault key encrypted with KEK
├── originals/
│   └── {uuid}.enc          # Encrypted original files
├── thumbnails/
│   └── {uuid}.enc          # Encrypted thumbnails
└── manifest.db.enc         # Encrypted SQLite database
```

If someone gains access to your S3 bucket without your vault file, they see only encrypted blobs. Useless without the KEK.

---

## Creating a Vault

```
1. Generate random vault_key (32 bytes)
2. Generate random KEK (32 bytes)
3. Provision AWS infrastructure (bucket, IAM user)
4. Encrypt vault_key with KEK → vault-key.enc
5. Upload vault-key.enc to S3
6. Build vault file (credentials + KEK)
7. Save vault file locally
```

---

## Opening a Vault

```
1. Read vault file
2. Extract AWS credentials and KEK
3. Download vault-key.enc from S3
4. Decrypt vault-key.enc with KEK → vault_key
5. Download and decrypt manifest
6. Ready to browse
```

---

## Uploading a File

```
1. Generate thumbnail locally (AVIF, max 50KB)
2. Extract EXIF metadata
3. Generate CLIP embedding for AI search
4. Encrypt original with vault_key
5. Encrypt thumbnail with vault_key
6. Upload both to S3
7. Update local manifest
8. Sync manifest to S3
```

All processing happens on your device. The file is encrypted before it leaves.

---

## Revoking Access

When you've shared your vault file and want to revoke access:

```
1. Generate new AWS access key via IAM
2. Delete old AWS access key
3. Generate new KEK
4. Download vault-key.enc
5. Decrypt with old KEK, re-encrypt with new KEK
6. Upload new vault-key.enc
7. Build new vault file with new credentials + new KEK
8. Save new vault file
```

The person with the old vault file can no longer:
- Authenticate to AWS (old credentials revoked)
- Decrypt vault-key.enc even if they had a cached copy (wrong KEK)

---

## Local Storage

For convenience, the app can store vault files in your OS keychain:

- **macOS**: Keychain
- **Windows**: Credential Manager  
- **Linux**: libsecret / GNOME Keyring
- **iOS/Android**: Secure Enclave / Keystore

This way you don't need to import the vault file every session. The OS protects it with your login or biometrics.

---

## What If I Lose the Vault File?

Your data is unrecoverable. This is by design.

Mitigations:
- Save copies in multiple secure locations
- Store in a password manager
- Print as QR code and keep in a safe
- Back up to multiple devices

There is no "forgot password" flow. The vault file is the only key.

---

## Algorithms

- **Encryption**: XChaCha20-Poly1305 (via libsodium or age)
- **Key derivation**: Not needed (KEK is random, not password-derived)
- **Thumbnail format**: AVIF (max 50KB, 1280px longest edge)
- **Embeddings**: CLIP ViT-B/32 via ONNX (512-dim vectors)

---

## Threat Model

| Threat | Protected |
|--------|-----------|
| AWS employee accessing your bucket | ✅ Encrypted |
| S3 bucket breach | ✅ Encrypted |
| Someone finds only your AWS credentials | ✅ Need KEK to decrypt |
| Someone finds your vault file | ❌ Full access |
| You lose your vault file | ❌ Unrecoverable |

The vault file is the single point of trust. Protect it accordingly.