import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getVaults, loadVault, type VaultPublic, renameVault, deleteVault } from "@/lib/vault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { IconArrowLeft, IconSearch, IconLoader } from "@tabler/icons-react";
import { VaultCard } from "@/components/vault/VaultCard";
import { RenameVaultDialog } from "@/components/vault/RenameVaultDialog";
import { DeleteVaultDialog } from "@/components/vault/DeleteVaultDialog";
import { type } from "@tauri-apps/plugin-os";
import { cn } from "@/lib/utils";

export function VaultsPage() {
  const navigate = useNavigate();
  const [vaults, setVaults] = useState<VaultPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [openLoading, setOpenLoading] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const osType = type();
    if (osType === 'linux' || osType === 'macos' || osType === 'windows') {
      setIsDesktop(true);
    }
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
      fetchVaults();
      setRenameId(null);
    } catch (e) {
      console.error("Failed to rename vault:", e);
    }
  };

  const handleDelete = async (deleteCloud: boolean) => {
    if (!deleteId) return;
    try {
      await deleteVault(deleteId, deleteCloud);
      fetchVaults();
      setDeleteId(null);
    } catch (e) {
      console.error("Failed to delete vault:", e);
      alert("Failed to delete vault: " + String(e));
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

  const filteredVaults = vaults.filter(
    (v) =>
      v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.bucket.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className={cn(
      "flex flex-col",
      isDesktop ? "pt-8" : "pt-0",
    )}>
      {/* Header */}
      <header className="p-4 border-b flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/" })}>
          <IconArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="font-semibold text-lg">All Vaults</h1>
      </header>

      {/* Search */}
      <div className="p-4 border-b">
        <div className="relative">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search vaults..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Vault List */}
      <ScrollArea className="flex-1">
        <div className="p-4 grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {loading ? (
            <div className="col-span-full py-12 flex justify-center">
              <IconLoader className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredVaults.length === 0 ? (
            <div className="col-span-full py-12 text-center text-muted-foreground">
              {search ? "No vaults match your search" : "No vaults"}
            </div>
          ) : (
            filteredVaults.map((vault) => (
              <VaultCard
                key={vault.id}
                vault={vault}
                openLoading={openLoading}
                hideMenu={false}
                onOpen={handleOpenVault}
                onRename={setRenameId}
                onDelete={setDeleteId}
              />
            ))
          )}
        </div>
      </ScrollArea>

      <RenameVaultDialog
        open={!!renameId}
        onOpenChange={(open) => !open && setRenameId(null)}
        vaultName={vaults.find(v => v.id === renameId)?.name || ""}
        onConfirm={handleRename}
      />

      <DeleteVaultDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        vaultName={vaults.find(v => v.id === deleteId)?.name || ""}
        onConfirm={handleDelete}
      />
    </div>
  );
}
