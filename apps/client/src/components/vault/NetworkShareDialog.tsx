import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  IconWifi,
  IconCheck,
  IconLoader,
  IconDevices,
  IconChevronRight,
} from "@tabler/icons-react";
import {
  startNetworkDiscovery,
  stopNetworkDiscovery,
  getDiscoveredDevices,
  initiatePairing,
  getPairingStatus,
  type DiscoveredDevice,
  type PairingStatus,
} from "@/lib/pairing";

interface NetworkShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vaultId: string;
}

type DialogState = "discovering" | "connecting" | "verifying" | "success" | "error";

export function NetworkShareDialog({
  open,
  onOpenChange,
  vaultId,
}: NetworkShareDialogProps) {
  const [state, setState] = useState<DialogState>("discovering");
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<DiscoveredDevice | null>(null);
  const [pairingStatus, setPairingStatus] = useState<PairingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Start discovery when dialog opens
  useEffect(() => {
    if (open) {
      setState("discovering");
      setDevices([]);
      setSelectedDevice(null);
      setError(null);

      startNetworkDiscovery().catch((e) => {
        console.error("Failed to start discovery:", e);
        setError(String(e));
        setState("error");
      });

      return () => {
        stopNetworkDiscovery().catch(console.error);
      };
    }
  }, [open]);

  // Poll for discovered devices
  useEffect(() => {
    if (!open || state !== "discovering") return;

    const interval = setInterval(async () => {
      try {
        const found = await getDiscoveredDevices();
        setDevices(found);
      } catch (e) {
        console.error("Failed to get devices:", e);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [open, state]);

  // Poll for pairing status when connecting
  useEffect(() => {
    if (!open || (state !== "connecting" && state !== "verifying")) return;

    const interval = setInterval(async () => {
      try {
        const status = await getPairingStatus();
        setPairingStatus(status);

        if (status.state === "verifying") {
          setState("verifying");
        } else if (status.state === "success") {
          setState("success");
        } else if (status.state === "error") {
          setError(status.error || "Pairing failed");
          setState("error");
        }
      } catch (e) {
        console.error("Failed to get status:", e);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [open, state]);

  const handleSelectDevice = useCallback(async (device: DiscoveredDevice) => {
    setSelectedDevice(device);
    setState("connecting");

    try {
      await initiatePairing(device.id, vaultId);
    } catch (e) {
      console.error("Failed to initiate pairing:", e);
      setError(String(e));
      setState("error");
    }
  }, [vaultId]);

  const handleClose = useCallback(async () => {
    await stopNetworkDiscovery().catch(console.error);
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconWifi className="w-5 h-5" />
            Share Over Network
          </DialogTitle>
          <DialogDescription>
            {getDescription(state)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[300px] flex flex-col">
          <AnimatePresence mode="wait">
            {state === "discovering" && (
              <DiscoveringContent
                key="discovering"
                devices={devices}
                onSelectDevice={handleSelectDevice}
              />
            )}

            {(state === "connecting" || state === "verifying") && (
              <ConnectingContent
                key="connecting"
                deviceName={selectedDevice?.name}
                verificationCode={pairingStatus?.verification_code}
                isVerifying={state === "verifying"}
              />
            )}

            {state === "success" && (
              <SuccessContent key="success" onClose={handleClose} />
            )}

            {state === "error" && (
              <ErrorContent
                key="error"
                error={error}
                onRetry={() => {
                  setState("discovering");
                  setError(null);
                  startNetworkDiscovery().catch(console.error);
                }}
              />
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ========================
// Content Components
// ========================

function DiscoveringContent({
  devices,
  onSelectDevice,
}: {
  devices: DiscoveredDevice[];
  onSelectDevice: (device: DiscoveredDevice) => void;
}) {
  return (
    <motion.div
      className="flex-1 flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Scanning indicator */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        >
          <IconLoader className="w-4 h-4" />
        </motion.div>
        <span>Scanning for devices in pairing mode...</span>
      </div>

      {/* Device list */}
      <div className="flex-1 space-y-2">
        {devices.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
            <IconDevices className="w-12 h-12 text-muted-foreground/50 mb-4" />
            <p className="text-sm text-muted-foreground">
              No devices found yet
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Make sure the other device has tapped "Pair Device"
            </p>
          </div>
        ) : (
          devices.map((device) => (
            <motion.button
              key={device.id}
              className="w-full p-4 bg-muted/50 hover:bg-muted rounded-lg flex items-center gap-3 transition-colors"
              onClick={() => onSelectDevice(device)}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                <IconDevices className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-medium">{device.name}</p>
                <p className="text-xs text-muted-foreground">{device.ip}</p>
              </div>
              <IconChevronRight className="w-5 h-5 text-muted-foreground" />
            </motion.button>
          ))
        )}
      </div>
    </motion.div>
  );
}

function ConnectingContent({
  deviceName,
  verificationCode,
  isVerifying,
}: {
  deviceName: string | undefined;
  verificationCode: string | null | undefined;
  isVerifying: boolean;
}) {
  return (
    <motion.div
      className="flex-1 flex flex-col items-center justify-center gap-6"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
    >
      {isVerifying && verificationCode ? (
        <>
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">
              Connected to {deviceName || "device"}
            </p>
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Verification Code
            </p>
          </div>

          <div className="flex gap-2">
            {verificationCode.split("").map((digit, i) => (
              <motion.span
                key={i}
                className="w-10 h-12 bg-muted border rounded-lg flex items-center justify-center text-xl font-mono font-bold"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                {digit}
              </motion.span>
            ))}
          </div>

          <p className="text-xs text-muted-foreground text-center max-w-[250px]">
            The other device will confirm this code matches. Waiting for confirmation...
          </p>

          <motion.div
            className="flex gap-1"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-2 h-2 bg-primary rounded-full"
                animate={{ y: [0, -4, 0] }}
                transition={{ duration: 0.5, delay: i * 0.1, repeat: Infinity }}
              />
            ))}
          </motion.div>
        </>
      ) : (
        <>
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          >
            <IconLoader className="w-10 h-10 text-primary" />
          </motion.div>
          <p className="text-sm text-muted-foreground">
            Connecting to {deviceName || "device"}...
          </p>
        </>
      )}
    </motion.div>
  );
}

function SuccessContent({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      className="flex-1 flex flex-col items-center justify-center gap-6"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <motion.div
        className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
      >
        <IconCheck className="w-10 h-10 text-green-500" />
      </motion.div>

      <div className="text-center">
        <h3 className="font-semibold text-green-600">Vault Shared!</h3>
        <p className="text-sm text-muted-foreground">
          The vault has been securely transferred
        </p>
      </div>

      <Button onClick={onClose}>Done</Button>
    </motion.div>
  );
}

function ErrorContent({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <motion.div
      className="flex-1 flex flex-col items-center justify-center gap-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="w-16 h-16 bg-destructive/20 rounded-full flex items-center justify-center">
        <IconWifi className="w-8 h-8 text-destructive" />
      </div>

      <div className="text-center">
        <h3 className="font-semibold text-destructive">Connection Failed</h3>
        <p className="text-sm text-muted-foreground max-w-[250px]">
          {error || "Could not connect to device"}
        </p>
      </div>

      <Button onClick={onRetry} variant="outline">
        Try Again
      </Button>
    </motion.div>
  );
}

// ========================
// Helpers
// ========================

function getDescription(state: DialogState): string {
  switch (state) {
    case "discovering":
      return "Find devices on your local network";
    case "connecting":
      return "Establishing secure connection";
    case "verifying":
      return "Waiting for confirmation on the other device";
    case "success":
      return "Transfer complete";
    case "error":
      return "Something went wrong";
  }
}
