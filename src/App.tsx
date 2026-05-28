/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Wifi, 
  WifiOff, 
  Clock, 
  CheckCircle2, 
  Database, 
  Trash2, 
  RefreshCw, 
  Plus, 
  AlertCircle, 
  X,
  CreditCard,
  Sparkles,
  Smartphone,
  User,
  Check,
  DollarSign
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Venda, ServerStatus, ActiveMainTab } from './types';

const BASE_URL = 'https://vendas.streamgo.dpdns.org';
const HEADERS = { 'Bypass-Tunnel-Reminder': 'true' };

export default function App() {
  // Database states
  const [vendas, setVendas] = useState<Venda[]>(() => {
    const local = localStorage.getItem('vendas');
    if (!local) return [];
    try {
      const parsed = JSON.parse(local);
      if (Array.isArray(parsed)) {
        // Garantir retrocompatibilidade com cadastros antigos
        return parsed.map((item: any) => ({
          ...item,
          pago: item.pago !== undefined ? item.pago : true,
          cliente: item.cliente || ''
        }));
      }
    } catch (e) {
      console.error(e);
    }
    return [];
  });
  
  // Status & Connection States
  const [status, setStatus] = useState<ServerStatus>('checking');
  const [activeMainTab, setActiveMainTab] = useState<ActiveMainTab>('vendas');
  const [valorInput, setValorInput] = useState('');
  const [novoPago, setNovoPago] = useState<boolean>(true); // true = Venda Paga, false = Cliente não pagou ainda (Fiado)
  const [clienteInput, setClienteInput] = useState('');
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [showSyncSuccessAlert, setShowSyncSuccessAlert] = useState(false);

  // Quick preset options for mobile quick-entry
  const presets = ['10,00', '25,00', '50,00', '100,00', '200,00'];

  // Input ref to auto focus back on mobile
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync state to local storage
  useEffect(() => {
    localStorage.setItem('vendas', JSON.stringify(vendas));
  }, [vendas]);

  // Network health check
  const verificarConexao = useCallback(async () => {
    // Only set as checking if we are not currently saving or syncing
    setStatus((current) => {
      if (current === 'saving' || current === 'syncing') return current;
      return 'checking';
    });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(`${BASE_URL}/health`, {
        headers: HEADERS,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      if (res.ok) {
        setStatus((current) => (current === 'saving' || current === 'syncing') ? current : 'online');
        return true;
      }
    } catch (e) {
      console.warn('Conexão falhou:', e);
    }
    
    setStatus((current) => (current === 'saving' || current === 'syncing') ? current : 'offline');
    return false;
  }, []);

  // Poll connection check on mount and every 25 seconds
  useEffect(() => {
    verificarConexao();
    const interval = setInterval(verificarConexao, 25000);
    return () => clearInterval(interval);
  }, [verificarConexao]);

  // Automatically format currency inputs (Brazilian Real R$ format)
  const formatInputCurrency = (value: string) => {
    const cleanValue = value.replace(/\D/g, '');
    if (!cleanValue) return '';
    const cents = parseInt(cleanValue, 10);
    if (isNaN(cents)) return '';

    return (cents / 100).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatInputCurrency(e.target.value);
    setValorInput(formatted);
  };

  // Helper to submit a specific sale to the online database
  const enviarParaBanco = async (item: Venda, updateListDirectly = false): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const url = `${BASE_URL}/webhook/vendas?valor=${encodeURIComponent(item.valor)}&data=${encodeURIComponent(item.data)}&pago=${item.pago}&cliente=${encodeURIComponent(item.cliente || '')}`;
      const res = await fetch(url, {
        headers: HEADERS,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const dbId = data?.id || `sync-${Date.now()}`;

        if (updateListDirectly) {
          setVendas((prev) =>
            prev.map((v) => (v.id === item.id ? { ...v, dbId, sincronizado: true } : v))
          );
        }
        return true;
      }
    } catch (error) {
      console.error('Falha de rede ao submeter venda:', error);
    }
    return false;
  };

  // Add Item callback
  const adicionarItem = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const valor = valorInput.trim();
    if (!valor || valor === '0,00') return;

    // Se for pendente, e não tiver nome, podemos colocar "Cliente Anônimo" ou similar
    let nomeCliente = novoPago ? '' : clienteInput.trim();
    if (!novoPago && !nomeCliente) {
      nomeCliente = 'Sem Nome';
    }

    const dataOriginal = new Date();
    const dataFormatada = dataOriginal.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const novoItem: Venda = {
      id: Date.now(),
      dbId: null,
      valor,
      data: dataFormatada,
      sincronizado: false,
      pago: novoPago,
      cliente: nomeCliente,
    };

    // 1. Immediately record in state and localStorage (offline-first)
    setVendas((prev) => [...prev, novoItem]);
    setValorInput('');
    setClienteInput('');
    if (inputRef.current) inputRef.current.focus();

    // Redireciona para a aba correspondente para feedback imediato
    if (!novoPago) {
      setActiveMainTab('pendentes');
    } else {
      setActiveMainTab('vendas');
    }

    // 2. Perform live request in background wrapper
    setStatus('saving');
    const synced = await enviarParaBanco(novoItem);
    
    if (synced) {
      // Mark as synchronized dynamically
      setVendas((prev) =>
        prev.map((item) => {
          if (item.id === novoItem.id) {
            return { ...item, sincronizado: true, dbId: `db-${item.id}` };
          }
          return item;
        })
      );
      setStatus('online');
    } else {
      setStatus('offline');
    }
  };

  // Marcar uma venda pendente de cliente como paga/recebida
  const marcarComoPago = async (id: number) => {
    const item = vendas.find((v) => v.id === id);
    if (!item) return;

    // 1. Atualiza na tela imediatamente (Otimista)
    const itemAtualizado = { ...item, pago: true, sincronizado: false };
    setVendas((prev) =>
      prev.map((v) => (v.id === id ? itemAtualizado : v))
    );

    // Redireciona para a aba "vendas" para ver o item recebido!
    setActiveMainTab('vendas');

    // 2. Tenta salvar no banco remoto
    setStatus('saving');
    const synced = await enviarParaBanco(itemAtualizado);
    if (synced) {
      setVendas((prev) =>
        prev.map((v) => (v.id === id ? { ...v, sincronizado: true, dbId: `db-${id}` } : v))
      );
      setStatus('online');
    } else {
      setStatus('offline');
    }
  };

  // Add a preset quick-value
  const adicionarPreset = (preset: string) => {
    setValorInput(preset);
    if (inputRef.current) inputRef.current.focus();
  };

  // Synchronize all pending local items manually
  const sincronizarPendentes = async () => {
    const pendentes = vendas.filter((v) => !v.sincronizado);
    if (pendentes.length === 0) return;

    setIsSyncingAll(true);
    setStatus('syncing');

    let successCount = 0;
    const updatedVendas = [...vendas];

    for (const item of pendentes) {
      const isSynced = await enviarParaBanco(item);
      if (isSynced) {
        const index = updatedVendas.findIndex((v) => v.id === item.id);
        if (index !== -1) {
          updatedVendas[index].sincronizado = true;
          updatedVendas[index].dbId = `synced-db-${item.id}-${Date.now()}`;
        }
        successCount++;
      }
    }

    setVendas(updatedVendas);
    setIsSyncingAll(false);
    
    // Auto feedback online/offline
    if (successCount === pendentes.length) {
      setStatus('online');
      setShowSyncSuccessAlert(true);
      setTimeout(() => setShowSyncSuccessAlert(false), 4000);
    } else if (successCount > 0) {
      setStatus('online');
    } else {
      setStatus('offline');
    }
  };

  // Delete an item
  const removerItem = async (localId: number) => {
    const confirmed = window.confirm('Deseja apagar este item?');
    if (!confirmed) return;

    const item = vendas.find((v) => v.id === localId);
    if (!item) return;

    // 1. Instantly pull out from Local Storage and state
    setVendas((prev) => prev.filter((v) => v.id !== localId));

    // 2. If it was already synchronized, trigger deletion on server in background
    if (item.sincronizado && item.dbId) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        await fetch(`${BASE_URL}/deletar?id=${item.dbId}`, {
          headers: HEADERS,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (e) {
        console.warn('Não foi possível remover da base de dados online:', e);
      }
    }
  };

  // Clean local panel (localStorage reset helper)
  const limparLocal = () => {
    const confirmed = window.confirm('Apagar todos os itens da tela? O banco de dados remoto não será removido.');
    if (!confirmed) return;
    setVendas([]);
  };

  // Calculate stats for dashboard values
  const parseNumericValue = (valorStr: string): number => {
    const numericStr = valorStr.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(numericStr);
    return isNaN(num) ? 0 : num;
  };

  const totalGeralInfo = vendas.reduce((sum, item) => sum + parseNumericValue(item.valor), 0);
  
  // Total das vendas já pagas/recebidas
  const totalPagas = vendas
    .filter((v) => v.pago)
    .reduce((sum, item) => sum + parseNumericValue(item.valor), 0);
  const totalPagasCount = vendas.filter((v) => v.pago).length;

  // Total das vendas fiadas/pendentes de clientes
  const totalPendentesCliente = vendas
    .filter((v) => !v.pago)
    .reduce((sum, item) => sum + parseNumericValue(item.valor), 0);
  const totalPendentesClienteCount = vendas.filter((v) => !v.pago).length;

  // Total que precisa de sincronismo na nuvem (offline-first status)
  const totalPendentesCount = vendas.filter((v) => !v.sincronizado).length;

  // Filtrar as listas com base nas abas principais solicitadas ('vendas' vs 'pendentes')
  const filteredVendas = [...vendas]
    .reverse() // Novas primeiro
    .filter((item) => {
      if (activeMainTab === 'vendas') return item.pago;
      if (activeMainTab === 'pendentes') return !item.pago;
      return true;
    });

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-0 sm:p-6 md:p-8">
      {/* Container mock interface simulating standard cellular app screen */}
      <div className="w-full max-w-md bg-slate-50 min-h-screen sm:min-h-0 sm:h-[860px] flex flex-col justify-between relative shadow-2xl sm:rounded-[36px] overflow-hidden border border-slate-200/60 font-sans">
        
        {/* Floating Top Nav / Header Banner bar */}
        <div className="bg-gradient-to-b from-amber-500 to-amber-600 shadow-md relative z-30">
          {/* Top Notch simulator/padding */}
          <div className="bg-amber-600/30 h-4 w-full" />
          
          {/* Main Brand Faixa Laranja */}
          <div className="px-6 py-4 flex flex-col items-center">
            <h1 className="text-white font-display text-4xl tracking-wide font-normal drop-shadow-md py-1">
              Eliana Vendas
            </h1>
            
            {/* Status Indicator Capsule */}
            <div className="mt-2.5">
              {status === 'checking' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 shadow-sm animate-pulse">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Verificando conexão...
                </span>
              )}
              {status === 'online' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 shadow-sm border border-emerald-200/50">
                  <Wifi className="w-3.5 h-3.5" />
                  Servidor Online
                </span>
              )}
              {status === 'offline' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 shadow-sm border border-red-200/50">
                  <WifiOff className="w-3.5 h-3.5" />
                  Offline — Salvo Localmente
                </span>
              )}
              {status === 'saving' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 shadow-sm border border-amber-200">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Salvando no banco...
                </span>
              )}
              {status === 'syncing' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 shadow-sm border border-indigo-200">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Sincronizando Banco...
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Swipe-preventable Main Scroll Body */}
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-28 space-y-4">
          
          {/* 1. Transaction insertion area - Mobile styled card */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100/80 space-y-3">
            <h2 className="text-slate-500 text-xs font-bold uppercase tracking-wider flex items-center gap-1">
              <CreditCard className="w-3.5 h-3.5 text-emerald-600" />
              Inserir Novo Registro
            </h2>
            
            <form onSubmit={adicionarItem} className="space-y-3">
              {/* Segmented control for Paid vs Unpaid Debt (Venda vs Fiado) */}
              <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200/40">
                <button
                  type="button"
                  onClick={() => setNovoPago(true)}
                  className={`py-2 px-2 text-xs font-bold rounded-lg cursor-pointer transition-all flex items-center justify-center gap-1.5 ${
                    novoPago 
                      ? 'bg-emerald-600 text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  💵 Venda Paga
                </button>
                <button
                  type="button"
                  onClick={() => setNovoPago(false)}
                  className={`py-2 px-2 text-xs font-bold rounded-lg cursor-pointer transition-all flex items-center justify-center gap-1.5 ${
                    !novoPago 
                      ? 'bg-amber-500 text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Clock className="w-4 h-4" />
                  ⏳ Cliente Não Pagou
                </button>
              </div>

              {/* Dynamic input for Client Name */}
              <AnimatePresence>
                {!novoPago && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden space-y-1"
                  >
                    <label className="text-[10.5px] font-bold text-slate-450 uppercase block pl-1">Quem comprou? (Nome do Cliente):</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                        <User className="w-4 h-4" />
                      </span>
                      <input
                        type="text"
                        value={clienteInput}
                        onChange={(e) => setClienteInput(e.target.value)}
                        placeholder="Ex: Maria Pereira, João do Gás..."
                        className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border-2 border-slate-200/80 focus:border-amber-500 focus:bg-white rounded-xl outline-none text-sm font-semibold text-slate-800 transition-all placeholder:text-slate-350"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Amount input & Submit Add button */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-lg animate-pulse">
                    R$
                  </span>
                  <input
                    ref={inputRef}
                    type="text"
                    inputMode="decimal"
                    value={valorInput}
                    onChange={handleInputChange}
                    placeholder="0,00"
                    disabled={status === 'syncing'}
                    className={`w-full pl-11 pr-4 py-3 bg-slate-50 border-2 rounded-xl outline-none text-2xl font-bold text-slate-850 transition-all placeholder:text-slate-350 ${
                      !novoPago 
                        ? 'focus:border-amber-500' 
                        : 'focus:border-emerald-600'
                    }`}
                  />
                </div>
                
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  type="submit"
                  disabled={!valorInput || valorInput === '0,00' || status === 'syncing'}
                  className={`px-6 text-white font-bold text-base rounded-xl cursor-pointer transition-colors shadow-sm disabled:shadow-none disabled:bg-slate-200 disabled:text-slate-405 flex items-center gap-1 ${
                    !novoPago 
                      ? 'bg-amber-500 hover:bg-amber-600' 
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  <Plus className="w-5 h-5 stroke-[2.5]" />
                  Add
                </motion.button>
              </div>
              
              {/* Quick Preset Badges for easy thumbs tapping */}
              <div className="flex gap-1.5 overflow-x-auto py-1 scrollbar-none">
                <span className="text-[11px] text-slate-400 self-center pr-1 whitespace-nowrap">Valores rápidos:</span>
                {presets.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => adicionarPreset(p)}
                    className={`px-3 py-1.5 text-slate-600 font-bold text-xs rounded-lg whitespace-nowrap transition-all border border-slate-200/65 ${
                      !novoPago 
                        ? 'bg-slate-100 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200' 
                        : 'bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200'
                    }`}
                  >
                    + {p}
                  </button>
                ))}
              </div>
            </form>
          </div>

          {/* Alert of outstanding synchronization updates */}
          <AnimatePresence>
            {totalPendentesCount > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -10 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: 0, y: -10 }}
                className="bg-orange-50 rounded-xl p-3 border border-orange-200 flex items-start gap-2.5 overflow-hidden shadow-sm"
              >
                <div className="p-1 bg-orange-505 bg-orange-500 rounded-lg text-white shrink-0 mt-0.5 animate-pulse">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold text-orange-955 text-orange-900 leading-tight">
                    Sincronização Pendente ({totalPendentesCount})
                  </p>
                  <p className="text-[10.5px] text-orange-700 mt-0.5 font-medium leading-relaxed">
                    Você possui novos registros gravados no celular que precisam ser salvos na web.
                  </p>
                </div>
                <button
                  onClick={sincronizarPendentes}
                  className="px-2.5 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-[10.5px] font-bold rounded-lg cursor-pointer shadow-sm shadow-orange-600/10 active:scale-95 transition-all uppercase"
                >
                  Sincronizar
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Sync success custom alert */}
          <AnimatePresence>
            {showSyncSuccessAlert && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-emerald-600 rounded-xl p-3 text-white flex items-center gap-2.5 shadow-md"
              >
                <CheckCircle2 className="w-5 h-5 shrink-0 animate-bounce text-emerald-100" />
                <div className="text-xs font-semibold">
                  Tudo Sincronizado! Seus dados locais foram salvos com sucesso na nuvem.
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 2. Executive Dashboard Overview (KPI widgets optimized for mobile) */}
          <div className="grid grid-cols-2 gap-3.5">
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100/80">
              <span className="text-[10.5px] text-slate-400 font-bold uppercase tracking-wider block">Recebido (Pago)</span>
              <div className="flex items-baseline mt-1">
                <span className="text-xl font-bold text-emerald-600">
                  R$ {totalPagas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-1 text-[11px] text-emerald-650 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span>{totalPagasCount} {totalPagasCount === 1 ? 'venda' : 'vendas'}</span>
              </div>
            </div>

            <div className="bg-amber-50/50 rounded-2xl p-4 shadow-sm border border-amber-100/40 relative overflow-hidden">
              <span className="text-[10.5px] text-amber-600 font-bold uppercase tracking-wider block">A Receber (Fiado)</span>
              <div className="flex items-baseline mt-1">
                <span className="text-xl font-bold text-amber-700">
                  R$ {totalPendentesCliente.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-1 text-[11px] text-amber-650 font-semibold">
                <User className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                <span>{totalPendentesClienteCount} devedores</span>
              </div>
            </div>
          </div>

          {/* 3. Organized Segmented Tabs and Search */}
          <div className="space-y-2.5 pt-1.5 animate-fadeIn">
            <div className="flex justify-between items-center px-1">
              <h3 className="text-slate-750 font-bold text-sm tracking-tight flex items-center gap-1.5 text-slate-700">
                <Smartphone className="w-4 h-4 text-slate-400" />
                Lista de Registros
              </h3>
              <span className="text-[11px] text-slate-500 font-bold bg-slate-200/60 px-2 py-0.5 rounded-full">
                Geral: R$ {totalGeralInfo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            {/* TWO MAIN TABS REQUESTED: 'vendas' e 'pendentes' */}
            <div className="bg-slate-200/60 p-1.2 p-1 rounded-xl flex gap-1">
              <button
                onClick={() => setActiveMainTab('vendas')}
                className={`flex-1 py-2.5 text-center text-xs font-bold rounded-lg cursor-pointer transition-all flex items-center justify-center gap-1 text-nowrap select-none ${
                  activeMainTab === 'vendas'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-350/20'
                }`}
              >
                <DollarSign className="w-3.5 h-3.5" />
                Vendas Recebidas ({totalPagasCount})
              </button>
              
              <button
                onClick={() => setActiveMainTab('pendentes')}
                className={`flex-1 py-2.5 text-center text-xs font-bold rounded-lg cursor-pointer transition-all flex items-center justify-center gap-1 text-nowrap select-none relative ${
                  activeMainTab === 'pendentes'
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-350/20'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                Clientes Fiadores / Pendentes
                {totalPendentesClienteCount > 0 && (
                  <span className={`inline-flex items-center justify-center w-5 h-5 text-[9px] font-extrabold rounded-full ${
                    activeMainTab === 'pendentes' ? 'bg-white text-amber-700' : 'bg-amber-500 text-white'
                  }`}>
                    {totalPendentesClienteCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* 4. List View Section */}
          <div className="space-y-2.5">
            {filteredVendas.length === 0 ? (
              <div className="bg-white rounded-2xl py-12 px-6 border border-slate-100/80 text-center flex flex-col items-center justify-center space-y-2">
                <Database className="w-8 h-8 text-slate-300 stroke-[1.5]" />
                <p className="text-sm font-semibold text-slate-400">
                  {activeMainTab === 'vendas' && 'Nenhuma venda recebida cadastrada.'}
                  {activeMainTab === 'pendentes' && 'Parabéns! Todos os clientes pagaram e não há pendentes.'}
                </p>
                {activeMainTab === 'pendentes' && totalPagas > 0 && (
                  <div className="text-[11px] text-emerald-700 bg-emerald-50 rounded-lg px-3 py-1.5 mt-1 border border-emerald-100 italic">
                    Nenhum fiado pendente! Todo o caixa está em dia.
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                <AnimatePresence initial={false}>
                  {filteredVendas.map((item) => (
                    <motion.div
                      key={item.id}
                      layoutId={`item-${item.id}`}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, y: 15 }}
                      transition={{ duration: 0.2 }}
                      className={`bg-white rounded-xl p-3.5 border transition-all shadow-sm flex justify-between items-center relative overflow-hidden ${
                        !item.pago 
                          ? 'border-l-[4px] border-l-amber-500 border-amber-100/50' 
                          : 'border-l-[4px] border-l-emerald-600 border-slate-150'
                      }`}
                    >
                      <div className="flex flex-col gap-1.5 flex-1 pr-2">
                        {/* Cliente name badge shown on top of the unpaid items */}
                        {!item.pago && (
                          <div className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md self-start border border-amber-200/40">
                            <User className="w-3.5 h-3.5 text-amber-500" />
                            <span>Cliente: <strong className="text-amber-800 font-extrabold">{item.cliente || 'Sem Nome'}</strong></span>
                          </div>
                        )}

                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[12px] font-bold text-slate-400">R$</span>
                          <span className="text-xl font-extrabold text-slate-800 leading-none">
                            {item.valor}
                          </span>
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10.5px] text-slate-500 font-medium whitespace-nowrap">
                            {item.data}
                          </span>
                          
                          {/* Sync status tracking indicators */}
                          {!item.sincronizado ? (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded-md border border-orange-200/40">
                              <Clock className="w-2.5 h-2.5" />
                              Salvo Local
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded-md border border-indigo-200/40">
                              <Database className="w-2.5 h-2.5" />
                              Nuvem
                            </span>
                          )}

                          {item.pago && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200/40">
                              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
                              Pago
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right action control stack */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Quick pay check option only for unpaid client sales */}
                        {!item.pago && (
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            onClick={() => marcarComoPago(item.id)}
                            className="bg-emerald-50 hover:bg-emerald-100 text-emerald-650 hover:text-emerald-700 px-3 py-1.5 rounded-xl cursor-pointer border border-emerald-150/40 transition-colors flex items-center gap-1 shadow-sm font-bold text-xs"
                            title="Marcar como pago"
                          >
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                            Receber
                          </motion.button>
                        )}

                        {/* Record Deletion Button */}
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => removerItem(item.id)}
                          className="bg-red-50 hover:bg-red-100 text-red-550 hover:text-red-650 p-2 rounded-xl cursor-pointer border border-red-150/45 transition-colors flex items-center justify-center self-center"
                          title="Apagar"
                        >
                          <X className="w-4 h-4 stroke-[2.5]" />
                        </motion.button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>

        {/* Floating Utility Controls Panel (Mobile fixed safe margin bottoms) */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-slate-50/95 backdrop-blur-md border-t border-slate-200/80 z-20 flex gap-3 shadow-top rounded-b-[36px] sm:rounded-b-none">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={limparLocal}
            className="flex-1 py-3 text-slate-600 hover:text-slate-800 bg-slate-200/80 hover:bg-slate-300 active:bg-slate-350 font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-sm flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-4 h-4 text-slate-500" />
            Limpar Tela
          </motion.button>

          {/* Sincronizar floating active cloud sync webhook action */}
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={sincronizarPendentes}
            disabled={totalPendentesCount === 0 || isSyncingAll}
            className={`flex-1 py-3 font-bold text-xs rounded-xl cursor-pointer shadow-md transition-all flex items-center justify-center gap-1.5 ${
              totalPendentesCount > 0
                ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20 active:scale-95'
                : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${isSyncingAll ? 'animate-spin' : ''}`} />
            Sincronizar Nuvem ({totalPendentesCount})
          </motion.button>
        </div>

      </div>
    </div>
  );
}
