On uploading always order the upload items by biggest file size first


## Roadmap

### Phase 1: Core Foundation & Automation
- [ ] Tauri application skeleton
- [ ] **Infrastructure Automation**: Rust module to deploy CloudFormation stacks
- [ ] File upload to S3 (Originals to Deep Archive/Instant Retrieval)
- [ ] Local SQLite database & Thumbnail caching

### Phase 2: The "Physical Album" System
- [ ] **Credential Vending Machine**: Backend logic to generate/revoke scoped IAM users on the fly
- [ ] **S3 Batch Operations**: Efficiently copying thumbnails from Library to Album folders
- [ ] **Share UI**: Generate "Digital Key" files/QR codes for sharing
- [ ] **Recipient Flow**: UI for importing external Album Keys

### Phase 3: AI & Intelligence
- [ ] **Model Integration**: Integrate ONNX Runtime with Rust backend
- [ ] **Vector Database**: Implement `sqlite-vec` for embedding storage
- [ ] **Indexing Pipeline**: Background process to generate embeddings for existing library
- [ ] **Search UI**: Natural language query interface

### Phase 4: Polish & Advanced
- [ ] **Storage Class Migration**: UI to move folders between Deep Archive and Instant Retrieval
- [ ] **Cost Estimator**: Real-time calculator based on storage usage
- [ ] **Video Support**: Intelligent video thumbnailing via Lambda
- [ ] **Glacier Restore UI**: Status tracking for Deep Archive restorations