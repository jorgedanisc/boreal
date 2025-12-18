import { cloneElement, isValidElement, ReactElement, ReactNode } from 'react';

interface UploadTriggerProps {
  children?: ReactNode;
  className?: string;
}

/**
 * UploadTrigger opens the MultipleFileUploader drawer.
 * Pass custom children to render a custom button, or use default.
 */
export function UploadTrigger({ children, className: _className = '' }: UploadTriggerProps) {
  const handleClick = () => {
    window.dispatchEvent(new CustomEvent('open-upload-drawer'));
  };

  // If children is a valid React element, clone it with onClick
  if (children && isValidElement(children)) {
    return cloneElement(children as ReactElement<{ onClick?: () => void }>, {
      onClick: handleClick,
    });
  }

  // Default button
  return null;
}
