import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { IconAlertTriangle } from "@tabler/icons-react";
import { authenticateBiometrics } from "@/lib/vault";

interface DeleteVaultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vaultName: string;
  bucketName: string;
  onConfirm: (deleteCloud: boolean) => void;
}

export function DeleteVaultDialog({
  open,
  onOpenChange,
  vaultName,
  bucketName,
  onConfirm,
}: DeleteVaultDialogProps) {
  const [deleteCloud, setDeleteCloud] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      // Authenticate before deleting
      await authenticateBiometrics("Authenticate to delete vault");
      onConfirm(deleteCloud);
      onOpenChange(false);
    } catch (e) {
      console.error("Authentication failed or cancelled", e);
      // Optional: Show error toast/alert
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <IconAlertTriangle className="w-5 h-5" />
            Delete "{vaultName}"?
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>
              This action cannot be undone. This will permanently delete the vault
              and remove it from your device.
            </p>
            <div className="flex items-start gap-2 p-3 border border-destructive/20 bg-destructive/5 rounded-lg">
              <Checkbox
                id="delete-cloud"
                checked={deleteCloud}
                onCheckedChange={(c: boolean | "indeterminate") => setDeleteCloud(!!c)}
                className="mt-1"
              />
              <div className="grid gap-1.5 leading-none">
                <Label
                  htmlFor="delete-cloud"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Also delete AWS resources
                </Label>
                <p className="text-xs text-muted-foreground">
                  This will empty and delete the S3 bucket <span className="font-mono bg-background/50 px-1 rounded truncate max-w-[200px] inline-block align-bottom">{bucketName}</span> associated
                  with this vault. All photos/memories will be lost forever.
                </p>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault(); // Prevent auto-close
              handleConfirm();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={loading}
          >
            {loading ? "Verifying..." : "Delete Vault"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
