export interface SubmitPayload {
  store: string;
  transaction: string;
  product: string;
  quantity: number;
  barcode: string;
}

const FORM_URL = 'https://script.google.com/macros/s/AKfycbx993YnMgStwmOrelkMGSkbjAqPuVUXQFVoeatVZ8TPFvxHMoZK_P97eSjafnGpNGMZ/exec';

export async function submitStockEntry(payload: SubmitPayload) {
  const response = await fetch(FORM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error('Gagal menghubungi server.');
  }
  
  const result = await response.json();
  return result;
}
