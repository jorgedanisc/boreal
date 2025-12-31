import { GalleryBottomNav } from '@/components/GalleryBottomNav';
import { MemoryEditor } from '@/components/memories/MemoryEditor';
import { Button } from '@/components/ui/button';
import { MultipleFileUploader } from '@/components/upload/MultipleFileUploader';
import { UploadTrigger } from '@/components/upload/UploadTrigger';
import { RenameVaultDialog } from '@/components/vault/RenameVaultDialog';
import { ShareVaultDialog } from '@/components/vault/ShareVaultDialog';
import { getActiveVault, renameVault, VaultPublic } from '@/lib/vault';
import { IconShare3, IconUpload } from '@tabler/icons-react';
import { createFileRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { type } from '@tauri-apps/plugin-os';
import { ChevronLeft, Plus, Share2Icon, ShareIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';

export const Route = createFileRoute('/gallery')({
  component: GalleryLayout,
});

// Context for child routes to update header subtitle (e.g., date label)
interface GalleryLayoutContextType {
  setSubtitle: (subtitle: string) => void;
  onMemorySaved: () => void;
}

const GalleryLayoutContext = createContext<GalleryLayoutContextType | null>(null);

export function useGalleryLayout() {
  const ctx = useContext(GalleryLayoutContext);
  // Return dummy context if missing to prevent crash during route transitions or incorrect nesting
  if (!ctx) {
    console.warn('useGalleryLayout called outside provider');
    return { setSubtitle: () => { }, onMemorySaved: () => { } };
  }
  return ctx;
}

function GalleryLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const [isMemoryEditorOpen, setIsMemoryEditorOpen] = useState(false);
  const [activeVault, setActiveVault] = useState<VaultPublic | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [subtitle, setSubtitle] = useState('Timeline');
  const [_, setMemorySavedCounter] = useState(0);
  const [renameOpen, setRenameOpen] = useState(false);

  const triggerMemoryRefresh = () => {
    setMemorySavedCounter(c => c + 1);
    window.dispatchEvent(new CustomEvent('memory-saved'));
  };

  // Determine current view based on path
  let currentView: 'gallery' | 'memories' | 'map' = 'gallery';
  const isMemoriesListView = location.pathname === '/gallery/memories' || location.pathname === '/gallery/memories/';
  const isMemoryDetailView = location.pathname.startsWith('/gallery/memories/') && location.pathname !== '/gallery/memories/';
  const isMemoriesView = isMemoriesListView || isMemoryDetailView;
  // const isGalleryView = location.pathname === '/gallery' || location.pathname === '/gallery/';

  if (isMemoriesView) {
    currentView = 'memories';
  } else if (location.pathname.includes('/map')) {
    currentView = 'map';
  }

  useEffect(() => {
    const osType = type();
    if (osType === 'linux' || osType === 'macos' || osType === 'windows') {
      setIsDesktop(true);
    }

    // Load vault info for header
    getActiveVault().then(v => setActiveVault(v)).catch(() => { });
  }, []);

  // Reset subtitle when navigating between views
  // Both Gallery and Memories pages will set their own date-based subtitle via context
  useEffect(() => {
    // Let child routes handle their own subtitles
  }, [location.pathname]);

  const openMemoryEditor = () => setIsMemoryEditorOpen(true);

  // Detail pages (like /gallery/memories/:id) need their own header
  const showSharedHeader = !isMemoryDetailView;
  const showBottomNav = !isMemoryDetailView;

  return (
    <GalleryLayoutContext.Provider value={{ setSubtitle, onMemorySaved: triggerMemoryRefresh }}>
      <div className="relative text-foreground flex flex-col h-screen overflow-hidden">
        {/* Shared Header */}
        {showSharedHeader && (
          <header
            className="absolute top-0 left-0 right-0 z-30 pointer-events-none"
            style={{ paddingTop: isDesktop ? "32px" : "env(safe-area-inset-top)" }}
          >
            <div
              className="fixed w-dvw top-0 left-0 right-0 pointer-events-none z-5"
              style={{
                background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.55) 25%, rgba(0, 0, 0, 0.4) 45%, rgba(0, 0, 0, 0.25) 60%, rgba(0, 0, 0, 0.12) 75%, rgba(0, 0, 0, 0.04) 88%, transparent 100%)',
                height: isDesktop ? 'calc(32px + 160px)' : 'calc(env(safe-area-inset-top) + 160px)',
              }}
            />
            <div className="relative flex items-start justify-between mx-3 px-3 pt-4 pb-2 pl-safe pr-safe pointer-events-auto z-10">
              <div className="flex flex-col">
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigate({ to: "/" })}
                    className="shrink-0 h-8 w-8"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </Button>
                  <button
                    onClick={() => activeVault && setRenameOpen(true)}
                    className="text-xl font-medium tracking-tight px-2 py-0.5 rounded-md hover:bg-muted/50 transition-colors text-left"
                  >
                    {activeVault?.name || "Photos"}
                  </button>
                </div>
                <p className="text-sm font-medium text-muted-foreground/70 ml-10">
                  {subtitle}
                </p>
              </div>

              {/* Top Right: Actions */}
              <div className="flex items-center gap-3">
                <UploadTrigger>
                  <Button variant="glass" className="rounded-full px-3 pr-4 font">
                    <IconUpload className="size-4 mr-1" />
                    Upload
                  </Button>
                </UploadTrigger>

                {activeVault && (
                  <ShareVaultDialog
                    vaultId={activeVault.id}
                    trigger={
                      <Button variant="glass" className="size-9 p-0 rounded-full">
                        <IconShare3 className="size-4 text-foreground" />
                      </Button>
                    }
                  />
                )}
              </div>
            </div>
          </header>
        )}

        {/* Child Route Content */}
        <Outlet />

        {/* Bottom Navigation + FAB for Memories */}
        {showBottomNav && (
          <div className="fixed bottom-0 left-0 right-0 pb-safe z-40 pointer-events-none">
            {/* Nav is centered, plus button is positioned absolutely to the right. Use pointer-events-auto for children. */}
            <div className="relative bottom-2 flex justify-center w-full pointer-events-auto">
              <div className="relative">
                <GalleryBottomNav currentView={currentView} />

                {isMemoriesListView && (
                  <Button
                    onClick={openMemoryEditor}
                    size="icon"
                    className="absolute left-full ml-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-xl hover:bg-primary/90 backdrop-blur-3xl transition-all"
                  >
                    <Plus className="size-5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Memory Editor Drawer */}
        <MemoryEditor
          open={isMemoryEditorOpen}
          onOpenChange={setIsMemoryEditorOpen}
          onSave={triggerMemoryRefresh}
        />

        {/* Rename Vault Dialog */}
        {activeVault && (
          <RenameVaultDialog
            open={renameOpen}
            onOpenChange={setRenameOpen}
            vaultName={activeVault.name}
            onConfirm={async (newName) => {
              await renameVault(activeVault.id, newName);
              setActiveVault(prev => prev ? { ...prev, name: newName } : null);
            }}
          />
        )}

        {/* Upload Drawer - available on all gallery routes */}
        <div className="hidden">
          <MultipleFileUploader />
        </div>
      </div>
    </GalleryLayoutContext.Provider>
  );
}
