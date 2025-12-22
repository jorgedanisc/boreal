import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { IconPrinter, IconQrcode, IconDevices, IconShieldLock } from "@tabler/icons-react";
import { useState } from "react";
import { RecoveryKit } from "./RecoveryKit";
import { Spinner } from "@/components/ui/spinner";
import { PrintPortal } from "@/components/ui/print-portal";
import { NetworkShareDialog } from "./NetworkShareDialog";

import { useNavigate } from "@tanstack/react-router";
import { exportVault, authenticateBiometrics } from "@/lib/vault";

interface ShareVaultDialogProps {
  vaultId: string;
  trigger?: React.ReactNode;
}

export function ShareVaultDialog({ vaultId, trigger }: ShareVaultDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  // Data for printing only
  const [recoveryCode, setRecoveryCode] = useState<string>("");
  const [printing, setPrinting] = useState(false);
  const [showNetworkShare, setShowNetworkShare] = useState(false);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
  };

  const handlePrint = async () => {
    // if (!exportData) return; // Removed logic
    setPrinting(true);
    try {
      // 1. Enforce Biometric/Password Authentication
      try {
        await authenticateBiometrics("Authorize to print Recovery Kit");
      } catch (e) {
        alert("Authentication required. Cannot print recovery kit.");
        setPrinting(false);
        return;
      }

      // 2. Fetch data (Raw Vault Data)
      if (!recoveryCode) {
        const code = await exportVault(vaultId);
        setRecoveryCode(code);
      }

      // 3. Print
      setTimeout(() => {
        const originalTitle = document.title;
        document.title = "Boreal Recovery Kit"; // This sets the default PDF filename

        window.print();

        document.title = originalTitle;
        setPrinting(false);
      }, 500);
    } catch (e) {
      console.error("Failed to prepare print", e);
      setPrinting(false);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="outline" size="sm" className="gap-2">
              <IconQrcode className="w-4 h-4" />
              Share / Backup
            </Button>
          )}
        </DialogTrigger>

        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-medium">Share Vault</DialogTitle>
            <DialogDescription className="text-xs">
              Transfer this vault to another device
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-4">
            {/* New QR Export Flow */}
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                navigate({ to: "/qr-export/$vaultId", params: { vaultId } });
              }}
              className="relative overflow-hidden rounded-xl border border-border/50 bg-card/50 px-3 py-4 text-left transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98] hover:border-foreground/20 hover:bg-linear-to-br hover:from-foreground/10 hover:via-foreground/5 hover:to-transparent"
            >
              <div className="flex items-start gap-4">
                <div className="p-2 bg-blue-500/10 rounded-lg group-hover:bg-blue-500/20 transition-colors shrink-0">
                  <IconQrcode className="w-5 h-5 text-blue-500" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground transition-colors">Export via QR Code</span>
                  <span className="text-[10px] text-muted-foreground group-hover:text-foreground/60 transition-colors">Scan on another device to transfer</span>
                </div>
              </div>
            </button>

            {/* Network Share */}
            <button
              type="button"
              onClick={() => setShowNetworkShare(true)}
              className="relative overflow-hidden rounded-xl border border-border/50 bg-card/50 px-3 py-4 text-left transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98] hover:border-foreground/20 hover:bg-linear-to-br hover:from-foreground/10 hover:via-foreground/5 hover:to-transparent"
            >
              <div className="flex items-start gap-4">
                <div className="p-2 bg-blue-500/10 rounded-lg group-hover:bg-blue-500/20 transition-colors shrink-0">
                  <IconDevices className="w-5 h-5 text-blue-500" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground transition-colors">Share over Network</span>
                  <span className="text-[10px] text-muted-foreground group-hover:text-foreground/60 transition-colors">Pair devices on same Wi-Fi</span>
                </div>
              </div>
            </button>

            {/* Recovery Kit - Separator */}
            <div className="relative flex items-center w-full py-2">
              <div className="flex-1 border-t border-border/50" />
              <span className="px-2 text-[10px] text-muted-foreground/50 uppercase">Backup</span>
              <div className="flex-1 border-t border-border/50" />
            </div>

            {/* Print Recovery Kit */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={handlePrint}
                disabled={printing}
                className="w-full relative overflow-hidden rounded-xl border border-border/50 bg-card/50 px-3 py-4 text-left transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98] hover:border-foreground/20 hover:bg-linear-to-br hover:from-amber-500/10 hover:via-amber-500/5 hover:to-transparent disabled:opacity-50 disabled:pointer-events-none"
              >
                <div className="flex items-start gap-4">
                  <div className="p-2 bg-amber-500/10 rounded-lg group-hover:bg-amber-500/20 transition-colors shrink-0">
                    {printing ? <Spinner className="w-5 h-5 text-amber-600" /> : <IconPrinter className="w-5 h-5 text-amber-600" />}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground transition-colors">Print Recovery Kit</span>
                    <span className="text-[10px] text-muted-foreground group-hover:text-foreground/60 transition-colors">Paper backup for emergencies</span>
                  </div>
                </div>
              </button>
              <p className="text-[9px] text-center text-muted-foreground/40 px-4">
                Contains your full vault access key. Store securely offline.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog >

      {/* Hidden Recovery Kit for Printing */}
      {/* Hidden Recovery Kit for Printing */}
      <PrintPortal>
        <RecoveryKit
          vaultName="My Boreal Vault"
          rawCode={recoveryCode || "Loading..."}
        />
      </PrintPortal>

      {/* Network Share Dialog */}
      <NetworkShareDialog
        open={showNetworkShare}
        onOpenChange={setShowNetworkShare}
        vaultId={vaultId}
      />
    </>
  );
}
