import { useTranslation } from "react-i18next";
import { IconCircleCheck, IconArrowRight } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface CompleteStepProps {
  onContinue: () => void;
}

export function CompleteStep({ onContinue }: CompleteStepProps) {
  const { t } = useTranslation();

  const features = [
    t("setup.complete.features.encrypted"),
    t("setup.complete.features.thumbnails"),
    t("setup.complete.features.offline"),
  ];

  return (
    <div className="flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8 text-center">
        {/* Success Icon */}
        <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
          <IconCircleCheck className="w-10 h-10 text-green-500" />
        </div>

        {/* Message */}
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">{t("setup.complete.title")}</h2>
          <p className="text-muted-foreground">
            {t("setup.complete.description")}
          </p>
        </div>

        {/* Features Preview */}
        <Card>
          <CardContent className="p-5 space-y-3 text-left">
            {features.map((feature, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-primary" />
                <span className="text-sm">{feature}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* CTA */}
        <Button className="w-full" size="lg" onClick={onContinue}>
          {t("setup.complete.openGallery")}
          <IconArrowRight className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}
