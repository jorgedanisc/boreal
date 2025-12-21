import { Button } from "@/components/ui/button";
import {
  confirmPairing,
  getPairingStatus,
  getReceivedVaultConfig,
  startPairingMode,
  stopPairingMode,
  type PairingState,
  type PairingStatus,
} from "@/lib/pairing";
import { cn } from "@/lib/utils";
import { importVault } from "@/lib/vault";
import {
  IconArrowLeft,
  IconCheck,
  IconDevices,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { type } from "@tauri-apps/plugin-os";
import { LoaderIcon, LockIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";

export function PairingPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<PairingStatus>({
    state: "idle",
    verification_code: null,
    connected_device: null,
    error: null,
  });
  const [isDesktop, setIsDesktop] = useState(false);
  const [receiverConfirmed, setReceiverConfirmed] = useState(false);

  useEffect(() => {
    const osType = type();
    if (osType === 'linux' || osType === 'macos' || osType === 'windows') {
      setIsDesktop(true);
    }

    startPairingMode().catch((e) => {
      console.error("Failed to start pairing mode:", e);
      // Extract meaningful error message
      const errorMessage = String(e).replace(/^Error:\s*/i, '');
      setStatus((s) => ({ ...s, state: "error", error: errorMessage }));
    });
    return () => {
      stopPairingMode().catch(console.error);
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const newStatus = await getPairingStatus();
        setStatus(newStatus);

        if (newStatus.state === "success") {
          const vaultConfig = await getReceivedVaultConfig();
          if (vaultConfig) {
            try {
              await importVault(vaultConfig);
              navigate({ to: "/gallery" });
            } catch (e) {
              console.error("Failed to import vault:", e);
              setStatus((s) => ({ ...s, state: "error", error: "Failed to import vault" }));
            }
          }
        }
      } catch (e) {
        console.error("Failed to get pairing status:", e);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [navigate]);

  const handleConfirm = useCallback(async () => {
    try {
      await confirmPairing();
      setReceiverConfirmed(true); // Track that receiver has confirmed
    } catch (e) {
      console.error("Failed to confirm pairing:", e);
    }
  }, []);

  const handleBack = useCallback(async () => {
    await stopPairingMode().catch(console.error);
    navigate({ to: "/" });
  }, [navigate]);

  const handleRetry = useCallback(async () => {
    // Reset status to idle first
    setStatus({
      state: "idle",
      verification_code: null,
      connected_device: null,
      error: null,
    });

    // Reset receiverConfirmed on retry
    setReceiverConfirmed(false);

    // Stop any existing session and start fresh
    try {
      await stopPairingMode();
      await startPairingMode();
    } catch (e) {
      console.error("Failed to retry pairing:", e);
      const errorMessage = String(e).replace(/^Error:\s*/i, '');
      setStatus((s) => ({ ...s, state: "error", error: errorMessage }));
    }
  }, []);

  return (
    <div className={cn(
      isDesktop ? "pt-8" : "pt-0",
      "flex flex-col"
    )}>
      {/* Header */}
      <header className="p-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={handleBack} className="h-8 w-8">
          <IconArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-sm font-medium">Pair Device</h1>
          <p className="text-xs text-muted-foreground">{getSubtitle(status.state)}</p>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
        <AnimatePresence mode="wait">
          {status.state === "idle" && <IdleState key="idle" />}
          {status.state === "listening" && <ListeningState key="listening" />}
          {status.state === "verifying" && status.verification_code && !receiverConfirmed && (
            <VerifyingState
              key="verifying"
              code={status.verification_code}
              deviceName={status.connected_device}
              onConfirm={handleConfirm}
              onCancel={handleBack}
            />
          )}
          {status.state === "verifying" && receiverConfirmed && (
            <WaitingForSenderState key="waiting" />
          )}
          {status.state === "transferring" && <TransferringState key="transferring" />}
          {status.state === "success" && <SuccessState key="success" />}
          {status.state === "error" && (
            <ErrorState key="error" error={status.error} onRetry={handleRetry} onBack={handleBack} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function IdleState() {
  return (
    <motion.div
      className="flex flex-col items-center gap-3"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <LoaderIcon className="w-6 h-6 text-muted-foreground animate-spin" />
      <p className="text-xs text-muted-foreground">Initializing...</p>
    </motion.div>
  );
}

function ListeningState() {
  return (
    <motion.div
      className="flex flex-col items-center gap-6 text-center max-w-xs"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
    >
      {/* Animated icon with subtle pulse */}
      <motion.div
        className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center"
        animate={{ scale: [1, 1.03, 1] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
      >
        <IconDevices className="w-7 h-7 text-primary" />
      </motion.div>

      <div className="space-y-1.5">
        <h2 className="text-base font-medium">Waiting for connection</h2>
        <p className="max-w-42 mx-auto text-xs text-muted-foreground leading-relaxed">
          On the other device, open Boreal and tap <span className="font-medium text-foreground">Share Over Network</span>
        </p>
      </div>

      {/* Simple loading dots */}
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, delay: i * 0.2, repeat: Infinity }}
          />
        ))}
      </div>

      <p className="text-[10px] flex items-center gap-1 text-muted-foreground"><LockIcon className="size-2" /> End-to-end encrypted</p>
    </motion.div>
  );
}

function VerifyingState({
  code,
  deviceName,
  onConfirm,
  onCancel,
}: {
  code: string;
  deviceName: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <motion.div
      className="flex flex-col items-center gap-6 w-full max-w-xs"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.15 }}
    >
      <div className="text-center space-y-1">
        <h2 className="text-base font-medium">Verify connection</h2>
        <p className="text-xs text-muted-foreground">
          {deviceName ? `Connected to ${deviceName}` : "Device connected"}
        </p>
      </div>

      {/* Code display */}
      <div className="space-y-3 w-full">
        <p className="text-[10px] text-muted-foreground text-center uppercase tracking-wider">
          Verification Code
        </p>
        <div className="flex gap-1.5 justify-center">
          {code.split("").map((digit, i) => (
            <motion.div
              key={i}
              className="w-10 h-12 bg-muted rounded-lg flex items-center justify-center"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <span className="text-lg font-mono font-semibold">{digit}</span>
            </motion.div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground text-center">
          Confirm this matches the other device
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-2 w-full">
        <Button variant="outline" onClick={onCancel} className="flex-1 h-9 text-xs">
          Cancel
        </Button>
        <Button onClick={onConfirm} className="flex-1 h-9 text-xs">
          <IconCheck className="w-3.5 h-3.5 mr-1.5" />
          Confirm
        </Button>
      </div>
    </motion.div>
  );
}

function TransferringState() {
  return (
    <motion.div
      className="flex flex-col items-center gap-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <IconLoader2 className="w-6 h-6 text-primary animate-spin" />
      <div className="text-center space-y-1">
        <h2 className="text-base font-medium">Receiving vault</h2>
        <p className="text-xs text-muted-foreground">Transferring encrypted data...</p>
      </div>
    </motion.div>
  );
}

function WaitingForSenderState() {
  return (
    <motion.div
      className="flex flex-col items-center gap-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <IconLoader2 className="w-6 h-6 text-primary animate-spin" />
      <div className="text-center space-y-1">
        <h2 className="text-base font-medium">Waiting for other device...</h2>
        <p className="text-xs text-muted-foreground">
          The other device needs to confirm the codes match
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

function SuccessState() {
  return (
    <motion.div
      className="flex flex-col items-center gap-4"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center"
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        <IconCheck className="w-7 h-7 text-green-500" />
      </motion.div>
      <div className="text-center space-y-1">
        <h2 className="text-base font-medium text-green-500">Success</h2>
        <p className="text-xs text-muted-foreground">Vault imported. Redirecting...</p>
      </div>
    </motion.div>
  );
}

function ErrorState({ error, onRetry, onBack }: { error: string | null; onRetry: () => void; onBack: () => void }) {
  // Determine if it's a port-in-use error for specific messaging
  const isPortError = error?.toLowerCase().includes('already in use') || error?.toLowerCase().includes('port');

  return (
    <motion.div
      className="flex flex-col items-center gap-4 max-w-xs"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
        <IconX className="w-7 h-7 text-destructive" />
      </div>
      <div className="text-center space-y-1">
        <h2 className="text-base font-medium text-destructive">Pairing failed</h2>
        <p className="text-xs text-muted-foreground">
          {isPortError
            ? "Another pairing session is still running. Try again in a moment."
            : (error || "An error occurred")}
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={onBack} variant="outline" size="sm" className="text-xs">
          Go back
        </Button>
        <Button onClick={onRetry} size="sm" className="text-xs">
          Try again
        </Button>
      </div>
    </motion.div>
  );
}

function getSubtitle(state: PairingState): string {
  switch (state) {
    case "listening":
      return "Waiting for device";
    case "verifying":
      return "Verify codes match";
    case "transferring":
      return "Receiving data";
    case "success":
      return "Complete";
    case "error":
      return "Failed";
    default:
      return "Initializing";
  }
}
