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
    // boreal://import?data=... - encrypted vault import
    if (url.includes("import") && url.includes("data=")) {
      try {
        // Simple extraction to avoid URL parsing issues with custom schemes if inconsistent
        const data = url.split("data=")[1].split("&")[0];
        if (data) {
          // Pass data as search param using untyped object to bypass strict route typing temporarily
          router.navigate({ to: "/scan", search: { data } as any });
          return;
        }
      } catch (e) {
        console.error("Failed to parse import url", e);
      }
    }

    // boreal://scan - opens the scan page
    if (url.includes("scan")) {
      router.navigate({ to: "/scan" })
      return
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

// Start deep link handling
initDeepLinks()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <RouterProvider router={router} />
    </Suspense>
  </StrictMode>
)
