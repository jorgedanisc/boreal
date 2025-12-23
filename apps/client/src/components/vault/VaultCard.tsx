import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatBytes } from "@/lib/utils";
import { IconChevronRight, IconDotsVertical, IconLoader, IconTrash } from "@tabler/icons-react";
import { VaultIcon } from "lucide-react";

interface VaultCardProps {
  vault: any;
  openLoading: string | null;
  onOpen: (id: string) => void;
  onRename?: (id: string) => void;
  onDelete?: (id: string) => void;
  showChevron?: boolean;
  hideMenu?: boolean;
  hideBucket?: boolean;
}

export function VaultCard({
  vault,
  openLoading,
  onOpen,
  onRename,
  onDelete,
  showChevron = false,
  hideMenu = true,
  hideBucket = false
}: VaultCardProps) {
  const isLoading = openLoading === vault.id;

  return (
    <button
      type="button"
      onClick={() => onOpen(vault.id)}
      disabled={!!openLoading}
      className={cn(
        "relative overflow-hidden rounded-xl border p-3 text-left transition-all duration-200 w-full group @container",
        "hover:scale-[1.02] active:scale-[0.98]",
        "border-border/50 bg-card/50 hover:border-primary/60 hover:bg-gradient-to-br hover:from-primary/10 hover:via-primary/5 hover:to-transparent"
      )}
    >
      <div className="relative flex items-center gap-3">
        {/* Icon */}
        <div className={cn(
          "w-10 h-10 rounded-xl border border-white/10 flex items-center justify-center shrink-0 transition-all duration-200",
          "bg-muted/80 text-muted-foreground",
          "group-hover:bg-primary/20 group-hover:text-primary-foreground group-hover:border-primary"
        )}>
          {isLoading ? (
            <IconLoader className="w-4 h-4 animate-spin" />
          ) : (
            <VaultIcon className="w-4 h-4" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className={cn(
            "font-semibold text-sm truncate transition-colors",
            "text-foreground/90 group-hover:text-foreground"
          )}>
            {vault.name}
          </p>
          {!hideBucket && (
            <p className="text-xs text-muted-foreground/80 truncate">{vault.bucket}</p>
          )}
          {vault.visits !== undefined && vault.visits > 0 && (
            <p className="text-[10px] text-muted-foreground/60 flex flex-col @[200px]:flex-row @[200px]:items-center gap-0.5 @[200px]:gap-1.5">
              <span>{vault.visits} visits</span>
              {vault.total_size_bytes > 0 && (
                <span className="hidden @[200px]:inline w-0.5 h-0.5 rounded-full bg-muted-foreground/40" />
              )}
              {vault.total_size_bytes > 0 && (
                <span>{formatBytes(vault.total_size_bytes)}</span>
              )}
            </p>
          )}
        </div>

        {/* Chevron */}
        {showChevron && (
          <IconChevronRight className={cn(
            "w-4 h-4 transition-all duration-200 shrink-0",
            "text-muted-foreground/40 group-hover:text-muted-foreground group-hover:translate-x-0.5"
          )} />
        )}

        {/* Context Menu */}
        {!hideMenu && onRename && (
          <div
            className="transition-opacity shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <IconDotsVertical className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename(vault.id);
                  }}
                  inset
                >
                  Rename
                </DropdownMenuItem>
                {onDelete && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(vault.id);
                    }}
                  >
                    <IconTrash className="w-3 h-3 mr-2" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </button>
  );
}

