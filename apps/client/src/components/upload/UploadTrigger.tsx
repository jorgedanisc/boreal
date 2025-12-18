import { IconUpload } from '@tabler/icons-react';


interface UploadTriggerProps {
  variant?: 'button' | 'fab';
  className?: string;
}

/**
 * UploadTrigger opens the MultipleFileUploader drawer instead of the OS file picker.
 * The actual file selection happens inside the drawer via "Add Files" / "Add Folder" buttons or drag-and-drop.
 */
export function UploadTrigger({ variant = 'button', className = '' }: UploadTriggerProps) {
  // We use the upload store to control the drawer state
  // Assuming MultipleFileUploader has an exposed way to open...
  // Looking at the patterns, MultipleFileUploader manages its own open state via a trigger button.
  // We need to expose a way to open it from here.

  // The current solution: emit a custom event that MultipleFileUploader listens to
  // OR: use a shared state in the upload store (preferred)

  // Let's add isOpen/setIsOpen to the component. But the store doesn't have this.
  // For now, let's just dispatch a custom DOM event that MultipleFileUploader listens to.

  const handleClick = () => {
    // Dispatch a custom event to open the uploader drawer
    window.dispatchEvent(new CustomEvent('open-upload-drawer'));
  };

  if (variant === 'fab') {
    return (
      <button
        onClick={handleClick}
        className={`fixed bottom-24 right-4 w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-all hover:scale-105 flex items-center justify-center z-40 ${className}`}
        title="Upload files"
      >
        <IconUpload className="h-6 w-6" />
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors ${className}`}
    >
      <IconUpload className="h-4 w-4" />
      Upload
    </button>
  );
}
