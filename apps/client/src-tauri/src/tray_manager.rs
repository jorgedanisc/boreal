//! System Tray Manager for Upload Progress
//!
//! Displays a snowflake icon in the system tray that shows upload progress.
//! The icon pulses with opacity to indicate activity and fills up based on progress.

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop {
    use std::sync::Arc;
    use tauri::{
        image::Image,
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
        AppHandle, Emitter, Manager,
    };
    use tokio::sync::RwLock;
    pub use super::UploadProgressState;

    /// Manages the system tray icon for upload progress
    pub struct TrayManager {
        /// The tray icon handle
        tray: Option<TrayIcon>,
        /// Current upload state
        state: Arc<RwLock<UploadProgressState>>,
        /// Pre-rendered icon frames for animation
        icons: Vec<Image<'static>>,
    }

    impl TrayManager {
        /// Create a new TrayManager
        pub fn new() -> Self {
            Self {
                tray: None,
                state: Arc::new(RwLock::new(UploadProgressState::default())),
                icons: Vec::new(),
            }
        }

        /// Initialize the tray icon (call during app setup)
        pub fn init(&mut self, app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
            // Generate icon frames with different opacities for animation
            self.icons = Self::generate_icon_frames();

            // Create the tray menu
            let menu = Menu::with_items(
                app,
                &[
                    &MenuItem::with_id(app, "progress", "No uploads in progress", false, None::<&str>)?,
                    &MenuItem::with_id(app, "open_panel", "Open Upload Panel", true, None::<&str>)?,
                ],
            )?;

            // Build the tray icon (initially hidden/idle)
            let tray = TrayIconBuilder::new()
                .icon(self.icons[0].clone())
                .tooltip("Boreal")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        // Left click - show menu or open panel
                        let app = tray.app_handle();
                        // Emit event to frontend to open upload panel
                        let _ = app.emit("tray:open_upload_panel", ());
                    }
                })
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "open_panel" => {
                            // Emit event to frontend to open upload panel
                            let _ = app.emit("tray:open_upload_panel", ());
                            // Also focus the main window
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            self.tray = Some(tray);

            // Initially hide the tray icon (only show when uploading)
            self.set_visible(false)?;

            log::info!("[Tray] System tray initialized");
            Ok(())
        }

        /// Generate icon frames with different opacities for pulsing animation
        fn generate_icon_frames() -> Vec<Image<'static>> {
            // Snowflake icon rendered at different opacity levels
            // For macOS menu bar, icons should be around 22x22
            const SIZE: u32 = 22;
            
            // Generate frames at different opacities: 100%, 70%, 40%, 70% (pulse cycle)
            let opacities = [255u8, 180, 100, 180];
            
            opacities
                .iter()
                .map(|&opacity| Self::render_snowflake_icon(SIZE, opacity))
                .collect()
        }

        /// Render the snowflake icon as RGBA bytes at given size and opacity
        fn render_snowflake_icon(size: u32, opacity: u8) -> Image<'static> {
            // Simple procedural snowflake rendering
            // We'll draw a basic snowflake pattern
            let mut pixels = vec![0u8; (size * size * 4) as usize];
            
            let center = size as f32 / 2.0;
            let stroke_color = [255u8, 255, 255, opacity]; // White with variable opacity
            
            // Draw 6 lines radiating from center (snowflake arms)
            for i in 0..6 {
                let angle = (i as f32) * std::f32::consts::PI / 3.0;
                Self::draw_line(&mut pixels, size, center, center, 
                    center + (center - 2.0) * angle.cos(), 
                    center + (center - 2.0) * angle.sin(), 
                    &stroke_color);
                
                // Draw small branches on each arm
                let branch_start = 0.5;
                let branch_len = 0.3;
                for &branch_offset in &[-0.4, 0.4] {
                    let bx = center + (center - 2.0) * branch_start * angle.cos();
                    let by = center + (center - 2.0) * branch_start * angle.sin();
                    let branch_angle = angle + branch_offset;
                    Self::draw_line(&mut pixels, size, bx, by,
                        bx + (center - 2.0) * branch_len * branch_angle.cos(),
                        by + (center - 2.0) * branch_len * branch_angle.sin(),
                        &stroke_color);
                }
            }
            
            Image::new_owned(pixels, size, size)
        }

        /// Draw a line on the pixel buffer using Bresenham's algorithm
        fn draw_line(pixels: &mut [u8], size: u32, x0: f32, y0: f32, x1: f32, y1: f32, color: &[u8; 4]) {
            let dx = (x1 - x0).abs();
            let dy = (y1 - y0).abs();
            let sx = if x0 < x1 { 1.0 } else { -1.0 };
            let sy = if y0 < y1 { 1.0 } else { -1.0 };
            let mut err = dx - dy;
            let mut x = x0;
            let mut y = y0;

            loop {
                let px = x as u32;
                let py = y as u32;
                if px < size && py < size {
                    let idx = ((py * size + px) * 4) as usize;
                    // Alpha blend
                    let alpha = color[3] as f32 / 255.0;
                    for i in 0..3 {
                        pixels[idx + i] = ((1.0 - alpha) * pixels[idx + i] as f32 + alpha * color[i] as f32) as u8;
                    }
                    pixels[idx + 3] = color[3].max(pixels[idx + 3]);
                }

                if (x - x1).abs() < 1.0 && (y - y1).abs() < 1.0 {
                    break;
                }

                let e2 = 2.0 * err;
                if e2 > -dy {
                    err -= dy;
                    x += sx;
                }
                if e2 < dx {
                    err += dx;
                    y += sy;
                }
            }
        }

        /// Set tray visibility
        pub fn set_visible(&self, visible: bool) -> Result<(), Box<dyn std::error::Error>> {
            if let Some(tray) = &self.tray {
                tray.set_visible(visible)?;
            }
            Ok(())
        }

        /// Update the upload progress state
        /// 
        /// `is_processing`: Whether uploads are actively happening
        /// `has_completed_items`: Whether there are any finished uploads waiting (if not processing)
        pub async fn update_state(
            &self,
            is_processing: bool,
            has_completed_items: bool,
            progress: f64,
            completed: usize,
            total: usize,
        ) -> Result<(), Box<dyn std::error::Error>> {
            // Update state
            {
                let mut state = self.state.write().await;
                state.is_processing = is_processing;
                state.has_completed_items = has_completed_items;
                state.progress = progress;
                state.completed = completed;
                state.total = total;
            }

            // Determine visibility: Show if processing OR (not processing AND has completed items)
            let should_show = is_processing || has_completed_items;
            self.set_visible(should_show)?;

            if is_processing {
                // Active Upload: Show progress fill icon
                self.update_icon(progress).await?;
                // Tooltip: "Uploading: X%"
                if let Some(tray) = &self.tray {
                     let tooltip = format!("Uploading: {:.0}% ({}/{})", progress * 100.0, completed, total);
                     tray.set_tooltip(Some(&tooltip))?;
                }
                log::info!("[Tray] Upload progress: {:.0}% ({}/{})", progress * 100.0, completed, total);
            } else if has_completed_items {
                // Completed State: Show full/solid icon (100% progress)
                self.update_icon(1.0).await?;
                // Tooltip: "Uploads Completed"
                if let Some(tray) = &self.tray {
                    tray.set_tooltip(Some("Uploads Completed"))?;
                }
                log::info!("[Tray] Uploads completed, keeping tray visible");
            } else {
                // Idle / Hidden
                log::info!("[Tray] Idle, hiding tray");
            }

            Ok(())
        }

        /// Update the tray icon based on progress (fills up as progress increases)
        async fn update_icon(&self, progress: f64) -> Result<(), Box<dyn std::error::Error>> {
            if let Some(tray) = &self.tray {
                // Generate a progress-aware icon
                let icon = Self::render_progress_icon(22, progress);
                tray.set_icon(Some(icon))?;
            }
            Ok(())
        }

        /// Render snowflake icon with progress fill (bottom to top)
        fn render_progress_icon(size: u32, progress: f64) -> Image<'static> {
            let mut pixels = vec![0u8; (size * size * 4) as usize];
            
            let center = size as f32 / 2.0;
            let progress_line = ((1.0 - progress) * size as f64) as u32; // Y position where fill starts
            
            // Draw 6 lines radiating from center (snowflake arms)
            for i in 0..6 {
                let angle = (i as f32) * std::f32::consts::PI / 3.0;
                
                // Main arm
                Self::draw_progress_line(&mut pixels, size, progress_line,
                    center, center, 
                    center + (center - 2.0) * angle.cos(), 
                    center + (center - 2.0) * angle.sin());
                
                // Draw small branches on each arm
                let branch_start = 0.5;
                let branch_len = 0.3;
                for &branch_offset in &[-0.4, 0.4] {
                    let bx = center + (center - 2.0) * branch_start * angle.cos();
                    let by = center + (center - 2.0) * branch_start * angle.sin();
                    let branch_angle = angle + branch_offset;
                    Self::draw_progress_line(&mut pixels, size, progress_line,
                        bx, by,
                        bx + (center - 2.0) * branch_len * branch_angle.cos(),
                        by + (center - 2.0) * branch_len * branch_angle.sin());
                }
            }
            
            Image::new_owned(pixels, size, size)
        }

        /// Draw a line with progress-based coloring (filled below progress line, dimmed above)
        fn draw_progress_line(pixels: &mut [u8], size: u32, progress_y: u32, x0: f32, y0: f32, x1: f32, y1: f32) {
            let dx = (x1 - x0).abs();
            let dy = (y1 - y0).abs();
            let sx = if x0 < x1 { 1.0 } else { -1.0 };
            let sy = if y0 < y1 { 1.0 } else { -1.0 };
            let mut err = dx - dy;
            let mut x = x0;
            let mut y = y0;

            loop {
                let px = x as u32;
                let py = y as u32;
                if px < size && py < size {
                    let idx = ((py * size + px) * 4) as usize;
                    
                    // Below progress line = full opacity, above = dimmed
                    let opacity = if py >= progress_y { 255u8 } else { 80 };
                    
                    // White color
                    pixels[idx] = 255;
                    pixels[idx + 1] = 255;
                    pixels[idx + 2] = 255;
                    pixels[idx + 3] = opacity;
                }

                if (x - x1).abs() < 1.0 && (y - y1).abs() < 1.0 {
                    break;
                }

                let e2 = 2.0 * err;
                if e2 > -dy {
                    err -= dy;
                    x += sx;
                }
                if e2 < dx {
                    err += dx;
                    y += sy;
                }
            }
        }

        async fn update_tooltip_and_menu(
            &self,
            progress: f64,
            completed: usize,
            total: usize,
        ) -> Result<(), Box<dyn std::error::Error>> {
             // Redundant since called inside update_state, but kept for compatibility logic structure
            if let Some(tray) = &self.tray {
                let tooltip = format!("Uploading: {:.0}% ({}/{})", progress * 100.0, completed, total);
                tray.set_tooltip(Some(&tooltip))?;
            }
            Ok(())
        }

        /// Advance animation frame (call periodically during upload)
        pub async fn tick_animation(&self) -> Result<(), Box<dyn std::error::Error>> {
            let mut state = self.state.write().await;
            if state.is_processing {
                state.animation_frame = (state.animation_frame + 1) % 4;
            }
            Ok(())
        }

        /// Get the current state arc for sharing with upload manager
        pub fn state(&self) -> Arc<RwLock<UploadProgressState>> {
            Arc::clone(&self.state)
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use desktop::TrayManager;

/// Upload progress state tracked by the tray manager
#[derive(Debug, Clone, Default)]
pub struct UploadProgressState {
    /// Whether an upload is currently in progress
    pub is_processing: bool,
    /// Whether there are any finished uploads (for persistent tray icon)
    pub has_completed_items: bool,
    /// Overall progress from 0.0 to 1.0
    pub progress: f64,
    /// Number of files completed
    pub completed: usize,
    /// Total number of files
    pub total: usize,
    /// Current animation frame (for pulsing effect)
    pub animation_frame: u8,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
mod mobile {
    use std::sync::Arc;
    use tokio::sync::RwLock;
    use tauri::AppHandle;
    pub use super::UploadProgressState;

    pub struct TrayManager {
        state: Arc<RwLock<UploadProgressState>>,
    }

    impl TrayManager {
        pub fn new() -> Self {
            Self {
                state: Arc::new(RwLock::new(UploadProgressState::default())),
            }
        }

        pub fn init(&mut self, _app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
            // No-op on mobile
            Ok(())
        }

        pub async fn update_state(
            &self,
            is_processing: bool,
            has_completed_items: bool,
            progress: f64,
            completed: usize,
            total: usize,
        ) -> Result<(), Box<dyn std::error::Error>> {
            // Update state (logic only, no UI)
            let mut state = self.state.write().await;
            state.is_processing = is_processing;
            state.has_completed_items = has_completed_items;
            state.progress = progress;
            state.completed = completed;
            state.total = total;
            Ok(())
        }
        
        pub async fn tick_animation(&self) -> Result<(), Box<dyn std::error::Error>> {
            Ok(())
        }
        
        pub fn state(&self) -> Arc<RwLock<UploadProgressState>> {
            Arc::clone(&self.state)
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub use mobile::TrayManager;

