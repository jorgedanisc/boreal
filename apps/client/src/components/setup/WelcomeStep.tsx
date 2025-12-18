import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { IconPlus, IconDownload, IconChevronRight, IconLoader, IconScan } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { getVaults, loadVault, type VaultPublic, renameVault } from "@/lib/vault";
import { useNavigate } from "@tanstack/react-router";
import { VaultCard } from "@/components/vault/VaultCard";
import { RenameVaultDialog } from "@/components/vault/RenameVaultDialog";

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
  const [renameId, setRenameId] = useState<string | null>(null);

  useEffect(() => {
    fetchVaults();
  }, []);

  const fetchVaults = () => {
    getVaults()
      .then(setVaults)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const handleRename = async (newName: string) => {
    if (!renameId) return;
    try {
      await renameVault(renameId, newName);
      fetchVaults(); // Refresh list to see new name
    } catch (e) {
      console.error("Failed to rename vault:", e);
    }
  };

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
                    {/* Only show 'See all' arrow if we are clamping the list */}
                    {vaults.length > MAX_VISIBLE_VAULTS && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-5 h-5 text-muted-foreground hover:text-foreground"
                        onClick={() => navigate({ to: "/vaults" })}
                      >
                        <IconChevronRight className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <div className="grid grid-cols-2 gap-2">
                    {/* Show only the first MAX_VISIBLE_VAULTS items fully */}
                    {vaults.slice(0, MAX_VISIBLE_VAULTS).map((vault) => (
                      <VaultCard
                        key={vault.id}
                        vault={vault}
                        openLoading={openLoading}
                        onOpen={handleOpenVault}
                        hideMenu
                        hideBucket
                        showChevron
                      />
                    ))}

                    {/* Render extra items if they exist to create the 'behind' effect, but cover them with gradient */}
                    {vaults.length > MAX_VISIBLE_VAULTS && (
                      <>
                        {/* Render 2 more items to show 'more' exists */}
                        {vaults.slice(MAX_VISIBLE_VAULTS, MAX_VISIBLE_VAULTS + 2).map((vault) => (
                          <div key={vault.id} className="opacity-40 pointer-events-none grayscale">
                            <VaultCard
                              vault={vault}
                              openLoading={null}
                              onOpen={() => { }}
                              hideMenu
                              hideBucket
                              showChevron
                            />
                          </div>
                        ))}
                      </>
                    )}
                  </div>

                  {/* Gradient Overlay & Button if more vaults exist */}
                  {vaults.length > MAX_VISIBLE_VAULTS && (
                    <div className="absolute inset-x-0 -bottom-4 h-24 bg-gradient-to-t from-background via-background/80 to-transparent flex items-center justify-center">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="shadow-sm z-10 font-medium"
                        onClick={() => navigate({ to: "/vaults" })}
                      >
                        View more vaults
                      </Button>
                    </div>
                  )}
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


      <RenameVaultDialog
        open={!!renameId}
        onOpenChange={(open) => !open && setRenameId(null)}
        vaultName={vaults.find(v => v.id === renameId)?.name || ""}
        onConfirm={handleRename}
      />
    </div >
  );
}
