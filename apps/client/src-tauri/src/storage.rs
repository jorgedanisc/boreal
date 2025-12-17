use crate::vault::VaultConfig;
use anyhow::{Context, Result};
use aws_config::meta::region::RegionProviderChain;
use aws_config::BehaviorVersion;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart};
use aws_sdk_s3::{config::Region, Client};
use std::sync::Arc;
use tokio::sync::mpsc;

/// Minimum size for multipart upload (5MB)
pub const MULTIPART_THRESHOLD: usize = 5 * 1024 * 1024;
/// Part size for multipart upload (5MB)
pub const MULTIPART_PART_SIZE: usize = 5 * 1024 * 1024;

/// Progress callback for upload tracking
pub type ProgressCallback = Arc<dyn Fn(u64, u64) + Send + Sync>;

#[derive(Clone)]
pub struct Storage {
    client: Client,
    bucket: String,
}

impl Storage {
    pub async fn new(config: &VaultConfig) -> Self {
        let region_provider = RegionProviderChain::first_try(Region::new(config.region.clone()));
        let shared_config = aws_config::defaults(BehaviorVersion::latest())
            .region(region_provider)
            .load()
            .await;

        // We need to use static credentials from the vault config
        let credentials = aws_sdk_s3::config::Credentials::new(
            &config.access_key_id,
            &config.secret_access_key,
            None,
            None,
            "boreal-vault",
        );

        let s3_config = aws_sdk_s3::config::Builder::from(&shared_config)
            .credentials_provider(credentials)
            .build();

        let client = Client::from_conf(s3_config);

        Self {
            client,
            bucket: config.bucket.clone(),
        }
    }

    pub async fn upload_file(&self, key: &str, body: Vec<u8>) -> Result<()> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .body(ByteStream::from(body))
            .send()
            .await
            .context("Failed to upload file")?;
        Ok(())
    }

    /// Upload a file with the 'fresh' tag for lifecycle rule targeting
    pub async fn upload_file_with_tag(
        &self,
        key: &str,
        body: Vec<u8>,
        fresh_upload: bool,
    ) -> Result<()> {
        let tag_value = if fresh_upload { "true" } else { "false" };
        let tagging = format!("fresh={}", tag_value);
        
        // Use multipart upload for large files
        if body.len() > MULTIPART_THRESHOLD {
            self.upload_multipart_with_tag(key, body, &tagging, None).await
        } else {
            self.client
                .put_object()
                .bucket(&self.bucket)
                .key(key)
                .body(ByteStream::from(body))
                .tagging(&tagging)
                .send()
                .await
                .context("Failed to upload file")?;
            Ok(())
        }
    }

    /// Upload a file with progress callback (for UI progress tracking)
    pub async fn upload_file_with_progress(
        &self,
        key: &str,
        body: Vec<u8>,
        fresh_upload: bool,
        progress_tx: Option<mpsc::Sender<(u64, u64)>>,
    ) -> Result<()> {
        let tag_value = if fresh_upload { "true" } else { "false" };
        let tagging = format!("fresh={}", tag_value);
        let total_size = body.len() as u64;

        if body.len() > MULTIPART_THRESHOLD {
            self.upload_multipart_with_tag(key, body, &tagging, progress_tx).await
        } else {
            // For small files, just report complete after upload
            self.client
                .put_object()
                .bucket(&self.bucket)
                .key(key)
                .body(ByteStream::from(body))
                .tagging(&tagging)
                .send()
                .await
                .context("Failed to upload file")?;
            
            if let Some(tx) = progress_tx {
                tx.send((total_size, total_size)).await.ok();
            }
            Ok(())
        }
    }

    /// Multipart upload for large files with progress tracking
    async fn upload_multipart_with_tag(
        &self,
        key: &str,
        body: Vec<u8>,
        tagging: &str,
        progress_tx: Option<mpsc::Sender<(u64, u64)>>,
    ) -> Result<()> {
        let total_size = body.len() as u64;
        
        // Start multipart upload
        let create_response = self
            .client
            .create_multipart_upload()
            .bucket(&self.bucket)
            .key(key)
            .tagging(tagging)
            .send()
            .await
            .context("Failed to initiate multipart upload")?;

        let upload_id = create_response
            .upload_id()
            .ok_or_else(|| anyhow::anyhow!("No upload ID returned"))?;

        let mut completed_parts = Vec::new();
        let mut uploaded_bytes: u64 = 0;

        // Upload parts
        for (i, chunk) in body.chunks(MULTIPART_PART_SIZE).enumerate() {
            let part_number = (i + 1) as i32;

            let upload_result = self
                .client
                .upload_part()
                .bucket(&self.bucket)
                .key(key)
                .upload_id(upload_id)
                .part_number(part_number)
                .body(ByteStream::from(chunk.to_vec()))
                .send()
                .await;

            match upload_result {
                Ok(response) => {
                    completed_parts.push(
                        CompletedPart::builder()
                            .e_tag(response.e_tag().unwrap_or_default())
                            .part_number(part_number)
                            .build(),
                    );
                    
                    uploaded_bytes += chunk.len() as u64;
                    if let Some(ref tx) = progress_tx {
                        tx.send((uploaded_bytes, total_size)).await.ok();
                    }
                }
                Err(e) => {
                    // Abort the multipart upload on failure
                    self.abort_multipart_upload(key, upload_id).await.ok();
                    return Err(e.into());
                }
            }
        }

        // Complete multipart upload
        let completed_upload = CompletedMultipartUpload::builder()
            .set_parts(Some(completed_parts))
            .build();

        self.client
            .complete_multipart_upload()
            .bucket(&self.bucket)
            .key(key)
            .upload_id(upload_id)
            .multipart_upload(completed_upload)
            .send()
            .await
            .context("Failed to complete multipart upload")?;

        Ok(())
    }

    /// Abort a multipart upload (for cleanup on failure)
    pub async fn abort_multipart_upload(&self, key: &str, upload_id: &str) -> Result<()> {
        self.client
            .abort_multipart_upload()
            .bucket(&self.bucket)
            .key(key)
            .upload_id(upload_id)
            .send()
            .await
            .context("Failed to abort multipart upload")?;
        Ok(())
    }

    pub async fn download_file(&self, key: &str) -> Result<Vec<u8>> {
        let output = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .context("Failed to download file")?;

        let data = output
            .body
            .collect()
            .await
            .context("Failed to read body")?
            .into_bytes();
        Ok(data.to_vec())
    }

    pub async fn delete_file(&self, key: &str) -> Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .context("Failed to delete file")?;
        Ok(())
    }
}

