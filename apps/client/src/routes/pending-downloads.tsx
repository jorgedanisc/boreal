import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { IconClock, IconCheck, IconPhoto, IconArrowLeft, IconArrowUpRight } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { getPendingRestoresForVault, PendingRestore, getVaults, checkOriginalStatus, loadVault } from '@/lib/vault';
import { Button } from '@/components/ui/button';
import { type } from '@tauri-apps/plugin-os';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface PendingRestoreWithVault extends PendingRestore {
  vault_name?: string;
  vault_id: string;
}

export const Route = createFileRoute('/pending-downloads')({
  component: PendingDownloadsPage,
});

function PendingDownloadsPage() {
  const [pendingRestores, setPendingRestores] = useState<PendingRestoreWithVault[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDesktop, setIsDesktop] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const osType = type();
    if (osType === 'linux' || osType === 'macos' || osType === 'windows') {
      setIsDesktop(true);
    }
  }, []);

  useEffect(() => {
    async function fetchPendingRestores() {
      try {
        const vaults = await getVaults();
        const allRestores: PendingRestoreWithVault[] = [];

        for (const vault of vaults) {
          const restores = await getPendingRestoresForVault(vault.id);

          // Check status for each restoring item
          const updatedRestores = await Promise.all(restores.map(async (restore) => {
            if (restore.status === 'restoring') {
              try {
                // Perform a live check
                const status = await checkOriginalStatus(restore.photo_id);
                if (status.status === 'available' || status.status === 'restored' || status.status === 'cached') {
                  return { ...restore, status: 'ready' } as PendingRestore;
                }
              } catch (e) {
                // Ignore
              }
            }
            return restore;
          }));

          for (const restore of updatedRestores) {
            allRestores.push({
              ...restore,
              vault_name: vault.name,
              vault_id: vault.id,
            });
          }
        }

        setPendingRestores(allRestores);
      } catch (e) {
        console.error('Failed to fetch pending restores:', e);
      } finally {
        setIsLoading(false);
      }
    }

    fetchPendingRestores();
  }, []);

  const handleOpenPhoto = async (vaultId: string, photoId: string) => {
    try {
      await loadVault(vaultId);
      navigate({ to: "/gallery", search: { photoId } });
    } catch (e) {
      console.error("Failed to load vault:", e);
      toast.error("Failed to load vault");
    }
  };

  const restoring = pendingRestores.filter(r => r.status === 'restoring');
  const ready = pendingRestores.filter(r => r.status === 'ready');

  return (
    <div className={cn(
      "min-h-dvh bg-background",
      isDesktop ? "pt-8" : "pt-safe"
    )}>
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className={cn(
          "flex items-center gap-4 px-6 py-4",
          isDesktop ? "pl-safe" : "pl-safe"
        )}>
          <Link to="/">
            <Button variant="ghost" size="icon">
              <IconArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold">Pending Downloads</h1>
            <p className="text-sm text-muted-foreground">
              {pendingRestores.length} original{pendingRestores.length !== 1 ? 's' : ''} pending
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 max-w-2xl mx-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : pendingRestores.length === 0 ? (
          <div className="text-center py-12">
            <IconPhoto className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-muted-foreground">No pending downloads</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Ready items first */}
            {ready.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
                  Ready to Download ({ready.length})
                </h3>
                {ready.map((restore) => (
                  <div
                    key={restore.photo_id}
                    className="flex items-center gap-3 p-4 rounded-xl bg-green-500/10 border border-green-500/20 group cursor-pointer hover:bg-green-500/20 transition-colors"
                    onClick={() => handleOpenPhoto(restore.vault_id, restore.photo_id)}
                  >
                    <div className="p-2 rounded-full bg-green-500/20">
                      <IconCheck className="w-4 h-4 text-green-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{restore.filename}</p>
                      <p className="text-xs text-muted-foreground">
                        {restore.vault_name} • {formatBytes(restore.size_bytes)}
                      </p>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <IconArrowUpRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Restoring items */}
            {restoring.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
                  Restoring from Archive ({restoring.length})
                </h3>
                {restoring.map((restore) => (
                  <div
                    key={restore.photo_id}
                    className="flex items-center gap-3 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20"
                  >
                    <div className="p-2 rounded-full bg-yellow-500/20">
                      <IconClock className="w-4 h-4 text-yellow-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{restore.filename}</p>
                      <p className="text-xs text-muted-foreground">
                        {restore.vault_name} • {formatBytes(restore.size_bytes)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {restoring.length > 0 && (
              <p className="text-xs text-muted-foreground text-center mt-4">
                Deep Archive restores typically complete within 12 hours.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number, decimals = 1): string {
  if (!+bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
