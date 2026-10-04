import { useState, useEffect } from 'react';

export interface Product {
  barcode: string;
  name: string;
  category: string;
}

const INITIAL_PRODUCTS: Product[] = [
  { barcode: '8993137713641', name: 'Kahf Bright Fresh Sunscreen Moisturizer SPF 35', category: 'Sunscreen' },
];

export function useProducts() {
  const [products, setProducts] = useState<Product[]>(() => {
    try {
      const stored = localStorage.getItem('erlangga_products');
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to parse stored products', e);
    }
    return INITIAL_PRODUCTS;
  });

  useEffect(() => {
    localStorage.setItem('erlangga_products', JSON.stringify(products));
  }, [products]);

  const addProduct = (product: Product) => {
    setProducts(prev => [...prev.filter(p => p.barcode !== product.barcode), product]);
  };

  const removeProduct = (barcode: string) => {
    setProducts(prev => prev.filter(p => p.barcode !== barcode));
  };

  const updateProduct = (barcode: string, product: Product) => {
    setProducts(prev => prev.map(p => p.barcode === barcode ? product : p));
  };

  const replaceProducts = (list: Product[]) => {
    setProducts(list);
  };

  return { products, addProduct, removeProduct, updateProduct, replaceProducts };
}
