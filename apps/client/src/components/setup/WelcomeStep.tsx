import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { IconPlus, IconDownload, IconLock, IconChevronRight, IconLoader } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { getVaults, loadVault, type VaultPublic } from "@/lib/vault";
import { useNavigate } from "@tanstack/react-router";

interface WelcomeStepProps {
  onCreateVault: () => void;
  onImportVault: () => void;
}

export function WelcomeStep({ onCreateVault, onImportVault }: WelcomeStepProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [vaults, setVaults] = useState<VaultPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [openLoading, setOpenLoading] = useState<string | null>(null);

  useEffect(() => {
    getVaults()
      .then(setVaults)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleOpenVault = async (id: string) => {
    setOpenLoading(id);
    try {
      await loadVault(id);
      navigate({ to: "/gallery" });
    } catch (e) {
      console.error("Failed to load vault:", e);
      setOpenLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8 animate-in fade-in zoom-in duration-500">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-br from-foreground to-muted-foreground bg-clip-text text-transparent">
            {t("app.name")}
          </h1>
          <p className="text-muted-foreground text-lg">
            {t("setup.welcome.subtitle")}
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center p-8">
            <IconLoader className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Existing Vaults List */}
            {vaults.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider px-1">
                  {t("setup.welcome.openVault")}
                </p>
                <div className="grid gap-2">
                  {vaults.map((vault) => (
                    <button
                      key={vault.id}
                      onClick={() => handleOpenVault(vault.id)}
                      disabled={!!openLoading}
                      className="flex items-center gap-4 p-4 rounded-xl border bg-card hover:bg-accent/50 hover:border-accent transition-all text-left w-full group"
                    >
                      <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        {openLoading === vault.id ? (
                          <IconLoader className="w-5 h-5 animate-spin" />
                        ) : (
                          <IconLock className="w-5 h-5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{vault.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{vault.bucket}</p>
                      </div>
                      <IconChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="space-y-3">
              {vaults.length > 0 && (
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider px-1 pt-2">
                  {t("setup.welcome.newVault")}
                </p>
              )}

              <div className="grid grid-cols-2 gap-4">
                <Button
                  variant="outline"
                  className="h-auto py-6 flex flex-col gap-2 hover:border-primary/50 hover:bg-muted/50"
                  onClick={onCreateVault}
                >
                  <IconPlus className="w-6 h-6" />
                  <span className="font-medium">{t("setup.welcome.createVault")}</span>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto py-6 flex flex-col gap-2 hover:border-primary/50 hover:bg-muted/50"
                  onClick={onImportVault}
                >
                  <IconDownload className="w-6 h-6" />
                  <span className="font-medium">{t("setup.welcome.importVault")}</span>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
