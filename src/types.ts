export interface Venda {
  id: number;
  dbId: string | number | null;
  valor: string; // The raw or formatted value recorded (e.g. "120,50")
  data: string;  // Date formatted as string in pt-BR
  sincronizado: boolean;
  pago: boolean; // true = Venda Realizada/Paga, false = Cliente ainda não pagou
  cliente?: string; // Nome do cliente (opcional, excelente para celular)
}

export type ServerStatus = 'checking' | 'online' | 'offline' | 'saving' | 'syncing';

export type ActiveMainTab = 'vendas' | 'pendentes';

