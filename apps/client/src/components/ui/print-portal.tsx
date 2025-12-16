import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export const PrintPortal = ({ children }: { children: React.ReactNode }) => {
  const [container] = useState(() => {
    const el = document.createElement('div');
    el.id = 'print-portal-root';
    // Use Tailwind classes to hide on screen, show on print
    // Or just inline styles if tailwind isn't guaranteed on this specific dynamic element 
    // (though it is in body).
    // Let's use standard global classes if possible, or style attribute.
    // .hidden { display: none } usually.
    // .print\:block { display: block } in print media.
    el.className = 'hidden print:block';
    return el;
  });

  useEffect(() => {
    document.body.appendChild(container);
    return () => {
      document.body.removeChild(container);
    };
  }, [container]);

  return createPortal(children, container);
};
