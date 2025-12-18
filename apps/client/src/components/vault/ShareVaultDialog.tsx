import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createExportQr, exportVault, authenticateBiometrics } from "@/lib/vault";
import { IconCheck, IconCopy, IconPrinter, IconQrcode, IconDevices } from "@tabler/icons-react";
import { useState } from "react";
import QRCode from "react-qr-code";
import { RecoveryKit } from "./RecoveryKit";
import { Spinner } from "@/components/ui/spinner";
import { PrintPortal } from "@/components/ui/print-portal";
import { NetworkShareDialog } from "./NetworkShareDialog";

interface ShareVaultDialogProps {
  vaultId: string;
  trigger?: React.ReactNode;
}

export function ShareVaultDialog({ vaultId, trigger }: ShareVaultDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exportData, setExportData] = useState<{ qr_url: string; pin: string } | null>(null);

  // Data for printing only
  const [recoveryCode, setRecoveryCode] = useState<string>("");
  const [printing, setPrinting] = useState(false);

  const [copied, setCopied] = useState(false);
  const [showNetworkShare, setShowNetworkShare] = useState(false);

  const generateCode = async () => {
    setLoading(true);
    try {
      const data = await createExportQr(vaultId);
      setExportData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open && !exportData) {
      generateCode();
    }
  };

  const handleCopy = async () => {
    if (exportData) {
      await navigator.clipboard.writeText(exportData.qr_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handlePrint = async () => {
    if (!exportData) return;
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

          <div className="flex flex-col items-center py-4 space-y-5">
            {loading ? (
              <div className="flex flex-col items-center gap-2 py-8">
                <Spinner className="w-6 h-6 text-primary" />
                <p className="text-xs text-muted-foreground">Generating credentials...</p>
              </div>
            ) : exportData ? (
              <>
                {/* QR Code */}
                <div className="bg-white p-3 rounded-xl">
                  <QRCode
                    value={exportData.qr_url}
                    size={160}
                    level="L"
                  />
                </div>

                {/* PIN Display */}
                <div className="text-center space-y-1">
                  <p className="text-[10px] uppercase text-muted-foreground/60 tracking-wider">
                    Pairing PIN
                  </p>
                  <p className="text-2xl font-mono font-bold tracking-[0.15em]">
                    {exportData.pin}
                  </p>
                </div>

                {/* Divider */}
                <div className="relative flex items-center w-full max-w-[200px]">
                  <div className="flex-1 border-t border-border/50" />
                  <span className="px-2 text-[10px] text-muted-foreground/60 uppercase">Or</span>
                  <div className="flex-1 border-t border-border/50" />
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col gap-2 w-full max-w-[200px]">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2 h-9 text-xs"
                    onClick={() => setShowNetworkShare(true)}
                  >
                    <IconDevices className="w-3.5 h-3.5" />
                    Share Over Network
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2 h-9 text-xs"
                    onClick={handleCopy}
                  >
                    {copied ? <IconCheck className="w-3.5 h-3.5" /> : <IconCopy className="w-3.5 h-3.5" />}
                    {copied ? "Copied" : "Copy Link"}
                  </Button>

                  <div className="pt-2 space-y-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full gap-2 h-8 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
                      onClick={handlePrint}
                      disabled={printing}
                    >
                      {printing ? <Spinner className="w-3.5 h-3.5" /> : <IconPrinter className="w-3.5 h-3.5" />}
                      Print Recovery Kit
                    </Button>
                    <p className="text-[9px] text-center text-muted-foreground/50 leading-tight">
                      Contains sensitive recovery data
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-destructive">Failed to generate QR code</p>
            )}
          </div>
        </DialogContent>
      </Dialog >

      {/* Hidden Recovery Kit for Printing */}
      {
        exportData && (
          <PrintPortal>
            <RecoveryKit
              vaultName="My Boreal Vault"
              rawCode={recoveryCode || "Loading..."}
            />
          </PrintPortal>
        )
      }

      {/* Network Share Dialog */}
      <NetworkShareDialog
        open={showNetworkShare}
        onOpenChange={setShowNetworkShare}
        vaultId={vaultId}
      />
    </>
  );
}
