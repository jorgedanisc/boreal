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
  IconCheck,
  IconLoader2,
  IconDevices,
  IconChevronRight,
  IconX,
} from "@tabler/icons-react";
import {
  startNetworkDiscovery,
  stopNetworkDiscovery,
  getDiscoveredDevices,
  initiatePairing,
  getPairingStatus,
  confirmPairingAsSender,
  type DiscoveredDevice,
  type PairingStatus,
} from "@/lib/pairing";

interface NetworkShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vaultId: string;
}

type DialogState = "discovering" | "connecting" | "verifying" | "waiting" | "success" | "error";

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
        } else if (status.state === "transferring") {
          // Sender confirmed, now waiting for transfer completion
          setState("waiting");
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

  const handleSenderConfirm = useCallback(async () => {
    try {
      await confirmPairingAsSender();
      setState("waiting");
    } catch (e) {
      console.error("Failed to confirm pairing:", e);
      setError(String(e));
      setState("error");
    }
  }, []);

  const handleClose = useCallback(async () => {
    await stopNetworkDiscovery().catch(console.error);
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-medium">Share Over Network</DialogTitle>
          <DialogDescription className="text-xs">
            {getDescription(state)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[240px] flex flex-col">
          <AnimatePresence mode="wait">
            {state === "discovering" && (
              <DiscoveringContent
                key="discovering"
                devices={devices}
                onSelectDevice={handleSelectDevice}
              />
            )}

            {(state === "connecting" || state === "verifying") && (
              <VerifyingContent
                key="verifying"
                deviceName={selectedDevice?.name}
                verificationCode={pairingStatus?.verification_code}
                isConnecting={state === "connecting"}
                onConfirm={handleSenderConfirm}
                onCancel={handleClose}
              />
            )}

            {state === "waiting" && (
              <WaitingContent key="waiting" deviceName={selectedDevice?.name} />
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
      transition={{ duration: 0.15 }}
    >
      {/* Scanning indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
        <IconLoader2 className="w-3 h-3 animate-spin" />
        <span>Scanning for devices...</span>
      </div>

      {/* Device list */}
      <div className="flex-1 space-y-1.5">
        {devices.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
            <IconDevices className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-xs text-muted-foreground">No devices found</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
              Make sure the other device has tapped "Pair Device"
            </p>
          </div>
        ) : (
          devices.map((device) => (
            <motion.button
              key={device.id}
              className="w-full p-3 bg-muted/50 hover:bg-muted rounded-lg flex items-center gap-3 transition-colors"
              onClick={() => onSelectDevice(device)}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                <IconDevices className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium">{device.name}</p>
                <p className="text-[10px] text-muted-foreground">{device.ip}</p>
              </div>
              <IconChevronRight className="w-4 h-4 text-muted-foreground" />
            </motion.button>
          ))
        )}
      </div>
    </motion.div>
  );
}

function VerifyingContent({
  deviceName,
  verificationCode,
  isConnecting,
  onConfirm,
  onCancel,
}: {
  deviceName: string | undefined;
  verificationCode: string | null | undefined;
  isConnecting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <motion.div
      className="flex-1 flex flex-col items-center justify-center gap-4"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      {!isConnecting && verificationCode ? (
        <>
          <div className="text-center space-y-0.5">
            <p className="text-xs text-muted-foreground">
              Connected to {deviceName || "device"}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
              Verification Code
            </p>
          </div>

          <div className="flex gap-1.5">
            {verificationCode.split("").map((digit, i) => (
              <motion.span
                key={i}
                className="w-10 h-12 bg-muted rounded-lg flex items-center justify-center text-lg font-mono font-semibold"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                {digit}
              </motion.span>
            ))}
          </div>

          <p className="text-[10px] text-muted-foreground text-center max-w-[200px]">
            Confirm this matches the code on the other device
          </p>

          {/* Match / Cancel buttons */}
          <div className="flex gap-2 w-full max-w-[200px]">
            <Button variant="outline" onClick={onCancel} className="flex-1 h-9 text-xs">
              Cancel
            </Button>
            <Button onClick={onConfirm} className="flex-1 h-9 text-xs">
              <IconCheck className="w-3.5 h-3.5 mr-1.5" />
              Match
            </Button>
          </div>
        </>
      ) : (
        <>
          <IconLoader2 className="w-6 h-6 text-primary animate-spin" />
          <p className="text-xs text-muted-foreground">
            Connecting to {deviceName || "device"}...
          </p>
        </>
      )}
    </motion.div>
  );
}

function WaitingContent({ deviceName }: { deviceName: string | undefined }) {
  return (
    <motion.div
      className="flex-1 flex flex-col items-center justify-center gap-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <IconLoader2 className="w-6 h-6 text-primary animate-spin" />
      <div className="text-center space-y-1">
        <p className="text-sm font-medium">Transferring vault...</p>
        <p className="text-xs text-muted-foreground">
          Sending encrypted data to {deviceName || "device"}
        </p>
      </div>

      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, delay: i * 0.2, repeat: Infinity }}
          />
        ))}
      </div>
    </motion.div>
  );
}

function SuccessContent({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      className="flex-1 flex flex-col items-center justify-center gap-4"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="w-12 h-12 bg-green-500/10 rounded-full flex items-center justify-center"
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        <IconCheck className="w-6 h-6 text-green-500" />
      </motion.div>

      <div className="text-center space-y-0.5">
        <h3 className="text-sm font-medium text-green-500">Vault Shared</h3>
        <p className="text-xs text-muted-foreground">
          Securely transferred to the other device
        </p>
      </div>

      <Button onClick={onClose} size="sm" className="text-xs h-8">
        Done
      </Button>
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
      className="flex-1 flex flex-col items-center justify-center gap-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center">
        <IconX className="w-6 h-6 text-destructive" />
      </div>

      <div className="text-center space-y-0.5">
        <h3 className="text-sm font-medium text-destructive">Connection Failed</h3>
        <p className="text-xs text-muted-foreground max-w-[200px]">
          {error || "Could not connect to device"}
        </p>
      </div>

      <Button onClick={onRetry} variant="outline" size="sm" className="text-xs h-8">
        Try Again
      </Button>
    </motion.div>
  );
}

function getDescription(state: DialogState): string {
  switch (state) {
    case "discovering":
      return "Find devices on your local network";
    case "connecting":
      return "Establishing secure connection";
    case "verifying":
      return "Confirm codes match";
    case "waiting":
      return "Transferring vault data";
    case "success":
      return "Transfer complete";
    case "error":
      return "Something went wrong";
  }
}
