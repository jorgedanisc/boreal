import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { IconScan, IconX } from "@tabler/icons-react";
import { importVault } from "@/lib/vault";
import { useNavigate } from "@tanstack/react-router";

interface QrScannerDialogProps {
  trigger?: React.ReactNode;
  defaultOpen?: boolean;
}

export function QrScannerDialog({ trigger, defaultOpen = false }: QrScannerDialogProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const navigate = useNavigate();

  const startScanner = async () => {
    setError(null);
    setIsScanning(true);

    try {
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          // Stop scanner immediately on success
          await scanner.stop();
          setIsScanning(false);

          try {
            // Validate JSON structure
            JSON.parse(decodedText);

            // Import the vault
            await importVault(decodedText);

            // Close dialog and navigate to gallery
            setIsOpen(false);
            navigate({ to: "/gallery" });
          } catch (e) {
            setError("Invalid vault code. Please try again.");
            console.error("Import failed:", e);
          }
        },
        () => {
          // QR code not found in frame - this is normal, ignore
        }
      );
    } catch (e) {
      setIsScanning(false);
      if (String(e).includes("NotAllowedError")) {
        setError("Camera access denied. Please allow camera permissions.");
      } else {
        setError("Failed to start camera. Please try again.");
      }
      console.error("Scanner error:", e);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current && isScanning) {
      try {
        await scannerRef.current.stop();
      } catch {
        // Ignore stop errors
      }
    }
    setIsScanning(false);
  };

  const handleOpenChange = async (open: boolean) => {
    setIsOpen(open);
    if (open) {
      // Small delay to ensure the DOM element is rendered
      setTimeout(() => startScanner(), 100);
    } else {
      await stopScanner();
    }
  };

  // Auto-start scanner if defaultOpen is true
  useEffect(() => {
    if (defaultOpen) {
      setTimeout(() => startScanner(), 100);
    }
  }, [defaultOpen]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      stopScanner();
    };
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" className="gap-2">
            <IconScan className="w-4 h-4" />
            Scan QR Code
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Scan Vault Code</DialogTitle>
          <DialogDescription>
            Point your camera at the QR code displayed on the other device.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center space-y-4">
          <div
            id="qr-reader"
            className="w-full aspect-square bg-muted rounded-lg overflow-hidden"
          />

          {error && (
            <div className="text-destructive text-sm text-center px-4">
              {error}
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsOpen(false)}
            className="text-muted-foreground"
          >
            <IconX className="w-4 h-4 mr-1" />
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
