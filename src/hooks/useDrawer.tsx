import { useState, useCallback, useRef, useEffect } from 'react';

interface UseDrawerReturn {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  isMobile: boolean;
}

export function useDrawer(): UseDrawerReturn {
  const [isMobile, setIsMobile] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const isToggling = useRef(false);

  useEffect(() => {
    const checkMobile = () => {
      const android = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
      setIsMobile(window.innerWidth <= 768 || android);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const toggle = useCallback(() => {
    if (isToggling.current) return;
    isToggling.current = true;
    setIsOpen(prev => {
      setTimeout(() => { isToggling.current = false; }, 100);
      return !prev;
    });
  }, []);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return {
    isOpen,
    toggle,
    open,
    close,
    isMobile
  };
}

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  isMobile: boolean;
  children: React.ReactNode;
}

export function DrawerOverlay({ isOpen, onClose, isMobile, children }: DrawerProps) {
  if (!isMobile || !isOpen) return null;
  
  return (
    <>
      <div 
        className="drawer-backdrop" 
        onClick={onClose}
        style={{
          display: 'block',
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          zIndex: 999
        }}
      />
      {children}
    </>
  );
}

interface DrawerButtonProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function DrawerToggleButton({ isOpen, onToggle }: DrawerButtonProps) {
  return (
    <button 
      className="mobile-menu-btn" 
      onClick={onToggle}
    >
      <span>☰</span>
    </button>
  );
}