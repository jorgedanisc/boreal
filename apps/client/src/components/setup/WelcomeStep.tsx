import { useTranslation } from "react-i18next";
import { IconMountain, IconPlus, IconDownload } from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";

interface WelcomeStepProps {
  onCreateVault: () => void;
  onImportVault: () => void;
}

export function WelcomeStep({ onCreateVault, onImportVault }: WelcomeStepProps) {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-10">
        {/* Hero */}
        <div className="text-center space-y-4">
          <div className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center mx-auto">
            <IconMountain className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">
            {t("setup.welcome.title")}
          </h1>
          <p className="text-muted-foreground text-lg">
            {t("setup.welcome.tagline")}
          </p>
        </div>

        {/* Options */}
        <div className="space-y-4">
          <Card
            className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-lg"
            onClick={onCreateVault}
          >
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <IconPlus className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">
                    {t("setup.welcome.createVault.title")}
                  </h3>
                  <p className="text-muted-foreground text-sm mt-1">
                    {t("setup.welcome.createVault.description")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-lg"
            onClick={onImportVault}
          >
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0">
                  <IconDownload className="w-6 h-6 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">
                    {t("setup.welcome.importVault.title")}
                  </h3>
                  <p className="text-muted-foreground text-sm mt-1">
                    {t("setup.welcome.importVault.description")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          {t("setup.welcome.footer")}
        </p>
      </div>
    </div>
  );
}
