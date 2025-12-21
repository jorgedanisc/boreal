import { createFileRoute } from '@tanstack/react-router'
import { SetupWizard } from '../components/setup/SetupWizard'
import { cn } from '@/lib/utils';
import { type } from '@tauri-apps/plugin-os';
import { useEffect, useState } from 'react';

const Setup = () => {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    // Check if we are running in a desktop environment (Tauri)
    // and if the OS is one of the target desktop platforms.
    const osType = type();
    if (osType === 'linux' || osType === 'macos' || osType === 'windows') {
      setIsDesktop(true);
    }
  }, []);
  return <div className={cn(
    isDesktop ? "pt-8" : "pt-0",
    "flex flex-col relative"
  )}>
    <SetupWizard />
  </div>
}

export const Route = createFileRoute('/setup')({
  component: Setup,
})