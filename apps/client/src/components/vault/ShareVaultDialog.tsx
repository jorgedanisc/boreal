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
import { IconCheck, IconCopy, IconPrinter, IconQrcode, IconWifi } from "@tabler/icons-react";
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

        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share Vault</DialogTitle>
            <DialogDescription>
              Use the QR code or link to transfer this vault to another device.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center justify-center p-6 space-y-6">
            {loading ? (
              <div className="flex flex-col items-center gap-2">
                <Spinner className="w-8 h-8 text-primary" />
                <p className="text-sm text-muted-foreground">Generating secure credentials...</p>
              </div>
            ) : exportData ? (
              <>
                <div className="bg-white p-4 rounded-xl border shadow-sm relative group">
                  <QRCode
                    value={exportData.qr_url}
                    size={200}
                    level="L"
                  />
                  {/* Overlay for screenshot protection visual cue? No, Argon2 protects us. */}
                </div>

                {/* Constrain width to match QR Code (approx 200px + padding) */}
                <div className="w-[240px] space-y-6">
                  <div className="bg-muted/50 p-4 rounded-lg border text-center space-y-1">
                    <p className="text-xs uppercase text-muted-foreground font-semibold tracking-wider">Pairing PIN</p>
                    <p className="text-3xl font-mono font-bold tracking-[0.2em] text-foreground">
                      {exportData.pin}
                    </p>
                  </div>

                  <div className="relative flex items-center justify-center">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-gray-200" />
                    </div>
                    <span className="relative z-10 bg-background px-2 text-xs text-muted-foreground uppercase font-medium">
                      Or
                    </span>
                  </div>

                  <div className="flex flex-col gap-3">
                    <Button
                      variant="outline"
                      className="w-full gap-2"
                      onClick={() => setShowNetworkShare(true)}
                    >
                      <IconWifi className="w-4 h-4" />
                      Share Over Network
                    </Button>

                    <Button
                      variant="outline"
                      className="w-full gap-2"
                      onClick={handleCopy}
                    >
                      {copied ? <IconCheck className="w-4 h-4" /> : <IconCopy className="w-4 h-4" />}
                      {copied ? "Copied Link" : "Copy Secure Link"}
                    </Button>

                    <div className="space-y-2">
                      <Button
                        variant="secondary"
                        className="w-full gap-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 border-amber-200/50 dark:border-amber-800/50 border"
                        onClick={handlePrint}
                        disabled={printing}
                      >
                        {printing ? <Spinner className="w-4 h-4" /> : <IconPrinter className="w-4 h-4" />}
                        Print Recovery Kit
                      </Button>
                      <p className="text-[10px] text-center text-muted-foreground/60 leading-tight px-1">
                        Only download if absolutely necessary. Contains sensitive recovery data.
                      </p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-red-500">Failed to generate QR code</p>
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
