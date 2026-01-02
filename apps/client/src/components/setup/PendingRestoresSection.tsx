import { Button } from '@/components/ui/button';
import { checkOriginalStatus, getPendingRestoresForVault, getVaults, PendingRestore, VaultPublic } from '@/lib/vault';
import { IconArrowUpRight, IconCheck, IconCircleDotted, IconClock, IconPhoto } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

interface PendingRestoreWithVault extends PendingRestore {
  vault_name?: string;
  vault_id: string;
}

const MAX_VISIBLE_RESTORES = 5;

interface PendingRestoresSectionProps {
  onOpenPhoto?: (vaultId: string, photoId: string) => void;
}

export function PendingRestoresSection({ onOpenPhoto }: PendingRestoresSectionProps) {
  const [pendingRestores, setPendingRestores] = useState<PendingRestoreWithVault[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchPendingRestores() {
      try {
        const vaults = await getVaults();
        const allRestores: PendingRestoreWithVault[] = [];

        // Fetch pending restores for all vaults
        for (const vault of vaults) {
          const restores = await getPendingRestoresForVault(vault.id);

          // Check status for each restoring item
          const updatedRestores = await Promise.all(restores.map(async (restore) => {
            if (restore.status === 'restoring') {
              try {
                // Perform a live check (HEAD request via backend)
                const status = await checkOriginalStatus(restore.photo_id);
                if (status.status === 'available' || status.status === 'restored' || status.status === 'cached') {

                  // If it's ready, return updated object
                  return { ...restore, status: 'ready' } as PendingRestore;
                }
              } catch (e) {
                // Ignore errors, keep original status
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

  if (isLoading || pendingRestores.length === 0) {
    return null; // Don't show section if no pending restores
  }

  const restoring = pendingRestores.filter(r => r.status === 'restoring');
  const ready = pendingRestores.filter(r => r.status === 'ready');

  // Combine ready first, then restoring, and limit to MAX_VISIBLE_RESTORES
  const allItems = [...ready, ...restoring];
  const visibleItems = allItems.slice(0, MAX_VISIBLE_RESTORES);
  const hasMore = allItems.length > MAX_VISIBLE_RESTORES;

  return (
    <div className="space-y-3">
      {/* Section Header - Matching vault section style */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Link to="/pending-downloads">
            <Button
              variant="ghost"
              className="text-muted-foreground"
            >
              <p className="text-sm font-medium uppercase tracking-wider">
                Pending Downloads
              </p>
            </Button>
          </Link>
        </div>
      </div>

      {/* Items Container */}
      <div className="relative">
        <div className="space-y-2">
          {visibleItems.map((restore) => {
            const isReady = restore.status === 'ready';
            return (
              <div
                key={restore.photo_id}
                className={`flex items-center gap-3 p-3 rounded-lg backdrop-blur-xl ${isReady
                  ? 'bg-green-500/10 border border-green-500/20 group cursor-pointer hover:bg-green-500/20 transition-colors'
                  : 'bg-yellow-500/10 border border-yellow-500/20'
                  }`}
                onClick={() => {
                  if (isReady && onOpenPhoto) {
                    onOpenPhoto(restore.vault_id, restore.photo_id);
                  }
                }}
              >
                <div className={`p-2 relative rounded-full ${isReady ? 'bg-green-500/20' : 'bg-yellow-500/20'}`}>
                  {isReady
                    ? <IconCheck className="w-4 h-4 text-green-500" />
                    : <IconClock className="w-4 h-4 text-yellow-500" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{restore.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {isReady ? 'Ready to download' : 'Restoring...'} • {formatBytes(restore.size_bytes)}
                  </p>
                </div>
                {isReady && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <IconArrowUpRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Gradient Overlay & Button if more items exist */}
        {hasMore && (
          <div className="absolute inset-x-0 -bottom-2 h-20 bg-linear-to-t from-background via-background/80 to-transparent flex items-end justify-center pb-2">
            <Link to="/pending-downloads">
              <Button
                variant="secondary"
                size="sm"
                className="shadow-sm font-medium"
              >
                View {allItems.length - MAX_VISIBLE_RESTORES} more
              </Button>
            </Link>
          </div>
        )}
      </div>

      {restoring.length > 0 && !hasMore && (
        <p className="text-[10px] text-muted-foreground">
          Deep Archive restores typically complete within 12 hours.
        </p>
      )}
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
