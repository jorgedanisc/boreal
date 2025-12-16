import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { IconPlus, IconDownload, IconLock, IconChevronRight, IconLoader, IconScan } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { getVaults, loadVault, type VaultPublic } from "@/lib/vault";
import { useNavigate } from "@tanstack/react-router";

interface WelcomeStepProps {
  onCreateVault: () => void;
  onImportVault: () => void;
}

const MAX_VISIBLE_VAULTS = 4;

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

  const visibleVaults = vaults.slice(0, MAX_VISIBLE_VAULTS);

  return (
    <div className="flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-8 animate-in fade-in zoom-in duration-500">
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
            {/* Vaults Grid */}
            {vaults.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                      {t("setup.welcome.openVault")}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-5 h-5 text-muted-foreground hover:text-foreground"
                      onClick={() => navigate({ to: "/vaults" })}
                    >
                      <IconChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <ScrollArea className="max-h-[200px]">
                  <div className="grid grid-cols-2 gap-2">
                    {visibleVaults.map((vault) => (
                      <button
                        key={vault.id}
                        onClick={() => handleOpenVault(vault.id)}
                        disabled={!!openLoading}
                        className="flex items-center gap-3 p-3 rounded-xl border bg-card hover:bg-accent/50 hover:border-accent transition-all text-left w-full group"
                      >
                        <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors shrink-0">
                          {openLoading === vault.id ? (
                            <IconLoader className="w-4 h-4 animate-spin" />
                          ) : (
                            <IconLock className="w-4 h-4" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{vault.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{vault.bucket}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
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
                  onClick={() => navigate({ to: "/scan" })}
                >
                  <IconScan className="w-6 h-6" />
                  <span className="font-medium">Scan QR</span>
                </Button>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={onImportVault}
              >
                <IconDownload className="w-4 h-4 mr-2" />
                {t("setup.welcome.importVault")} manually
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
