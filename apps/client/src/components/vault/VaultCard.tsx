import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { IconChevronRight, IconDotsVertical, IconLoader, IconLock } from "@tabler/icons-react";
import { TextCursorInputIcon, VaultIcon } from "lucide-react";

interface VaultCardProps {
  vault: any;
  openLoading: string | null;
  onOpen: (id: string) => void;
  onRename?: (id: string) => void;
  showChevron?: boolean;
  hideMenu?: boolean;
  hideBucket?: boolean;
}

export function VaultCard({
  vault,
  openLoading,
  onOpen,
  onRename,
  showChevron = false,
  hideMenu = false,
  hideBucket = false
}: VaultCardProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-xl border bg-card hover:bg-accent/50 hover:border-accent transition-all text-left w-full group relative",
        showChevron && "pr-2"
      )}
    >
      <button
        className="flex-1 flex items-center gap-3 min-w-0 text-left"
        onClick={() => onOpen(vault.id)}
        disabled={!!openLoading}
      >
        <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors shrink-0">
          {openLoading === vault.id ? (
            <IconLoader className="w-4 h-4 animate-spin" />
          ) : (
            <VaultIcon className="w-4 h-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{vault.name}</p>
          {!hideBucket && (
            <p className="text-xs text-muted-foreground truncate">{vault.bucket}</p>
          )}
          {vault.visits !== undefined && vault.visits > 0 && (
            <p className="text-[10px] text-muted-foreground/60">{vault.visits} visits</p>
          )}
        </div>
        {showChevron && (
          <IconChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
        )}
      </button>

      {/* Context Menu for Rename */}
      {!hideMenu && onRename && (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1">
                <IconDotsVertical className="w-3 h-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => {
                e.stopPropagation();
                onRename(vault.id);
              }}>
                <TextCursorInputIcon className="w-3 h-3 mr-2" />
                Rename
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
