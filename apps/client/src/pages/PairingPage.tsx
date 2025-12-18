import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  IconArrowLeft,
  IconWifi,
  IconCheck,
  IconX,
  IconLoader2,
  IconShieldCheck,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import {
  startPairingMode,
  stopPairingMode,
  confirmPairing,
  getPairingStatus,
  getReceivedVaultConfig,
  type PairingStatus,
  type PairingState,
} from "@/lib/pairing";
import { importVault } from "@/lib/vault";

export function PairingPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<PairingStatus>({
    state: "idle",
    verification_code: null,
    connected_device: null,
    error: null,
  });

  useEffect(() => {
    startPairingMode().catch((e) => {
      console.error("Failed to start pairing mode:", e);
      setStatus((s) => ({ ...s, state: "error", error: String(e) }));
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
    } catch (e) {
      console.error("Failed to confirm pairing:", e);
    }
  }, []);

  const handleBack = useCallback(async () => {
    await stopPairingMode().catch(console.error);
    navigate({ to: "/" });
  }, [navigate]);

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      {/* Background pulse rings */}
      <PulseBackground state={status.state} />

      {/* Header */}
      <header className="p-4 flex items-center gap-4 relative z-10">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <IconArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="font-semibold">Pair Device</h1>
          <p className="text-sm text-muted-foreground">{getSubtitle(status.state)}</p>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-6 relative z-10">
        <AnimatePresence mode="wait">
          {status.state === "idle" && <IdleState key="idle" />}
          {status.state === "listening" && <ListeningState key="listening" />}
          {status.state === "verifying" && status.verification_code && (
            <VerifyingState
              key="verifying"
              code={status.verification_code}
              deviceName={status.connected_device}
              onConfirm={handleConfirm}
              onCancel={handleBack}
            />
          )}
          {status.state === "transferring" && <TransferringState key="transferring" />}
          {status.state === "success" && <SuccessState key="success" />}
          {status.state === "error" && (
            <ErrorState key="error" error={status.error} onRetry={handleBack} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Background rings
function PulseBackground({ state }: { state: PairingState }) {
  const isActive = state === "listening" || state === "verifying";
  const isSuccess = state === "success";

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className={`absolute rounded-full border ${isSuccess ? "border-green-500/20" : "border-primary/20"}`}
          initial={{ width: 100, height: 100, opacity: 0 }}
          animate={
            isActive
              ? {
                width: [100, 500 + i * 100],
                height: [100, 500 + i * 100],
                opacity: [0.5, 0],
              }
              : { opacity: 0 }
          }
          transition={{
            duration: 4,
            delay: i * 0.8,
            repeat: Infinity,
            ease: "easeOut",
          }}
        />
      ))}
    </div>
  );
}

// States
function IdleState() {
  return (
    <motion.div
      className="flex flex-col items-center gap-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <IconLoader2 className="w-10 h-10 text-muted-foreground animate-spin" />
      <p className="text-muted-foreground">Initializing...</p>
    </motion.div>
  );
}

function ListeningState() {
  return (
    <motion.div
      className="flex flex-col items-center gap-8"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <motion.div
        className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center"
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <IconWifi className="w-12 h-12 text-primary" />
      </motion.div>

      <Card className="max-w-sm">
        <CardContent className="pt-6 text-center space-y-3">
          <h2 className="text-xl font-semibold">Waiting for Connection</h2>
          <p className="text-sm text-muted-foreground">
            Open Boreal on another device and tap <strong>Share Over Network</strong>
          </p>
          <div className="flex justify-center gap-1 pt-2">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-2 h-2 rounded-full bg-primary"
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 0.6, delay: i * 0.15, repeat: Infinity }}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <IconShieldCheck className="w-4 h-4 text-green-500" />
        End-to-end encrypted
      </div>
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
      className="flex flex-col items-center gap-6"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
    >
      <Card className="max-w-sm w-full">
        <CardContent className="pt-6 space-y-6">
          <div className="text-center space-y-1">
            <h2 className="text-xl font-semibold">Verify Connection</h2>
            <p className="text-sm text-muted-foreground">
              {deviceName ? `Connected to ${deviceName}` : "Device connected"}
            </p>
          </div>

          {/* Code display */}
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground text-center uppercase tracking-wide">
              Verification Code
            </p>
            <div className="flex gap-2 justify-center">
              {code.split("").map((digit, i) => (
                <motion.div
                  key={i}
                  className="w-12 h-14 bg-muted rounded-lg flex items-center justify-center border border-primary/30"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <span className="text-2xl font-mono font-bold">{digit}</span>
                </motion.div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Confirm this matches the other device
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button variant="outline" onClick={onCancel} className="flex-1">
              <IconX className="w-4 h-4 mr-2" />
              Cancel
            </Button>
            <Button onClick={onConfirm} className="flex-1">
              <IconCheck className="w-4 h-4 mr-2" />
              Confirm
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function TransferringState() {
  return (
    <motion.div
      className="flex flex-col items-center gap-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
      >
        <IconLoader2 className="w-12 h-12 text-primary" />
      </motion.div>

      <Card className="max-w-sm">
        <CardContent className="pt-6 text-center space-y-2">
          <h2 className="text-xl font-semibold">Receiving Vault</h2>
          <p className="text-sm text-muted-foreground">
            Securely transferring encrypted data...
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function SuccessState() {
  return (
    <motion.div
      className="flex flex-col items-center gap-6"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <motion.div
        className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
      >
        <IconCheck className="w-10 h-10 text-green-500" />
      </motion.div>

      <Card className="max-w-sm">
        <CardContent className="pt-6 text-center space-y-2">
          <h2 className="text-xl font-semibold text-green-500">Success!</h2>
          <p className="text-sm text-muted-foreground">Vault imported. Redirecting...</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ErrorState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <motion.div
      className="flex flex-col items-center gap-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="w-20 h-20 rounded-full bg-destructive/20 flex items-center justify-center">
        <IconX className="w-10 h-10 text-destructive" />
      </div>

      <Card className="max-w-sm">
        <CardContent className="pt-6 text-center space-y-4">
          <h2 className="text-xl font-semibold text-destructive">Pairing Failed</h2>
          <p className="text-sm text-muted-foreground">{error || "An error occurred"}</p>
          <Button onClick={onRetry} variant="outline" className="w-full">
            Try Again
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function getSubtitle(state: PairingState): string {
  switch (state) {
    case "listening":
      return "Waiting for another device";
    case "verifying":
      return "Verify the codes match";
    case "transferring":
      return "Receiving vault data";
    case "success":
      return "Vault imported";
    case "error":
      return "Pairing failed";
    default:
      return "Initializing...";
  }
}
