import { useState, useEffect } from 'react';

export function useStoreName() {
  const [storeName, setStoreName] = useState(() => {
    return localStorage.getItem('erlangga_store_name') || '';
  });

  useEffect(() => {
    localStorage.setItem('erlangga_store_name', storeName);
  }, [storeName]);

  return [storeName, setStoreName] as const;
}
