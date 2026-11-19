import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/supabase';

export interface Product {
  barcode: string;
  name: string;
  category: string; // Menambahkan kategori agar sesuai dengan kode lamamu
}

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 1. Ambil produk dari Supabase saat aplikasi dimuat
  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;

      const { data, error } = await supabase
        .from('products')
        .select('name, barcode, category')
        .eq('user_id', session.user.id)
        .order('name');

      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error('Gagal mengambil produk:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // 2. Tambah Produk
  const addProduct = async (product: Product) => {
    setProducts(prev => [...prev.filter(p => p.barcode !== product.barcode), product]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        await supabase.from('products').insert({
          name: product.name,
          barcode: product.barcode,
          category: product.category || 'Umum',
          user_id: session.user.id
        });
      }
    } catch (error) {
      console.error("Gagal simpan produk:", error);
    }
  };

  // 3. Hapus Produk
  const removeProduct = async (barcode: string) => {
    setProducts(prev => prev.filter(p => p.barcode !== barcode));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        await supabase.from('products').delete().eq('barcode', barcode).eq('user_id', session.user.id);
      }
    } catch (error) {
      console.error("Gagal hapus produk:", error);
    }
  };

  // 4. Update Produk
  const updateProduct = async (oldBarcode: string, updatedProduct: Product) => {
    setProducts(prev => prev.map(p => p.barcode === oldBarcode ? updatedProduct : p));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        await supabase.from('products')
          .update({ name: updatedProduct.name, barcode: updatedProduct.barcode, category: updatedProduct.category || 'Umum' })
          .eq('barcode', oldBarcode)
          .eq('user_id', session.user.id);
      }
    } catch (error) {
      console.error("Gagal update produk:", error);
    }
  };

  // 5. Ganti Semua Produk (untuk Import CSV)
  const replaceProducts = async (newProducts: Product[]) => {
    setProducts(newProducts);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        await supabase.from('products').delete().eq('user_id', session.user.id);
        if (newProducts.length > 0) {
          await supabase.from('products').insert(
            newProducts.map(p => ({ name: p.name, barcode: p.barcode, category: p.category || 'Umum', user_id: session.user.id }))
          );
        }
      }
    } catch (error) {
      console.error("Gagal import produk:", error);
    }
  };

  return { products, addProduct, removeProduct, updateProduct, replaceProducts, isLoading };
}