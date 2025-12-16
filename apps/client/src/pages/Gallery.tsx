import { useState, useEffect } from 'react';
import { uploadPhoto, getPhotos, getThumbnail, Photo, getActiveVault, VaultPublic } from '../lib/vault';
import { Plus, Image as ImageIcon, Loader, ChevronLeft } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { ShareVaultDialog } from '../components/vault/ShareVaultDialog';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

export default function Gallery() {
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [activeVault, setActiveVault] = useState<VaultPublic | null>(null);

  const loadPhotos = async () => {
    try {
      const vault = await getActiveVault();
      if (!vault) {
        navigate({ to: "/" });
        return;
      }
      setActiveVault(vault);

      const list = await getPhotos();
      setPhotos(list);

      // Load thumbnails lazily or all at once (Phase 1: all at once)
      list.forEach(async (p) => {
        if (!thumbnails[p.id]) {
          try {
            const b64 = await getThumbnail(p.id);
            setThumbnails(prev => ({ ...prev, [p.id]: `data: image / avif; base64, ${b64} ` }));
          } catch (e) {
            console.error("Failed to load thumbnail for " + p.id, e);
          }
        }
      });
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadPhotos();
  }, []);

  const handleUpload = async () => {
    setUploading(true);
    try {
      const file = await open({
        multiple: false,
        filters: [{
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'webp']
        }]
      });

      if (file) {
        // 'file' is null if cancelled, or string/string[] depending on 'multiple'
        // open returns null | string | string[]
        const path = Array.isArray(file) ? file[0] : file;
        if (path) {
          await uploadPhoto(path);
          await loadPhotos();
        }
      }
    } catch (e) {
      console.error(e);
      alert('Upload failed: ' + e);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: "/" })}
            className="shrink-0"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold leading-tight">
              {activeVault?.name || "Photos"}
            </h1>
            {activeVault && (
              <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                {activeVault.bucket}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeVault && <ShareVaultDialog vaultId={activeVault.id} />}

          <Button
            onClick={handleUpload}
            disabled={uploading}
            size="sm"
            className="gap-2"
          >
            {uploading ? <Loader className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </Button>
        </div>
      </header>

      <main className="p-4 grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {photos.length === 0 ? (
          <div className="col-span-full py-20 flex flex-col items-center justify-center text-muted-foreground space-y-4">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
              <ImageIcon className="w-8 h-8" />
            </div>
            <p>No photos yet</p>
          </div>
        ) : (
          photos.map(p => (
            <div key={p.id} className="aspect-square bg-muted rounded-lg overflow-hidden relative group">
              {thumbnails[p.id] ? (
                <img src={thumbnails[p.id]} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <Loader className="w-6 h-6 animate-spin" />
                </div>
              )}
              <div className="absolute inset-0 bg-linear-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                <span className="text-xs truncate w-full text-white">{p.filename}</span>
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  );
}