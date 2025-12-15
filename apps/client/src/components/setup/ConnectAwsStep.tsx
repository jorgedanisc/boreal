import { useTranslation } from "react-i18next";
import { IconChevronLeft, IconExternalLink, IconCheck, IconCopy, IconLoader } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getCloudFormationQuickCreateUrl, type StorageTier } from "@/lib/aws-config";
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

interface ConnectAwsStepProps {
  region: string;
  tier: StorageTier;
  onBack: () => void;
  onComplete: (vaultCode: string) => void;
}

export function ConnectAwsStep({ region, tier, onBack, onComplete }: ConnectAwsStepProps) {
  const { t } = useTranslation();
  const [vaultCode, setVaultCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consoleOpened, setConsoleOpened] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);

  const cfnUrl = getCloudFormationQuickCreateUrl(region, tier);

  const handleOpenConsole = async () => {
    try {
      await openUrl(cfnUrl);
      setConsoleOpened(true);
    } catch (e) {
      console.error("Failed to open browser:", e);
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(cfnUrl);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy URL:", e);
    }
  };

  const handleContinue = async () => {
    if (!vaultCode.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const parsed = JSON.parse(vaultCode);
      if (!parsed.access_key_id || !parsed.secret_access_key || !parsed.bucket || !parsed.region) {
        throw new Error(t("setup.connectAws.vaultCode.error"));
      }
      onComplete(vaultCode);
    } catch (e: any) {
      setError(e.message || t("setup.connectAws.vaultCode.error"));
      setLoading(false);
    }
  };

  const steps = [
    t("setup.connectAws.steps.1"),
    t("setup.connectAws.steps.2"),
    t("setup.connectAws.steps.3"),
    t("setup.connectAws.steps.4"),
    t("setup.connectAws.steps.5"),
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="p-4 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <IconChevronLeft className="w-5 h-5" />
        </Button>
        <span className="text-sm text-muted-foreground">
          {t("setup.connectAws.step")}
        </span>
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md space-y-8">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">{t("setup.connectAws.title")}</h2>
            <p className="text-muted-foreground">
              {t("setup.connectAws.description")}
            </p>
          </div>

          {/* Steps */}
          <div className="space-y-3">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 text-sm font-medium">
                  {i + 1}
                </div>
                <p className="text-sm text-muted-foreground pt-0.5">{step}</p>
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-row gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleOpenConsole}
            >
              {consoleOpened ? (
                <>
                  <IconCheck className="w-5 h-5 text-green-500" />
                  {t("setup.connectAws.consoleOpened")}
                </>
              ) : (
                <>
                  <IconExternalLink className="w-5 h-5" />
                  {t("setup.connectAws.openConsole")}
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopyUrl}
            >
              {urlCopied ? (
                <IconCheck className="w-5 h-5 text-green-500" />
              ) : (
                <IconCopy className="w-5 h-5" />
              )}
            </Button>
          </div>

          {/* Vault Code Input */}
          <div className="space-y-3">
            <Label>{t("setup.connectAws.vaultCode.label")}</Label>
            <Textarea
              value={vaultCode}
              onChange={(e) => setVaultCode(e.target.value)}
              placeholder={t("setup.connectAws.vaultCode.placeholder")}
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
              t("setup.connectAws.completeSetup")
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
