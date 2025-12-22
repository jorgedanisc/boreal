use crate::vault::VaultConfig;
use anyhow::{Context, Result};
use async_stream::stream;

use aws_config::BehaviorVersion;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart};
use aws_sdk_s3::{config::Region, Client};
use aws_smithy_types::body::SdkBody;
use bytes::Bytes;
use futures::stream::Stream;
use http_body::Body;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context as TaskContext, Poll};
use tokio::sync::mpsc;

/// Minimum size for multipart upload (5MB)
pub const MULTIPART_THRESHOLD: usize = 5 * 1024 * 1024;
/// Part size for multipart upload (5MB)
#[allow(dead_code)]
pub const MULTIPART_PART_SIZE: usize = 5 * 1024 * 1024;

#[allow(dead_code)]
pub const MAX_RETRIES: u32 = 3;

/// Progress callback for upload tracking
#[allow(dead_code)]
pub type ProgressCallback = Arc<dyn Fn(u64, u64) + Send + Sync>;

#[derive(Clone)]
pub struct Storage {
    client: Client,
    cw_client: aws_sdk_cloudwatch::Client,
    bucket: String,
}

impl Storage {
    pub async fn new(config: &VaultConfig) -> Self {
        // Use explicit credentials directly - DO NOT use aws_config::defaults().load()
        // The default credential chain tries to detect credentials from ENV/IMDS/etc
        // which hangs on mobile platforms (no IMDS endpoint, timeouts, etc.)
        let credentials = aws_sdk_s3::config::Credentials::new(
            &config.access_key_id,
            &config.secret_access_key,
            None,
            None,
            "boreal-vault",
        );

        let region = Region::new(config.region.clone());

        // Build HTTPS connector with WebPKI bundled root certificates
        // This is REQUIRED for iOS/Android where native root certs aren't accessible to rustls
        // The "webpki-tokio" feature in hyper-rustls uses bundled Mozilla CA certs
        let https_connector = hyper_rustls::HttpsConnectorBuilder::new()
            .with_webpki_roots()
            .https_or_http()
            .enable_http1()
            .enable_http2()
            .build();

        // Wrap connector for AWS SDK using the hyper_014 adapter
        // Note: HyperClientBuilder::build expects the connector, not a full Client
        let http_client_s3 = aws_smithy_runtime::client::http::hyper_014::HyperClientBuilder::new()
            .build(https_connector.clone());
        
        // Build S3 config with our custom HTTP client
        // Note: We disable stalled stream protection since we're using a custom HTTP client
        // that doesn't integrate with AWS SDK's async sleep mechanism
        let s3_config =
            aws_sdk_s3::config::Builder::new()
                .region(region.clone())
                .credentials_provider(credentials.clone())
                .behavior_version(BehaviorVersion::latest())
                .http_client(http_client_s3)
                .stalled_stream_protection(
                    aws_sdk_s3::config::StalledStreamProtectionConfig::disabled(),
                )
                .identity_cache(aws_sdk_s3::config::IdentityCache::no_cache())
                .build();

        let client = Client::from_conf(s3_config);

        // Build CloudWatch config
        let http_client_cw = aws_smithy_runtime::client::http::hyper_014::HyperClientBuilder::new()
            .build(https_connector);

        let cw_config = aws_sdk_cloudwatch::config::Builder::new()
            .region(region)
            .credentials_provider(credentials)
            .behavior_version(BehaviorVersion::latest())
            .http_client(http_client_cw)
            .stalled_stream_protection(
                aws_sdk_cloudwatch::config::StalledStreamProtectionConfig::disabled(),
            )
            .identity_cache(aws_sdk_cloudwatch::config::IdentityCache::no_cache())
            .build();
        
        let cw_client = aws_sdk_cloudwatch::Client::from_conf(cw_config);

        Self {
            client,
            cw_client,
            bucket: config.bucket.clone(),
        }
    }

    /// Fetch total bucket size in bytes from CloudWatch (Standard Storage)
    pub async fn get_bucket_size(&self) -> Result<u64, String> {
        let end_time = std::time::SystemTime::now();
        let start_time = end_time
            .checked_sub(std::time::Duration::from_secs(86400 * 2)) // Look back 48 hours to be safe
            .unwrap_or(end_time);

        let result = self
            .cw_client
            .get_metric_statistics()
            .namespace("AWS/S3")
            .metric_name("BucketSizeBytes")
            .dimensions(
                aws_sdk_cloudwatch::types::Dimension::builder()
                    .name("BucketName")
                    .value(&self.bucket)
                    .build(),
            )
            .dimensions(
                aws_sdk_cloudwatch::types::Dimension::builder()
                    .name("StorageType")
                    .value("StandardStorage")
                    .build(),
            )
            .start_time(aws_smithy_types::DateTime::from(start_time))
            .end_time(aws_smithy_types::DateTime::from(end_time))
            .period(86400)
            .statistics(aws_sdk_cloudwatch::types::Statistic::Average)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch metrics: {}", e))?;

        // Get the latest datapoint
        if let Some(datapoints) = result.datapoints {
            if let Some(latest) = datapoints
                .iter()
                .max_by_key(|d| d.timestamp.as_ref().map(|t| t.secs()).unwrap_or(0))
            {
                return Ok(latest.average.unwrap_or(0.0) as u64);
            }
        }

        Ok(0) // No data yet or error
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
    #[allow(dead_code)]
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
            self.upload_multipart_with_tag(key, body, &tagging, None)
                .await
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

    pub async fn upload_file_with_progress(
        &self,
        key: &str,
        body: Vec<u8>,
        fresh_upload: bool,
        progress_tx: Option<mpsc::Sender<(u64, u64)>>,
    ) -> Result<()> {
        let tag_value = if fresh_upload { "true" } else { "false" };
        let tagging = format!("fresh={}", tag_value);

        // Use multipart upload ONLY for large files (> 5MB)
        // Small files use standard put_object for better stability and fewer permission requirements
        if body.len() > MULTIPART_THRESHOLD {
            self.upload_multipart_with_tag(key, body, &tagging, progress_tx).await
        } else {
            let total_size = body.len() as u64;
            
            // Emit start progress
            if let Some(ref tx) = progress_tx {
                tx.send((0, total_size)).await.ok();
            }

            let result = self.client
                .put_object()
                .bucket(&self.bucket)
                .key(key)
                .body(ByteStream::from(body))
                .tagging(&tagging)
                .send()
                .await;

            // Emit completion progress on success
            if result.is_ok() {
                if let Some(ref tx) = progress_tx {
                    tx.send((total_size, total_size)).await.ok();
                }
            }

            result.map(|_| ()).context("Failed to upload file")
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
        let mut uploaded_bytes_so_far: u64 = 0;

        // Upload parts
        for (i, chunk) in body.chunks(MULTIPART_PART_SIZE).enumerate() {
            let part_number = (i + 1) as i32;
            let chunk_vec = chunk.to_vec();
            let chunk_len = chunk_vec.len() as u64;

            // Create a streaming body if progress tracking is enabled
            let stream = if let Some(tx) = progress_tx.clone() {
                let start_offset = uploaded_bytes_so_far;

                let tx = tx.clone();
                let total = total_size;

                // Create a stream that emits small chunks and updates progress
                let s = stream! {
                    let mut local_offset = 0;
                    // Yield 16KB chunks to allow frequent progress updates
                    // Note: This is purely for local progress emission; the S3 client will buffer this into the part upload request
                    for slice in chunk_vec.chunks(16 * 1024) {
                        let bytes = Bytes::copy_from_slice(slice);
                        let bytes_len = bytes.len();

                        yield Ok::<Bytes, std::io::Error>(bytes);

                        local_offset += bytes_len;
                        let current_global = start_offset + local_offset as u64;
                        // Fire and forget progress update
                        let _ = tx.try_send((current_global, total));
                    }
                };

                // Wrap in ProgressBody and convert to SdkBody
                let body = ProgressBody {
                    inner: Box::pin(s),
                    len: chunk_len,
                };
                ByteStream::new(SdkBody::from_body_0_4(body))
            } else {
                ByteStream::from(chunk_vec)
            };

            let upload_result = self
                .client
                .upload_part()
                .bucket(&self.bucket)
                .key(key)
                .upload_id(upload_id)
                .part_number(part_number)
                .body(stream)
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

                    uploaded_bytes_so_far += chunk.len() as u64;
                    // Ensure we send at least one update at the end of the chunk to sync up
                    if let Some(ref tx) = progress_tx {
                        tx.send((uploaded_bytes_so_far, total_size)).await.ok();
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

    /// Recursively delete all objects (including versions) in the bucket
    pub async fn empty_bucket(&self) -> Result<()> {
        loop {
            // 1. List Object Versions (always start from beginning of remaining items)
            let list_output = self
                .client
                .list_object_versions()
                .bucket(&self.bucket)
                .send()
                .await
                .context("Failed to list object versions")?;

            let mut object_identifiers = Vec::new();

            // Collect versions
            for version in list_output.versions() {
                if let (Some(key), Some(version_id)) = (version.key(), version.version_id()) {
                    object_identifiers.push(
                        aws_sdk_s3::types::ObjectIdentifier::builder()
                            .key(key)
                            .version_id(version_id)
                            .build()
                            .unwrap(), // safe unwrap
                    );
                }
            }

            // Collect delete markers
            for marker in list_output.delete_markers() {
                if let (Some(key), Some(version_id)) = (marker.key(), marker.version_id()) {
                    object_identifiers.push(
                        aws_sdk_s3::types::ObjectIdentifier::builder()
                            .key(key)
                            .version_id(version_id)
                            .build()
                            .unwrap(),
                    );
                }
            }

            // 2. Delete batch
            if !object_identifiers.is_empty() {
                // S3 DeleteObjects limit is 1000
                for chunk in object_identifiers.chunks(1000) {
                    let delete = aws_sdk_s3::types::Delete::builder()
                        .set_objects(Some(chunk.to_vec()))
                        .quiet(true)
                        .build()
                        .unwrap(); // safe

                    self.client
                        .delete_objects()
                        .bucket(&self.bucket)
                        .delete(delete)
                        .send()
                        .await
                        .context("Failed to batch delete objects")?;
                }
            }

            // 3. Break if we are done
            // If the list wasn't truncated, and we processed everything in it, we are done.
            if !list_output.is_truncated.unwrap_or(false) {
                break;
            }

            // Safety: If we didn't find any objects but S3 says truncated (rare/inconsistent?), break to avoid infinite loop
            if object_identifiers.is_empty() {
                break;
            }
        }
        Ok(())
    }

    pub async fn delete_bucket(&self) -> Result<()> {
        self.client
            .delete_bucket()
            .bucket(&self.bucket)
            .send()
            .await
            .context("Failed to delete bucket")?;
        Ok(())
    }
}

// Helper struct for progress tracking
// Helper struct for progress tracking
struct ProgressBody {
    inner: Pin<Box<dyn Stream<Item = Result<Bytes, std::io::Error>> + Send + Sync>>,
    len: u64,
}

impl Body for ProgressBody {
    type Data = Bytes;
    type Error = std::io::Error;

    fn poll_data(
        mut self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
    ) -> Poll<Option<Result<Self::Data, Self::Error>>> {
        self.inner.as_mut().poll_next(cx)
    }

    fn poll_trailers(
        self: Pin<&mut Self>,
        _cx: &mut TaskContext<'_>,
    ) -> Poll<Result<Option<http::HeaderMap>, Self::Error>> {
        Poll::Ready(Ok(None))
    }

    fn size_hint(&self) -> http_body::SizeHint {
        http_body::SizeHint::with_exact(self.len)
    }
}
