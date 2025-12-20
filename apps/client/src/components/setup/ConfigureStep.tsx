import { useTranslation } from "react-i18next";
import { IconChevronLeft, IconBolt, IconCheck } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getRegionsByContinent, getRegionDisplayName, STORAGE_TIERS, type StorageTier } from "@/lib/aws-config";
import { useMemo, useState } from "react";
import * as Flags from "country-flag-icons/react/3x2";
import { cn } from "@/lib/utils";
import { SnowflakeIcon } from "lucide-react";

interface ConfigureStepProps {
  onBack: () => void;
  onContinue: (region: string, tier: StorageTier) => void;
}

// Map country codes to flag components
function FlagIcon({ countryCode, className }: { countryCode: string; className?: string }) {
  const Flag = Flags[countryCode as keyof typeof Flags];
  if (!Flag) return null;
  return <Flag className={className} />;
}

export function ConfigureStep({ onBack, onContinue }: ConfigureStepProps) {
  const { t } = useTranslation();
  const [region, setRegion] = useState<string>("");
  const [tier, setTier] = useState<StorageTier | null>(null);

  const canContinue = region && tier;

  const regionsByContinent = useMemo(() => getRegionsByContinent(), []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="p-4 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <IconChevronLeft className="w-5 h-5" />
        </Button>
        <span className="text-sm text-muted-foreground">
          {t("setup.configure.step")}
        </span>
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md space-y-8">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">{t("setup.configure.title")}</h2>
            <p className="text-muted-foreground">
              {t("setup.configure.description")}
            </p>
          </div>

          {/* Region Selector */}
          <div className="space-y-3">
            <Label>{t("setup.configure.region.label")}</Label>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("setup.configure.region.placeholder")} />
              </SelectTrigger>
              <SelectContent>
                {Array.from(regionsByContinent.entries()).map(([continent, regions]) => (
                  <SelectGroup key={continent}>
                    <SelectLabel className="font-semibold text-foreground/80">{continent}</SelectLabel>
                    {regions.map((r) => (
                      <SelectItem key={r.code} value={r.code}>
                        <span className="flex items-center gap-2.5">
                          <FlagIcon countryCode={r.countryCode} className="w-5 h-auto rounded-[2px] shadow-sm" />
                          <span>{getRegionDisplayName(r)}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("setup.configure.region.hint")}
            </p>
          </div>

          {/* Storage Tier */}
          <div className="space-y-3">
            <Label>{t("setup.configure.tier.label")}</Label>
            <div className="grid gap-3">
              {STORAGE_TIERS.map((t_tier) => {
                const isSelected = tier === t_tier.id;
                const isDeepArchive = t_tier.id === "deep-archive";

                return (
                  <button
                    key={t_tier.id}
                    type="button"
                    onClick={() => setTier(t_tier.id)}
                    className={cn(
                      "relative overflow-hidden rounded-xl border p-4 text-left transition-all duration-200",
                      "hover:scale-[1.01] active:scale-[0.99]",
                      isSelected
                        ? "border-primary/50 bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5"
                        : "border-border/50 bg-card/50 hover:border-primary-foreground/10 hover:bg-card"
                    )}
                  >
                    {/* Subtle gradient overlay for selected state */}
                    {isSelected && (
                      <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent pointer-events-none" />
                    )}

                    <div className="relative flex items-start gap-4">
                      {/* Icon */}
                      <div className={cn(
                        "w-11 h-11 rounded-xl border border-white/10 flex items-center justify-center shrink-0 transition-colors",
                        isSelected
                          ? "bg-primary/20 text-primary-foreground"
                          : "bg-muted/80 text-muted-foreground"
                      )}>
                        {isDeepArchive ? (
                          <SnowflakeIcon className="w-5 h-5" strokeWidth={1.75} />
                        ) : (
                          <IconBolt className="w-5 h-5" strokeWidth={1.75} />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn(
                            "font-semibold transition-colors",
                            isSelected ? "text-foreground" : "text-foreground/90"
                          )}>
                            {isDeepArchive
                              ? t("setup.configure.tier.deepArchive.name")
                              : t("setup.configure.tier.instantRetrieval.name")
                            }
                          </span>
                          <span className={cn(
                            "text-sm font-medium px-2 py-0.5 rounded-md border border-white/10",
                            isSelected
                              ? "bg-primary/20 text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          )}>
                            {isDeepArchive
                              ? t("setup.configure.tier.deepArchive.price")
                              : t("setup.configure.tier.instantRetrieval.price")
                            }
                          </span>
                        </div>
                        <p className={cn(
                          "text-sm leading-relaxed",
                          isSelected ? "text-muted-foreground" : "text-muted-foreground/80"
                        )}>
                          {isDeepArchive
                            ? t("setup.configure.tier.deepArchive.description")
                            : t("setup.configure.tier.instantRetrieval.description")
                          }
                        </p>
                      </div>

                      {/* Check indicator */}
                      <div className={cn(
                        "w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all duration-200",
                        isSelected
                          ? "bg-primary text-primary-foreground scale-100"
                          : "bg-muted/50 scale-90 opacity-0"
                      )}>
                        <IconCheck className="w-3 h-3" strokeWidth={3} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Continue */}
          <Button
            className="w-full"
            size="lg"
            onClick={() => tier && onContinue(region, tier)}
            disabled={!canContinue}
          >
            {t("common.continue")}
          </Button>
        </div>
      </div>
    </div>
  );
}

