import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { WelcomeStep } from "./WelcomeStep";
import { ConfigureStep } from "./ConfigureStep";
import { ConnectAwsStep } from "./ConnectAwsStep";
import { CompleteStep } from "./CompleteStep";
import type { StorageTier } from "../../lib/aws-config";

type WizardStep =
  | "welcome"
  | "configure"
  | "connect-aws"
  | "complete";

interface WizardState {
  step: WizardStep;
  region: string;
  tier: StorageTier | null;
}

export function SetupWizard() {
  const navigate = useNavigate();
  // Mode handling moved to dedicated routes

  const [state, setState] = useState<WizardState>({
    step: "welcome",
    region: "",
    tier: null,
  });

  const handleCreateVault = () => {
    setState(s => ({ ...s, step: "configure" }));
  };

  const handleConfigure = (region: string, tier: StorageTier) => {
    setState(s => ({ ...s, region, tier, step: "connect-aws" }));
  };

  const handleVaultBootstrapped = () => {
    setState(s => ({ ...s, step: "complete" }));
  };

  const handleComplete = () => {
    navigate({ to: "/gallery" });
  };

  const handleBack = (toStep: WizardStep) => {
    setState(s => ({ ...s, step: toStep }));
  };

  switch (state.step) {
    case "welcome":
      return (
        <WelcomeStep
          onCreateVault={handleCreateVault}
        />
      );

    case "configure":
      return (
        <ConfigureStep
          onBack={() => handleBack("welcome")}
          onContinue={handleConfigure}
        />
      );

    case "connect-aws":
      return (
        <ConnectAwsStep
          region={state.region}
          tier={state.tier!}
          onBack={() => handleBack("configure")}
          onComplete={handleVaultBootstrapped}
        />
      );

    case "complete":
      return (
        <CompleteStep onContinue={handleComplete} />
      );

    default:
      return null;
  }
}
