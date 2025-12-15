import { useTranslation } from "react-i18next";
import { IconChevronLeft, IconUpload, IconFile, IconLoader } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
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
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFilePicker = async () => {
    try {
      const file = await open({
        multiple: false,
        filters: [{
          name: 'Vault Files',
          extensions: ['json', 'boreal']
        }]
      });

      if (file) {
        const content = await readTextFile(file);
        setVaultCode(content);
        setFileName(file.split('/').pop() || 'vault.json');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleContinue = async () => {
    if (!vaultCode.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const parsed = JSON.parse(vaultCode);
      if (!parsed.access_key_id || !parsed.secret_access_key || !parsed.bucket || !parsed.region) {
        throw new Error(t("setup.import.error"));
      }

      // Import the vault
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
        <div className="w-full max-w-md space-y-8">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">{t("setup.import.title")}</h2>
            <p className="text-muted-foreground">
              {t("setup.import.description")}
            </p>
          </div>

          {/* File Picker */}
          <button
            onClick={handleFilePicker}
            className="w-full flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-border rounded-2xl hover:border-primary/50 hover:bg-muted/50 transition-all"
          >
            {fileName ? (
              <>
                <IconFile className="w-10 h-10 text-primary" />
                <span className="font-medium">{fileName}</span>
                <span className="text-sm text-muted-foreground">
                  {t("setup.import.changeFile")}
                </span>
              </>
            ) : (
              <>
                <IconUpload className="w-10 h-10 text-muted-foreground" />
                <span className="font-medium">{t("setup.import.selectFile")}</span>
                <span className="text-sm text-muted-foreground">
                  {t("setup.import.fileTypes")}
                </span>
              </>
            )}
          </button>

          <div className="flex items-center gap-4">
            <Separator className="flex-1" />
            <span className="text-sm text-muted-foreground">{t("setup.import.orPaste")}</span>
            <Separator className="flex-1" />
          </div>

          {/* Vault Code Textarea */}
          <div className="space-y-3">
            <Textarea
              value={vaultCode}
              onChange={(e) => {
                setVaultCode(e.target.value);
                setFileName(null);
              }}
              placeholder={t("setup.import.placeholder")}
              className="h-32 font-mono text-sm"
            />
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
