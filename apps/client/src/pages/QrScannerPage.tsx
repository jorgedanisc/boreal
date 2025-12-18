import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { IconArrowLeft, IconScan, IconCamera, IconLock } from "@tabler/icons-react";
import { importVault, decryptImport } from "@/lib/vault";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { type } from "@tauri-apps/plugin-os";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { REGEXP_ONLY_DIGITS } from "input-otp";

export function QrScannerPage() {
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Secure Import State
  const [encryptedData, setEncryptedData] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [isDecrypting, setIsDecrypting] = useState(false);

  const isDesktop = ["windows", "linux", "macos"].includes(type());

  useEffect(() => {
    // Check for deep link data
    const searchParams = new URLSearchParams(location.searchStr);
    const data = searchParams.get("data");
    if (data) {
      setEncryptedData(data);
    }
  }, [location.searchStr]);

  const getCameras = async () => {
    try {
      const devices = await Html5Qrcode.getCameras();
      if (devices && devices.length) {
        setCameras(devices);
        if (!selectedCameraId) {
          setSelectedCameraId(devices[0].id);
        }
      }
    } catch (e) {
      console.error("Failed to get cameras", e);
    }
  };

  const handleImport = async (json: string) => {
    try {
      JSON.parse(json); // Validate
      await importVault(json);
      navigate({ to: "/gallery" });
    } catch (e) {
      setError("Invalid vault configuration.");
      console.error("Import failed:", e);
      if (!encryptedData) {
        // Only restart scanner if we were scanning
        setTimeout(() => startScanner(selectedCameraId), 1500);
      }
    }
  };

  const handlePinSubmit = async (code: string) => {
    if (!encryptedData) return;
    setError(null);
    setIsDecrypting(true);
    try {
      const json = await decryptImport(encryptedData, code);
      await handleImport(json);
    } catch (e) {
      setError("Incorrect Pairing Code. Please try again.");
      setPin("");
      setIsDecrypting(false);
    }
  };

  const startScanner = async (cameraId?: string) => {
    if (encryptedData) return; // Don't scan if we already have data to decrypt

    setError(null);
    setIsScanning(true);

    try {
      if (isDesktop && !cameras.length) {
        await getCameras();
      }

      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;

      const config = {
        fps: 10,
        qrbox: { width: 300, height: 300 },
        aspectRatio: 1.0,
      };

      const cameraConfig =
        isDesktop && (cameraId || selectedCameraId)
          ? { deviceId: { exact: cameraId || selectedCameraId } }
          : { facingMode: "environment" };

      await scanner.start(
        cameraConfig,
        config,
        async (decodedText) => {
          await scanner.stop();
          setIsScanning(false);

          // Check for Secure Import URL
          if (decodedText.startsWith("boreal://") && decodedText.includes("data=")) {
            try {
              const data = decodedText.split("data=")[1].split("&")[0];
              if (data) {
                setEncryptedData(data);
                return;
              }
            } catch (e) {
              console.error("Failed to parse secure URL", e);
            }
          }

          // Fallback: Try RAW JSON (Legacy / Backup File)
          try {
            await handleImport(decodedText);
          } catch {
            // If not JSON and not valid URL, show error
            setError("Invalid QR Code");
            setTimeout(() => startScanner(selectedCameraId), 1500);
          }
        },
        () => { }
      );
    } catch (e) {
      setIsScanning(false);
      if (String(e).includes("NotAllowedError")) {
        setError("Camera access denied. Please allow camera permissions.");
      } else {
        setError("Failed to start camera. Please try again.");
      }
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        await scannerRef.current.stop();
      } catch { }
    }
    scannerRef.current = null;
    setIsScanning(false);
  };

  useEffect(() => {
    if (!encryptedData) {
      const timer = setTimeout(() => startScanner(), 100);
      return () => {
        clearTimeout(timer);
        stopScanner();
      };
    } else {
      stopScanner();
    }
  }, [encryptedData]);

  const handleCameraChange = async (value: string) => {
    setSelectedCameraId(value);
    await stopScanner();
    startScanner(value);
  };

  const handleBack = async () => {
    if (encryptedData) {
      // If in PIN mode, clear it and go back to scanner/home?
      // Actually if deep linked, going back to scanner is weird if data persists.
      // Let's just go home.
      setEncryptedData(null);
      setPin("");
      navigate({ to: "/" });
    } else {
      await stopScanner();
      navigate({ to: "/" });
    }
  };

  return (
    <div className="flex flex-col">
      {/* Header */}
      <header className="p-4 flex items-center gap-4 border-b">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <IconArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="font-semibold">{encryptedData ? "Enter Pairing Code" : "Scan Vault Code"}</h1>
          <p className="text-sm text-muted-foreground">
            {encryptedData ? "Enter the 6-digit code from the other device" : "Point your camera at the QR code"}
          </p>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">

        {encryptedData ? (
          /* PIN ENTRY MODE */
          <div className="w-full max-w-sm flex flex-col items-center space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center text-primary">
              <IconLock className="w-10 h-10" />
            </div>

            <div className="space-y-2 text-center">
              <h2 className="text-xl font-semibold">Secure Import</h2>
              <p className="text-sm text-muted-foreground">
                This vault is encrypted. Please enter the pairing code displayed on the source device.
              </p>
            </div>

            <InputOTP
              maxLength={6}
              value={pin}
              onChange={(val) => {
                setPin(val);
                if (val.length === 6) handlePinSubmit(val);
              }}
              pattern={REGEXP_ONLY_DIGITS}
              disabled={isDecrypting}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>

            {error && <p className="text-sm text-destructive font-medium">{error}</p>}
            {isDecrypting && <p className="text-sm text-muted-foreground animate-pulse">Decrypting...</p>}

          </div>
        ) : (
          /* SCANNER MODE */
          <>
            {isDesktop && cameras.length > 0 && (
              <div className="w-full max-w-sm">
                <Select value={selectedCameraId} onValueChange={handleCameraChange}>
                  <SelectTrigger className="w-full">
                    <div className="flex items-center gap-2">
                      <IconCamera className="w-4 h-4 text-muted-foreground" />
                      <SelectValue placeholder="Select Camera" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {cameras.map((camera) => (
                      <SelectItem key={camera.id} value={camera.id}>
                        {camera.label || `Camera ${camera.id.slice(0, 5)}...`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="w-full max-w-sm space-y-6">
              <div className="relative">
                <div
                  id="qr-reader"
                  className="w-full aspect-square bg-muted rounded-2xl overflow-hidden"
                />
                {isScanning && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-48 h-48 border-2 border-primary rounded-lg animate-pulse" />
                  </div>
                )}
              </div>

              {error && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-center">
                  <p className="text-sm text-destructive">{error}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => startScanner(selectedCameraId)}
                  >
                    Try Again
                  </Button>
                </div>
              )}

              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-2 text-muted-foreground">
                  <IconScan className="w-4 h-4" />
                  <span className="text-sm">Scanning...</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Open the Boreal app on another device and tap "Share".
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
