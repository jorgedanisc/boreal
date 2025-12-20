import { StrictMode, Suspense } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider, createRouter } from "@tanstack/react-router"
import { onOpenUrl, getCurrent } from "@tauri-apps/plugin-deep-link"

import "./lib/i18n"
import "./index.css"
import { routeTree } from "./routeTree.gen"

const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

// Handle deep links
async function handleDeepLink(urls: string[]) {
  for (const url of urls) {
    // boreal://import?data=... - encrypted vault import (from QR scan)
    if (url.includes("import") && url.includes("data=")) {
      try {
        const data = url.split("data=")[1].split("&")[0];
        if (data) {
          router.navigate({ to: "/scan", search: { data } as any });
          return;
        }
      } catch (e) {
        console.error("Failed to parse import url", e);
      }
    }

    // boreal://recover - opens the manual recovery/import page
    if (url.includes("recover")) {
      router.navigate({ to: "/import" });
      return;
    }

    // boreal://scan - opens the scan page
    if (url.includes("scan")) {
      router.navigate({ to: "/scan" });
      return;
    }
  }
}

// Initialize deep link listeners
async function initDeepLinks() {
  try {
    // Check if app was opened via deep link
    const initialUrls = await getCurrent()
    if (initialUrls && initialUrls.length > 0) {
      handleDeepLink(initialUrls)
    }

    // Listen for subsequent deep links
    await onOpenUrl(handleDeepLink)
  } catch (e) {
    console.error("Deep link init failed:", e)
  }
}

// Initialize menu listeners
async function initMenuListeners() {
  const { listen } = await import("@tauri-apps/api/event");
  const { openCacheFolder } = await import("./lib/vault");

  // Listen for Developer > Open Cache Folder menu item
  listen("menu:open_cache_folder", async () => {
    try {
      await openCacheFolder();
    } catch (e) {
      console.error("Failed to open cache folder:", e);
    }
  });
}

// Initialize splash removal with staged transition (2s max)
async function initSplash() {
  // Wait 1.0s for reveal animation to stabilize
  await new Promise(resolve => setTimeout(resolve, 1000));

  const splashBg = document.getElementById('splash-bg');
  const splash = document.getElementById('splash');

  // Stage 1: Fade out the image wrapper (0.3s transition)
  // This ensures the image is gone before we reveal the content
  if (splash) {
    splash.style.opacity = '0';
  }

  // Wait for image fade to complete
  await new Promise(resolve => setTimeout(resolve, 300));

  // Stage 2: Fade out the background layer (0.5s transition)
  // This smoothly reveals the app content underneath
  if (splashBg) {
    splashBg.style.opacity = '0';
  }

  // Stage 3: Wait for background fade to complete, then remove elements
  await new Promise(resolve => setTimeout(resolve, 500));
  splash?.remove();
  splashBg?.remove();
  document.body.classList.remove('splash-lock'); // Restore scrolling capabilities
}

// Start deep link handling
initDeepLinks();

// Start menu listeners
initMenuListeners();

// Start splash removal (can run in parallel with app boot)
initSplash();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<div className="h-dvh w-dvw bg-background" />}>
      <RouterProvider router={router} />
    </Suspense>
  </StrictMode>
)
