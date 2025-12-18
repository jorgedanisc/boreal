import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getVaults, loadVault, type VaultPublic, renameVault } from "@/lib/vault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { IconArrowLeft, IconSearch, IconLoader } from "@tabler/icons-react";
import { VaultCard } from "@/components/vault/VaultCard";
import { RenameVaultDialog } from "@/components/vault/RenameVaultDialog";

export function VaultsPage() {
  const navigate = useNavigate();
  const [vaults, setVaults] = useState<VaultPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [openLoading, setOpenLoading] = useState<string | null>(null);
  const [search, setSearch] = useState("");
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
      fetchVaults();
      setRenameId(null);
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

  const filteredVaults = vaults.filter(
    (v) =>
      v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.bucket.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col">
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
        <div className="p-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                onOpen={handleOpenVault}
                onRename={setRenameId}
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
    </div>
  );
}
