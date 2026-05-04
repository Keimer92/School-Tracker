import { useState, useEffect } from 'react';

export function useIsAndroid() {
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    const check = () => {
      const android = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
      setIsAndroid(android);
    };
    check();
  }, []);

  return isAndroid;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => {
      const android = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
      setIsMobile(window.innerWidth <= 768 || android);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return isMobile;
}