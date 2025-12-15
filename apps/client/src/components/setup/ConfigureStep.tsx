import { useTranslation } from "react-i18next";
import { IconChevronLeft, IconArchive, IconBolt, IconCheck } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AWS_REGIONS, STORAGE_TIERS, type StorageTier } from "@/lib/aws-config";
import { useState } from "react";

interface ConfigureStepProps {
  onBack: () => void;
  onContinue: (region: string, tier: StorageTier) => void;
}

export function ConfigureStep({ onBack, onContinue }: ConfigureStepProps) {
  const { t } = useTranslation();
  const [region, setRegion] = useState<string>("");
  const [tier, setTier] = useState<StorageTier | null>(null);

  const canContinue = region && tier;

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
                {AWS_REGIONS.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    <span className="flex items-center gap-2">
                      <span>{r.flag}</span>
                      <span>{r.name}</span>
                    </span>
                  </SelectItem>
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
              {STORAGE_TIERS.map((t_tier) => (
                <Card
                  key={t_tier.id}
                  className={`cursor-pointer transition-all ${tier === t_tier.id
                      ? "border-primary bg-primary/5"
                      : "hover:border-primary/50"
                    }`}
                  onClick={() => setTier(t_tier.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${tier === t_tier.id ? "bg-primary/10" : "bg-muted"
                        }`}>
                        {t_tier.id === "deep-archive" ? (
                          <IconArchive className={`w-5 h-5 ${tier === t_tier.id ? "text-primary" : "text-muted-foreground"}`} />
                        ) : (
                          <IconBolt className={`w-5 h-5 ${tier === t_tier.id ? "text-primary" : "text-muted-foreground"}`} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {t_tier.id === "deep-archive"
                              ? t("setup.configure.tier.deepArchive.name")
                              : t("setup.configure.tier.instantRetrieval.name")
                            }
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {t_tier.id === "deep-archive"
                              ? t("setup.configure.tier.deepArchive.price")
                              : t("setup.configure.tier.instantRetrieval.price")
                            }
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t_tier.id === "deep-archive"
                            ? t("setup.configure.tier.deepArchive.description")
                            : t("setup.configure.tier.instantRetrieval.description")
                          }
                        </p>
                      </div>
                      {tier === t_tier.id && (
                        <IconCheck className="w-5 h-5 text-primary shrink-0" />
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
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
