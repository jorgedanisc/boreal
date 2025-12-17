import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { WelcomeStep } from "./WelcomeStep";
import { ConfigureStep } from "./ConfigureStep";
import { ConnectAwsStep } from "./ConnectAwsStep";
import { ImportStep } from "./ImportStep";
import { CompleteStep } from "./CompleteStep";
import { importVault } from "../../lib/vault";
import type { StorageTier } from "../../lib/aws-config";

type WizardStep =
  | "welcome"
  | "configure"
  | "connect-aws"
  | "import"
  | "complete";

interface WizardState {
  step: WizardStep;
  region: string;
  tier: StorageTier | null;
}

export function SetupWizard() {
  const navigate = useNavigate();
  const [state, setState] = useState<WizardState>({
    step: "welcome",
    region: "",
    tier: null,
  });
  const [, setError] = useState<string | null>(null);

  const handleCreateVault = () => {
    setState(s => ({ ...s, step: "configure" }));
  };

  const handleImportVault = () => {
    setState(s => ({ ...s, step: "import" }));
  };

  const handleConfigure = (region: string, tier: StorageTier) => {
    setState(s => ({ ...s, region, tier, step: "connect-aws" }));
  };

  const handleVaultBootstrapped = () => {
    setState(s => ({ ...s, step: "complete" }));
  };

  const handleVaultCode = async (vaultCode: string) => {
    try {
      await importVault(vaultCode);
      setState(s => ({ ...s, step: "complete" }));
    } catch (e: any) {
      setError(e.message);
    }
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
          onImportVault={handleImportVault}
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

    case "import":
      return (
        <ImportStep
          onBack={() => handleBack("welcome")}
          onComplete={handleVaultCode}
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
