import { useTranslation } from "react-i18next";
import { IconChevronLeft, IconLoader } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { importVault } from "@/lib/vault";

interface ImportStepProps {
  onBack: () => void;
  onComplete: (vaultCode: string) => void;
}

export function ImportStep({ onBack, onComplete }: ImportStepProps) {
  const { t } = useTranslation();
  const [vaultCode, setVaultCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    if (!vaultCode.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const parsed = JSON.parse(vaultCode);
      if (!parsed.access_key_id || !parsed.secret_access_key || !parsed.bucket || !parsed.region) {
        throw new Error(t("setup.import.error"));
      }

      await importVault(vaultCode);
      onComplete(vaultCode);
    } catch (e: any) {
      setError(e.message || t("setup.import.error"));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="p-4 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <IconChevronLeft className="w-5 h-5" />
        </Button>
        <span className="text-sm text-muted-foreground">
          {t("setup.welcome.importVault.title")}
        </span>
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">{t("setup.import.title")}</h2>
            <p className="text-muted-foreground">
              {t("setup.import.description")}
            </p>
          </div>

          {/* Vault Code Textarea */}
          <div className="space-y-3">
            <Textarea
              value={vaultCode}
              onChange={(e) => setVaultCode(e.target.value)}
              placeholder={t("setup.import.placeholder")}
              className="h-48 font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Type your recovery data manually from your printed Recovery Kit.
            </p>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>

          {/* Continue */}
          <Button
            className="w-full"
            size="lg"
            onClick={handleContinue}
            disabled={!vaultCode.trim() || loading}
          >
            {loading ? (
              <IconLoader className="w-5 h-5 animate-spin" />
            ) : (
              t("setup.import.importButton")
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
