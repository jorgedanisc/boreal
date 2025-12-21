import { useEffect, useState } from 'react';
import { type } from '@tauri-apps/plugin-os';

export function TitleBar() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    // Check if we are running in a desktop environment (Tauri)
    // and if the OS is one of the target desktop platforms.
    const osType = type();
    if (osType === 'linux' || osType === 'macos' || osType === 'windows') {
      setIsDesktop(true);
    }
  }, []);

  if (!isDesktop) return null;

  return (
    <div
      data-tauri-drag-region
      className="h-8 top-0 w-dvw select-none bg-transparent z-9999"
    />
  );
}
