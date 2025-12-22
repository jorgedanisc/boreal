import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  completeQrImport,
  createImportRequest,
  submitImportFrame,
  type ImportProgress,
  type ImportRequest
} from "@/lib/qr-transfer";
import { cn } from "@/lib/utils";
import { importVault, importVaultStep1Save, importVaultStep2Load, importVaultStep3Sync } from "@/lib/vault";
import { IconArrowLeft, IconScan, IconLock } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { type } from "@tauri-apps/plugin-os";
import QrScanner from "qr-scanner";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { toast } from "sonner";

// === Internal Scanner Component ===
const ScannerView = memo(({
  onFrame,
  onError,
  cameraId,
  isDesktop
}: {
  onFrame: (text: string) => Promise<boolean>,
  onError: (err: string) => void,
  cameraId: string,
  isDesktop: boolean
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);

  useEffect(() => {
    let active = true;

    const start = async () => {
      if (scannerRef.current) {
        scannerRef.current.stop();
        scannerRef.current.destroy();
        scannerRef.current = null;
      }

      if (!active || !videoRef.current) return;

      try {
        const scanner = new QrScanner(
          videoRef.current,
          async (result) => {
            if (active) {
              const stop = await onFrame(result.data);
              if (stop && active && scannerRef.current) {
                scannerRef.current.stop();
              }
            }
          },
          {
            preferredCamera: isDesktop && cameraId ? cameraId : "environment",
            highlightScanRegion: true,
            highlightCodeOutline: true,
            maxScansPerSecond: 25,
            returnDetailedScanResult: true,
          }
        );

        await scanner.start();
        scannerRef.current = scanner;

      } catch (e: any) {
        if (active) onError(e.message || "Camera failed");
      }
    };

    const timer = setTimeout(start, 500);

    return () => {
      active = false;
      clearTimeout(timer);
      if (scannerRef.current) {
        scannerRef.current.stop();
        scannerRef.current.destroy();
        scannerRef.current = null;
      }
    };
  }, [cameraId, isDesktop, onFrame, onError]);

  return (
    <div className="w-full h-full bg-black relative overflow-hidden">
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        playsInline
        muted
      />
      <div className="absolute inset-0 pointer-events-none border-[3px] border-white/20" />
    </div>
  );
});
ScannerView.displayName = "ScannerView";

type ImportState = "request" | "scanning" | "complete";

export function QrScannerPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<ImportState>("request");
  const [request, setRequest] = useState<ImportRequest | null>(null);
  const [progress, setProgress] = useState<ImportProgress>({
    complete: false,
    sas_code: null,
    frames_received: 0,
    estimated_percent: 0,
    expected_parts: null
  });
  const [totalScans, setTotalScans] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Camera management
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const isDesktop = type() === "macos" || type() === "windows" || type() === "linux";

  // Prevent multiple completions
  const isCompletingRef = useRef(false);

  useEffect(() => {
    const init = async () => {
      try {
        const req = await createImportRequest();
        setRequest(req);
      } catch (e) {
        console.error(e);
        setError("Failed to initialize import session");
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (isDesktop) {
      QrScanner.listCameras(true).then(devs => {
        setCameras(devs);
        if (devs.length) setSelectedCameraId(devs[0].id);
      }).catch(console.error);
    }
  }, [isDesktop]);

  const handleFinish = useCallback(async () => {
    try {
      await new Promise(r => setTimeout(r, 300));

      const vaultJson = await completeQrImport();

      // Step 1: Save credentials (with 15s timeout)
      const step1 = importVaultStep1Save(vaultJson);
      const step1Timeout = new Promise((_, r) => setTimeout(() => r(new Error("Step 1 timed out")), 15000));
      const savedId = await Promise.race([step1, step1Timeout]) as string;

      // Step 2: Load vault (with 15s timeout)
      const step2 = importVaultStep2Load(savedId);
      const step2Timeout = new Promise((_, r) => setTimeout(() => r(new Error("Step 2 timed out")), 15000));
      await Promise.race([step2, step2Timeout]);

      // Step 3: Sync from S3 (with 30s timeout for network)
      const step3 = importVaultStep3Sync();
      const step3Timeout = new Promise((_, r) => setTimeout(() => r(new Error("Step 3 timed out")), 30000));
      await Promise.race([step3, step3Timeout]) as string;

      toast.success("Import Successful", {
        description: "Vault imported and synced.",
      });
      navigate({ to: "/gallery" });
    } catch (e) {
      console.error("Import Completion Error:", e);
      toast.error("Import Failed", { description: String(e) });
      setError(String(e));
      setLoading(false);
      isCompletingRef.current = false;
    }
  }, [navigate]);

  const handleFrame = useCallback(async (decodedText: string): Promise<boolean> => {
    if (isCompletingRef.current) return true;

    setTotalScans(p => p + 1);
    try {
      const res = await submitImportFrame(decodedText);
      setProgress(res);

      if (res.complete) {
        isCompletingRef.current = true;
        setLoading(true);

        handleFinish().catch((e: any) => {
          console.error("Finish failed:", e);
          isCompletingRef.current = false;
          setLoading(false);
        });
        return true;
      }
    } catch (e) {
      // Silent - continue scanning
    }
    return false;
  }, [handleFinish]);

  const handleBack = () => {
    if (state === "scanning") {
      setState("request");
    } else {
      navigate({ to: "/" });
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background relative overflow-hidden">
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-30 p-4 flex justify-between items-center bg-transparent pointer-events-none">
        <Button
          variant="ghost"
          size="icon"
          className="text-white hover:bg-white/20 backdrop-blur-sm pointer-events-auto"
          onClick={handleBack}
        >
          <IconArrowLeft className="w-6 h-6" />
        </Button>

        <div className="flex gap-2 pointer-events-auto">
          {isDesktop && cameras.length > 0 && state === "scanning" && (
            <Select value={selectedCameraId} onValueChange={setSelectedCameraId}>
              <SelectTrigger className="w-[180px] bg-black/40 backdrop-blur-md text-white border-white/20 h-8 text-xs">
                <SelectValue placeholder="Select Camera" />
              </SelectTrigger>
              <SelectContent>
                {cameras.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.label || c.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {state === "request" && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-8 animate-in fade-in zoom-in-95 duration-300">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Receive Vault</h1>
            <p className="text-muted-foreground text-sm max-w-xs mx-auto">
              Scan this QR code with your old device to start the secure transfer.
            </p>
          </div>

          <div className="p-4 bg-white rounded-3xl shadow-xl">
            {request ? (
              <QRCode value={JSON.stringify(request)} size={240} level="M" />
            ) : (
              <div className="w-[240px] h-[240px] bg-secondary/20 animate-pulse rounded-xl" />
            )}
          </div>

          <Button
            size="lg"
            className="w-full max-w-xs rounded-full h-12 text-base font-semibold shadow-lg shadow-primary/20"
            onClick={() => setState("scanning")}
          >
            <IconScan className="w-5 h-5 mr-2" />
            Continue to Scanner
          </Button>

          {error && (
            <div className="p-4 bg-red-500/10 text-red-500 rounded-xl text-xs backdrop-blur-md border border-red-500/20 max-w-xs text-center">
              {error}
            </div>
          )}
        </div>
      )}

      {state === "scanning" && (
        <div className="flex-1 relative bg-black flex flex-col items-center justify-center p-6">
          <div className={cn(
            "relative w-full max-w-xs aspect-square bg-black rounded-3xl overflow-hidden shadow-2xl z-0",
            !loading && "border-4 border-white/20"
          )}>
            {loading ? (
              <div className="absolute inset-0 z-20 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center space-y-6 animate-in fade-in duration-500">
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-white/10 border-t-green-500 rounded-full animate-spin" />
                  <IconLock className="w-6 h-6 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-green-500" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-white font-bold text-lg animate-pulse">Syncing Vault...</p>
                  <p className="text-white/50 text-xs">Downloading from S3</p>
                </div>
              </div>
            ) : (
              <ScannerView
                onFrame={handleFrame}
                onError={setError}
                cameraId={selectedCameraId}
                isDesktop={isDesktop}
              />
            )}
          </div>

          {/* Progress UI */}
          {!loading && (
            <div className="mt-8 w-full max-w-xs z-10 pointer-events-none">
              {progress.frames_received > 0 ? (
                <div className="space-y-4 animate-in fade-in zoom-in-95 duration-300">
                  <div className="flex justify-between text-xs font-medium text-white">
                    <span className="text-primary animate-pulse">
                      Receiving Credentials...
                    </span>
                    <span className="text-white/70">
                      {progress.frames_received} frames{progress.expected_parts ? ` / ~${progress.expected_parts}` : ""}
                    </span>
                  </div>
                  <div className="h-3 w-full bg-secondary/20 rounded-full overflow-hidden backdrop-blur-sm border border-white/10">
                    <div
                      className="h-full bg-primary transition-all duration-300 ease-out"
                      style={{ width: `${Math.min(100, progress.estimated_percent || 0)}%` }}
                    />
                  </div>

                </div>
              ) : (
                <div className="text-center space-y-2 text-white/80 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <IconScan className="w-8 h-8 mx-auto text-white/50 mb-2 animate-pulse" />
                  <p className="text-sm font-medium">Scan QR on other device</p>
                  <p className="text-xs text-white/50">Hold steady and ensure good lighting</p>
                </div>
              )}

              {error && (
                <div className="mt-4 p-3 bg-red-500/20 text-red-200 rounded-xl text-xs backdrop-blur-md border border-red-500/30 text-center">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
