import React, { useState, useRef } from 'react';
import { Product } from '@/hooks/useProducts';
import {
  ChevronDown, ChevronUp, Plus, Trash2, Edit2, Check, X,
  Download, Upload, AlertCircle, CheckCircle2,
} from 'lucide-react';

interface ProductManagerProps {
  products: Product[];
  onAdd: (p: Product) => void;
  onRemove: (barcode: string) => void;
  onUpdate: (barcode: string, p: Product) => void;
  onReplace: (products: Product[]) => void;
}

// ── Export helpers ────────────────────────────────────────────────────────────

async function exportProducts(products: Product[]) {
  const payload = {
    app: 'erlangga-stock-opname',
    exported: new Date().toISOString(),
    count: products.length,
    products,
  };
  const json = JSON.stringify(payload, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  const fileName = `erlangga-produk-${date}.json`;
  const blob = new Blob([json], { type: 'application/json' });

  // iOS Safari: <a download> saves to nowhere visible — use Web Share API instead.
  // Web Share with files triggers the native "Save to Files" sheet on iOS 15+.
  if (
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    const file = new File([blob], fileName, { type: 'application/json' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Backup Produk Erlangga' });
        return;
      } catch (e: any) {
        // User cancelled share sheet — not an error, just stop
        if (e?.name === 'AbortError') return;
        // Fall through to anchor download for other errors
      }
    }
  }

  // Android / desktop: standard anchor download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProductManager({ products, onAdd, onRemove, onUpdate, onReplace }: ProductManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newProduct, setNewProduct] = useState<Partial<Product>>({ barcode: '', name: '', category: '' });
  const [editingBarcode, setEditingBarcode] = useState<string | null>(null);
  const [editProduct, setEditProduct] = useState<Partial<Product>>({});
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [importMsg, setImportMsg] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (newProduct.barcode && newProduct.name && newProduct.category) {
      onAdd(newProduct as Product);
      setNewProduct({ barcode: '', name: '', category: '' });
    }
  };

  const startEdit = (p: Product) => {
    setEditingBarcode(p.barcode);
    setEditProduct(p);
  };

  const saveEdit = () => {
    if (editingBarcode && editProduct.barcode && editProduct.name && editProduct.category) {
      onUpdate(editingBarcode, editProduct as Product);
      setEditingBarcode(null);
    }
  };

  // ── Import ──────────────────────────────────────────────────────────────────

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // allow re-selecting same file

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string);

        // Accept either { products: [...] } wrapper OR a plain array
        const list: any[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.products) ? raw.products : null);
        if (!list) throw new Error('Format file tidak valid.');

        // Validate each item has required fields
        const validated: Product[] = list.map((item: any, i: number) => {
          if (!item.barcode || !item.name || !item.category) {
            throw new Error(`Baris ${i + 1} tidak lengkap (butuh barcode, name, category).`);
          }
          return { barcode: String(item.barcode), name: String(item.name), category: String(item.category) };
        });

        onReplace(validated);
        setImportStatus('success');
        setImportMsg(`${validated.length} produk berhasil dimuat dari file.`);
      } catch (err: any) {
        setImportStatus('error');
        setImportMsg(err.message || 'File tidak dapat dibaca.');
      }

      // Auto-clear status after 4 seconds
      setTimeout(() => setImportStatus('idle'), 4000);
    };
    reader.readAsText(file);
  };

  return (
    <div className="mt-2 mb-8 border border-border rounded-xl bg-card overflow-hidden shadow-sm transition-all duration-300">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-muted/50 hover:bg-muted transition-colors active:bg-muted/80"
      >
        <div className="flex flex-col text-left">
          <span className="font-semibold font-serif text-lg text-primary">Kelola Produk Master</span>
          <span className="text-xs text-muted-foreground">{products.length} produk tersimpan secara lokal</span>
        </div>
        {isOpen ? <ChevronUp className="text-primary" /> : <ChevronDown className="text-primary" />}
      </button>

      <div className={`transition-all duration-300 overflow-hidden ${isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="p-4 border-t border-border flex flex-col gap-4">

          {/* ── Backup / Restore row ──────────────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Backup &amp; Restore</p>
            <div className="flex gap-2">
              {/* Export */}
              <button
                type="button"
                onClick={() => exportProducts(products)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border border-primary/30 bg-primary/5 text-primary text-sm font-medium hover:bg-primary/10 active:scale-95 transition-all"
              >
                <Download size={16} />
                Ekspor JSON
              </button>

              {/* Import */}
              <button
                type="button"
                onClick={() => { setImportStatus('idle'); importInputRef.current?.click(); }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border border-accent/40 bg-accent/5 text-accent-foreground text-sm font-medium hover:bg-accent/10 active:scale-95 transition-all"
                style={{ color: 'hsl(var(--accent-foreground))' }}
              >
                <Upload size={16} />
                Impor JSON
              </button>

              <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={handleImportFile}
              />
            </div>

            {/* Import feedback */}
            {importStatus !== 'idle' && (
              <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
                importStatus === 'success'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {importStatus === 'success'
                  ? <CheckCircle2 size={15} className="shrink-0" />
                  : <AlertCircle size={15} className="shrink-0" />}
                <span>{importMsg}</span>
              </div>
            )}

            <p className="text-xs text-muted-foreground leading-relaxed">
              💡 <strong>Safari iPhone</strong> dapat menghapus data lokal setelah 7 hari tidak diakses.
              Ekspor secara berkala untuk menyimpan backup ke Files app iPhone Anda.
            </p>
          </div>

          {/* ── Add product form ──────────────────────────────────────────── */}
          <form onSubmit={handleAdd} className="flex flex-col gap-3 p-4 bg-muted/30 rounded-lg border border-border/50">
            <h4 className="text-sm font-medium text-foreground mb-1">Tambah Produk Baru</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                placeholder="Barcode"
                className="w-full px-3 py-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
                value={newProduct.barcode}
                onChange={e => setNewProduct({ ...newProduct, barcode: e.target.value })}
                required
              />
              <input
                type="text"
                placeholder="Nama Produk"
                className="w-full px-3 py-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
                value={newProduct.name}
                onChange={e => setNewProduct({ ...newProduct, name: e.target.value })}
                required
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Kategori"
                  className="w-full flex-1 px-3 py-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
                  value={newProduct.category}
                  onChange={e => setNewProduct({ ...newProduct, category: e.target.value })}
                  required
                />
                <button
                  type="submit"
                  className="flex-none p-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 active:scale-95 transition-transform"
                  aria-label="Tambah"
                >
                  <Plus size={20} />
                </button>
              </div>
            </div>
          </form>

          {/* ── Product table ─────────────────────────────────────────────── */}
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-4 py-3 font-medium">Barcode</th>
                  <th className="px-4 py-3 font-medium">Nama Produk</th>
                  <th className="px-4 py-3 font-medium">Kategori</th>
                  <th className="px-4 py-3 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground italic">Belum ada produk.</td>
                  </tr>
                ) : (
                  products.map((p) => (
                    <tr key={p.barcode} className="hover:bg-muted/20 transition-colors">
                      {editingBarcode === p.barcode ? (
                        <>
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              className="w-full min-w-[100px] px-2 py-1.5 border border-border rounded bg-background text-xs font-mono"
                              value={editProduct.barcode}
                              onChange={e => setEditProduct({ ...editProduct, barcode: e.target.value })}
                            />
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              className="w-full min-w-[150px] px-2 py-1.5 border border-border rounded bg-background text-sm"
                              value={editProduct.name}
                              onChange={e => setEditProduct({ ...editProduct, name: e.target.value })}
                            />
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              className="w-full min-w-[100px] px-2 py-1.5 border border-border rounded bg-background text-sm"
                              value={editProduct.category}
                              onChange={e => setEditProduct({ ...editProduct, category: e.target.value })}
                            />
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={saveEdit} className="p-1.5 text-green-600 hover:bg-green-50 rounded bg-green-50/50"><Check size={16} /></button>
                              <button onClick={() => setEditingBarcode(null)} className="p-1.5 text-muted-foreground hover:bg-muted rounded"><X size={16} /></button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.barcode}</td>
                          <td className="px-4 py-3 font-medium text-foreground">{p.name}</td>
                          <td className="px-4 py-3 text-muted-foreground">
                            <span className="px-2.5 py-1 bg-muted rounded-full text-xs font-medium">{p.category}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => startEdit(p)} className="p-1.5 text-muted-foreground hover:text-primary hover:bg-muted rounded transition-colors"><Edit2 size={16} /></button>
                              <button onClick={() => onRemove(p.barcode)} className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"><Trash2 size={16} /></button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

        </div>
      </div>
    </div>
  );
}
