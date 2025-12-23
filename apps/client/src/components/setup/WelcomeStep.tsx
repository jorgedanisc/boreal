import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
// import { IconPlus, IconDownload, IconChevronRight, IconLoader, IconScan, IconWifi } from "@tabler/icons-react";
import Aurora from "@/components/ui/aurora";
import { RenameVaultDialog } from "@/components/vault/RenameVaultDialog";
import { VaultCard } from "@/components/vault/VaultCard";
import { getVaults, loadVault, renameVault, type VaultPublic } from "@/lib/vault";
import { IconChevronRight, IconDownload, IconLoader, IconPlus, IconWifi } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
// import { getDailyQuote } from "@/lib/quotes";
import { ArrowRightIcon, MapIcon, ScanQrCodeIcon, SearchIcon } from "lucide-react";

interface WelcomeStepProps {
  onCreateVault: () => void;
}

const MAX_VISIBLE_VAULTS = 8;

export function WelcomeStep({ onCreateVault }: WelcomeStepProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [vaults, setVaults] = useState<VaultPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [openLoading, setOpenLoading] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);

  // Get deterministic daily quote
  // const dailyQuote = useMemo(() => getDailyQuote(), []);

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
    <div className="flex flex-col items-center justify-center p-6 relative">
      {/* Aurora Background */}
      <div className="fixed inset-x-0 -top-8 h-64 overflow-hidden pointer-events-none opacity-25">
        <Aurora
          colorStops={["#839e9e", "#0B7BF5", "#1f3fad"]}
          blend={1.5}
          amplitude={0.2}
          speed={0.35}
        />
      </div>

      <div className="w-full max-w-lg space-y-8 animate-in fade-in duration-300 mt-10 relative z-10">
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
                    <Button
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => navigate({ to: "/vaults" })}
                    >
                      <p className="text-sm font-medium uppercase tracking-wider">
                        {t("setup.welcome.openVault")}
                      </p>
                      <ArrowRightIcon className="size-3" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => navigate({ to: "/search" })}
                    >
                      <SearchIcon className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => navigate({ to: "/map" })}
                    >
                      <MapIcon className="size-4" />
                    </Button>
                    {/* Only show 'See all' arrow if we are clamping the list */}
                    {vaults.length > MAX_VISIBLE_VAULTS && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 text-muted-foreground hover:text-foreground"
                        onClick={() => navigate({ to: "/vaults" })}
                      >
                        <IconChevronRight className="w-4 h-4 opacity-50" />
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
                    <div className="absolute inset-x-0 -bottom-8 h-24 bg-gradient-to-t from-background via-background/80 to-transparent flex items-center justify-center">
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
            <div className="space-y-4 mt-12">
              {vaults.length > 0 && (
                <Button
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={onCreateVault}
                >
                  <p className="text-sm font-medium uppercase tracking-wider">
                    {t("setup.welcome.newVault")}
                  </p>
                </Button>
              )}

              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={onCreateVault}
                  className="relative overflow-hidden rounded-xl border border-border/50 bg-card/50 px-3 py-4 text-center transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98] hover:border-foreground/20 hover:bg-gradient-to-br hover:from-foreground/10 hover:via-foreground/5 hover:to-transparent"
                >
                  <div className="flex flex-col items-center gap-2">
                    <IconPlus className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                    <span className="font-medium text-xs text-foreground/80 group-hover:text-foreground transition-colors">
                      {t("setup.welcome.createVault")}
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => navigate({ to: "/scan" })}
                  className="relative overflow-hidden rounded-xl border border-border/50 bg-card/50 px-3 py-4 text-center transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98] hover:border-foreground/20 hover:bg-gradient-to-br hover:from-foreground/10 hover:via-foreground/5 hover:to-transparent"
                >
                  <div className="flex flex-col items-center gap-2">
                    <ScanQrCodeIcon className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                    <span className="font-medium text-xs text-foreground/80 group-hover:text-foreground transition-colors">
                      Scan QR
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => navigate({ to: "/pairing" })}
                  className="relative overflow-hidden rounded-xl border border-border/50 bg-card/50 px-3 py-4 text-center transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98] hover:border-foreground/20 hover:bg-gradient-to-br hover:from-foreground/10 hover:via-foreground/5 hover:to-transparent"
                >
                  <div className="flex flex-col items-center gap-2">
                    <IconWifi className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                    <span className="font-medium text-xs text-foreground/80 group-hover:text-foreground transition-colors">
                      Pair Device
                    </span>
                  </div>
                </button>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => navigate({ to: "/import" })}
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
