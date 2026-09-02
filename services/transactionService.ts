import { supabase } from '@/lib/supabaseClient';

export interface Transaction {
  id?: string;
  user_id: string;
  amount_cents: number;
  type: 'income' | 'expense';
  category_id: string;
  created_at?: string;
}

export const transactionService = {
  async getTransactions(userId: string) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Error al obtener transacciones: ${error.message}`);
    return data;
  },

  async createTransaction(transaction: Transaction) {
    if (transaction.amount_cents <= 0) {
      throw new Error('El monto debe ser mayor a cero.');
    }

    const { data, error } = await supabase
      .from('transactions')
      .insert([transaction])
      .select();

    if (error) throw new Error(`Error al guardar la transacción: ${error.message}`);
    return data[0];
  }
};
