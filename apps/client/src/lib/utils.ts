import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
export function formatBytes(
  bytes: number,
  opts: {
    decimals?: number;
    sizeType?: "accurate" | "normal";
  } = {},
): string {
  const { decimals = 1, sizeType = "normal" } = opts;

  const sizes = ["KB", "MB", "GB", "TB"];
  const accurateSizes = ["KiB", "MiB", "GiB", "TiB"];
  if (bytes < 1024) return "0 KB"; // Round up to 1 KB for small values

  const divisor = sizeType === "accurate" ? 1024 : 1024;

  // Calculate the appropriate unit index
  let i = Math.floor(Math.log(bytes) / Math.log(divisor)) - 1;

  // Force TB for values close to or above 1000 GB
  if (bytes >= 1000 * Math.pow(divisor, 3)) {
    i = 3; // Force TB unit (index 3 in the sizes array)
  }

  return `${(bytes / Math.pow(divisor, i + 1)).toFixed(decimals)}${sizeType === "accurate"
      ? (accurateSizes[i] ?? "KiB")
      : (sizes[i] ?? "KB")
    }`;
}
