import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import {
  cancelQrExport,
  getExportFrame,
  startQrExport,
  type ExportSession,
} from "@/lib/qr-transfer";
import { authenticateBiometrics } from "@/lib/vault";
import { IconArrowLeft } from "@tabler/icons-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import QrScanner from "qr-scanner";
import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { type } from "@tauri-apps/plugin-os";

type ExportState = "scanning" | "authenticating" | "exporting";

export function QrExportPage() {
  const { vaultId } = useParams({ from: "/qr-export/$vaultId" });
  const navigate = useNavigate();
  const [state, setState] = useState<ExportState>("scanning");
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);

  const [session, setSession] = useState<ExportSession | null>(null);
  const [currentFrame, setCurrentFrame] = useState<string>("");
  const [framesPlayed, setFramesPlayed] = useState(0);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    // Check if we are running in a desktop environment (Tauri)
    // and if the OS is one of the target desktop platforms.
    const osType = type();
    if (osType === 'linux' || osType === 'macos' || osType === 'windows') {
      setIsDesktop(true);
    }
  }, []);

  // === Stage 1: Scanning ===
  useEffect(() => {
    if (state !== "scanning") return;

    const startScanner = async () => {
      if (scannerRef.current) {
        scannerRef.current.stop();
        scannerRef.current.destroy();
        scannerRef.current = null;
      }

      if (!videoRef.current) return;

      try {
        const scanner = new QrScanner(
          videoRef.current,
          async (result) => {
            // Stop scanning immediately on success
            scanner.stop();
            scanner.destroy();
            scannerRef.current = null;
            handleRequestScanned(result.data);
          },
          {
            preferredCamera: "environment",
            highlightScanRegion: true,
            highlightCodeOutline: true,
            maxScansPerSecond: 10,
          }
        );

        await scanner.start();
        scannerRef.current = scanner;
      } catch (err: any) {
        console.error("Scanner error:", err);
        setError("Failed to start camera");
      }
    };

    // Small delay to ensure DOM is ready
    const timer = setTimeout(startScanner, 100);
    return () => {
      clearTimeout(timer);
      if (scannerRef.current) {
        scannerRef.current.stop();
        scannerRef.current.destroy();
        scannerRef.current = null;
      }
    };
  }, [state]);

  const handleRequestScanned = async (requestJson: string) => {
    setState("authenticating");
    try {
      await authenticateBiometrics("Authenticate to export vault");

      if (!vaultId) throw new Error("No vault ID");
      // Pass raw requestJson string and vaultId
      const sessionData = await startQrExport(vaultId, requestJson);
      setSession(sessionData);
      setState("exporting");
    } catch (e) {
      console.error(e);
      setError("Failed to start export: " + String(e));
      setState("scanning");
    }
  };

  // === Stage 3: Exporting (Animated QR) ===
  useEffect(() => {
    if (state !== "exporting" || !session) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const loop = async () => {
      if (!active) return;
      try {
        const frame = await getExportFrame();
        if (active) {
          setCurrentFrame(frame);
          setFramesPlayed(p => p + 1);
          timer = setTimeout(loop, 70); // 15 FPS
        }
      } catch (e) {
        console.error("Frame error:", e);
        timer = setTimeout(loop, 1000); // Retry slow
      }
    };

    loop();

    return () => {
      active = false;
      clearTimeout(timer);
      cancelQrExport().catch(console.error);
    };
  }, [state, session]);

  const handleBack = () => {
    navigate({ to: "/" });
  };

  return (
    <div className={cn(
      "flex flex-col h-screen bg-background overflow-hidden",
      state !== "scanning" && "pt-safe",
    )}>
      {/* Header - absolute during scanning to overlay camera, flow-based otherwise */}
      <header className={cn(
        "p-4 flex items-center z-20",
        state === "scanning" && "absolute top-0 left-0 right-0 pt-safe pl-safe",
        isDesktop ? "pt-8" : "pt-0",
      )}>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            state === "scanning" ? "text-white hover:bg-white/20" : "text-foreground"
          )}
          onClick={handleBack}
        >
          <IconArrowLeft className="w-6 h-6" />
        </Button>
      </header>

      <div className={cn(
        "flex-1 flex flex-col items-center justify-center p-6 space-y-8 animate-in fade-in duration-300",
        state === "scanning" && "absolute inset-0"
      )}>

        {state === "scanning" && (
          <div className="w-full max-w-sm flex flex-col items-center gap-6">
            <div className="text-center space-y-1">
              <h2 className="text-lg font-semibold text-white">Scan Request QR</h2>
              <p className="text-sm text-white/70">
                On the new device, select "Receive Vault" to show the QR code.
              </p>
            </div>

            <div className="relative w-full aspect-square bg-black rounded-3xl overflow-hidden shadow-lg border-4 border-white/10">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
            </div>

            {error && (
              <div className="p-3 bg-red-500/20 text-red-200 rounded-xl text-xs backdrop-blur-md border border-red-500/30">
                {error}
              </div>
            )}
          </div>
        )}

        {state === "authenticating" && (
          <div className="flex flex-col items-center gap-4">
            <Spinner className="w-8 h-8 text-primary" />
            <p className="text-sm font-medium">Verifying identity...</p>
          </div>
        )}

        {state === "exporting" && session && (
          <div className="w-full max-w-sm flex flex-col items-center gap-6">
            <div className="text-center space-y-1">
              <h2 className="text-lg font-semibold">Sending Credentials...</h2>
              <p className="text-xs text-muted-foreground">
                Transferring vault access securely. Keep QR code visible.
              </p>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border">
              <QRCode
                value={currentFrame}
                size={280}
                level="L"
              />
            </div>

            <div className="w-full flex justify-center">
              <Button variant="outline" className="h-12" style={{ width: 280 * 0.9 }} onClick={handleBack}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
