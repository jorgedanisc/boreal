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
            <Button
              variant="outline"
              className="h-auto py-3 px-4 justify-start gap-3 hover:bg-primary/5 hover:text-primary border-primary/20 group"
              onClick={() => {
                setIsOpen(false);
                navigate({ to: "/qr-export/$vaultId", params: { vaultId } });
              }}
            >
              <div className="p-2 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
                <IconQrcode className="w-5 h-5 text-primary" />
              </div>
              <div className="flex flex-col items-start gap-0.5">
                <span className="text-sm font-medium">Export via QR Code</span>
                <span className="text-[10px] text-muted-foreground">Scan on another device to transfer</span>
              </div>
            </Button>

            {/* Network Share */}
            <Button
              variant="outline"
              className="h-auto py-3 px-4 justify-start gap-3 hover:bg-blue-500/5 hover:text-blue-500 border-blue-500/20 group"
              onClick={() => setShowNetworkShare(true)}
            >
              <div className="p-2 bg-blue-500/10 rounded-lg group-hover:bg-blue-500/20 transition-colors">
                <IconDevices className="w-5 h-5 text-blue-500" />
              </div>
              <div className="flex flex-col items-start gap-0.5">
                <span className="text-sm font-medium">Share over Network</span>
                <span className="text-[10px] text-muted-foreground">Pair devices on same Wi-Fi</span>
              </div>
            </Button>

            {/* Recovery Kit - Separator */}
            <div className="relative flex items-center w-full py-2">
              <div className="flex-1 border-t border-border/50" />
              <span className="px-2 text-[10px] text-muted-foreground/50 uppercase">Backup</span>
              <div className="flex-1 border-t border-border/50" />
            </div>

            {/* Print Recovery Kit */}
            <div className="space-y-2">
              <Button
                variant="ghost"
                className="w-full h-auto py-3 px-4 justify-start gap-3 hover:bg-amber-500/5 hover:text-amber-600 group"
                onClick={handlePrint}
                disabled={printing}
              >
                <div className="p-2 bg-amber-500/10 rounded-lg group-hover:bg-amber-500/20 transition-colors">
                  {printing ? <Spinner className="w-5 h-5 text-amber-600" /> : <IconPrinter className="w-5 h-5 text-amber-600" />}
                </div>
                <div className="flex flex-col items-start gap-0.5">
                  <span className="text-sm font-medium">Print Recovery Kit</span>
                  <span className="text-[10px] text-muted-foreground">Paper backup for emergencies</span>
                </div>
              </Button>
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
