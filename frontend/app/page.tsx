"use client";

import { apiEndpoints } from '@/lib/api';
import { useState, useCallback, useEffect } from 'react';
import { Search, Upload, Copy, Check, Download, Trash2, Image as ImageIcon, Clock, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';

// Tipos
interface SearchResult {
  codigo: string;
  descripcion: string;
  similitud: string;
  marca?: string;
  segment?: string;
  normalizado?: string;
  razon?: string;
  timings?: {
    embedding_time_ms?: number;
    vector_search_time_ms?: number;
    gpt_selection_time_ms?: number;
    total_time_ms?: number;
  };
  [key: string]: any; // Para CA1-CA5, DA1-DA5
}

interface SearchHistory {
  id: string;
  query: string;
  result: SearchResult;
  timestamp: Date;
  selected?: boolean;
}

// Componente principal
export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(5);
  const [segment, setSegment] = useState<'premium' | 'standard' | 'economy' | undefined>(undefined);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // const queryClient = useQueryClient();

  // Cargar historial del localStorage
  useEffect(() => {
    const saved = localStorage.getItem('searchHistory');
    if (saved) {
      const parsed = JSON.parse(saved);
      setSearchHistory(parsed.map((item: any) => ({
        ...item,
        timestamp: new Date(item.timestamp)
      })));
    }
  }, []);

  // Guardar historial en localStorage
  const saveHistory = (history: SearchHistory[]) => {
    localStorage.setItem('searchHistory', JSON.stringify(history));
    setSearchHistory(history);
  };

  // Buscar en cache
  const findInCache = (searchQuery: string): SearchResult | null => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const cached = searchHistory.find(
      item => item.query.toLowerCase() === searchQuery.toLowerCase() && 
              item.timestamp > thirtyDaysAgo
    );
    
    return cached?.result || null;
  };

  // Mutation para búsqueda
  const searchMutation = useMutation({
    mutationFn: async (params: { query: string; limit: number; segment?: string }) => {
      // Primero buscar en cache
      const cached = findInCache(params.query);
      if (cached) {
        return { ...cached, fromCache: true };
      }

      // Si no está en cache, hacer petición
		const response = await fetch(apiEndpoints.search(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      
      if (!response.ok) throw new Error('Error en la búsqueda');
      return response.json();
    },
    onSuccess: (data, variables) => {
      // Guardar en historial si no viene de cache
      if (!data.fromCache) {
        const newHistory = [
          {
            id: Date.now().toString(),
            query: variables.query,
            result: data,
            timestamp: new Date(),
          },
          ...searchHistory
        ].slice(0, 100); // Mantener máximo 100 registros
        
        saveHistory(newHistory);
      }
    },
  });

  // Mutation para procesar imagen
  const imageMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('image', file);
      
      const response = await fetch(apiEndpoints.visionAnalyze(), {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) throw new Error('Error al procesar imagen');
      return response.json();
    },
    onSuccess: (data) => {
      setQuery(data.description || '');
      handleSearch(data.description || '');
    },
  });

  // Manejadores
  const handleSearch = (searchQuery?: string) => {
    const finalQuery = searchQuery || query;
    if (!finalQuery.trim()) return;
    
    searchMutation.mutate({
      query: finalQuery,
      limit,
      segment,
    });
  };

  const handleCopy = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleImageUpload = (file: File) => {
    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
    imageMutation.mutate(file);
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) handleImageUpload(file);
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleImageUpload(file);
    }
  };

  const toggleHistorySelection = (id: string) => {
    const updated = searchHistory.map(item =>
      item.id === id ? { ...item, selected: !item.selected } : item
    );
    setSearchHistory(updated);
  };

  const exportHistory = (all: boolean = false) => {
    const dataToExport = all ? searchHistory : searchHistory.filter(item => item.selected);
    
    const wsData = dataToExport.map(item => ({
      'Fecha': format(item.timestamp, 'dd/MM/yyyy HH:mm'),
      'Búsqueda': item.query,
      'Código': item.result.codigo,
      'Descripción': item.result.descripcion,
      'Similitud': item.result.similitud,
      'Marca': item.result.marca || '',
      'Segmento': item.result.segment || '',
    }));
    
    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Historial');
    XLSX.writeFile(wb, `historial_busquedas_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
  };

  const deleteFromHistory = (id: string) => {
    const updated = searchHistory.filter(item => item.id !== id);
    saveHistory(updated);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  // Obtener alternativas
  const getAlternatives = (result: SearchResult) => {
    const alternatives = [];
    for (let i = 1; i <= limit; i++) {
      const code = result[`CA${i}`];
      const desc = result[`DA${i}`];
      if (code && desc) {
        alternatives.push({ code, desc, index: i });
      }
    }
    return alternatives;
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center">
                <span className="text-white font-bold">EFC</span>
              </div>
              <h1 className="ml-3 text-xl font-semibold text-gray-900"> Búsqueda Inteligente de Productos</h1>
            </div>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Clock size={16} />
              Historial
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Search Section */}
        <div className="mb-8">
          <div className="relative">
            <div
              className="w-full p-4 border-2 border-gray-300 rounded-lg focus-within:border-green-500 transition-colors"
              onPaste={handlePaste}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
 {imagePreview && (
  <div className="mb-4 relative inline-block">
    <img src={imagePreview} alt="Preview" className="h-32 rounded-lg" />
    <button
      onClick={clearImage}
      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
    >
      <X size={16} />
    </button>
    {imageMutation.isPending && (
      <div className="absolute inset-0 bg-black bg-opacity-50 rounded-lg flex items-center justify-center">
        <div className="text-white">Analizando...</div>
      </div>
    )}
  </div>
)}
              
              <div className="flex items-center gap-3">
                <Search className="text-gray-400" size={24} />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Buscar producto o pegar imagen..."
                  className="flex-1 outline-none text-lg"
                />
                <label className="cursor-pointer p-2 hover:bg-gray-100 rounded-lg transition-colors">
                  <Upload size={20} className="text-gray-600" />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Search Options */}
          <div className="mt-4 flex flex-wrap gap-3">
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-green-500"
            >
              <option value={5}>5 resultados</option>
              <option value={10}>10 resultados</option>
              <option value={15}>15 resultados</option>
            </select>
            
            <select
              value={segment || ''}
              onChange={(e) => setSegment(e.target.value as any || undefined)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-green-500"
            >
              <option value="">Todos los segmentos</option>
              <option value="premium">Premium</option>
              <option value="standard">Estándar</option>
              <option value="economy">Económico</option>
            </select>
            
            <button
              onClick={() => handleSearch()}
              disabled={!query.trim() || searchMutation.isPending}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {searchMutation.isPending ? 'Buscando...' : 'Buscar'}
            </button>
          </div>
        </div>

        {/* Results */}
        {searchMutation.data && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            {/* Main Result */}
            <div className="mb-6">
              <div className="flex items-start justify-between mb-2">
                <h2 className="text-2xl font-bold text-gray-900">{searchMutation.data.codigo}</h2>
                <button
                  onClick={() => handleCopy(searchMutation.data.codigo)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  {copiedCode === searchMutation.data.codigo ? (
                    <Check size={20} className="text-green-600" />
                  ) : (
                    <Copy size={20} className="text-gray-600" />
                  )}
                </button>
              </div>
              <p className="text-lg text-gray-700 mb-3">{searchMutation.data.descripcion}</p>
              
              <div className="flex flex-wrap gap-2 text-sm">
                <span className={`px-3 py-1 rounded-full ${
                  searchMutation.data.similitud === 'EXACTO' ? 'bg-green-100 text-green-800' :
                  searchMutation.data.similitud === 'EQUIVALENTE' ? 'bg-blue-100 text-blue-800' :
                  searchMutation.data.similitud === 'COMPATIBLE' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {searchMutation.data.similitud}
                </span>
                {searchMutation.data.marca && (
                  <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full">
                    {searchMutation.data.marca}
                  </span>
                )}
                {searchMutation.data.segment && (
                  <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full capitalize">
                    {searchMutation.data.segment}
                  </span>
                )}
                {searchMutation.data.fromCache && (
                  <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full">
                    Desde caché
                  </span>
                )}
              </div>

              {searchMutation.data.normalizado && (
                <p className="mt-3 text-sm text-gray-600">
                  Búsqueda normalizada: "{searchMutation.data.normalizado}"
                </p>
              )}
            </div>

            {/* Alternatives */}
            {getAlternatives(searchMutation.data).length > 0 && (
              <div className="border-t pt-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Alternativas:</h3>
                <div className="space-y-2">
                  {getAlternatives(searchMutation.data).map((alt) => (
                    <div key={alt.index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{alt.code}</p>
                        <p className="text-sm text-gray-600">{alt.desc}</p>
                      </div>
                      <button
                        onClick={() => handleCopy(alt.code)}
                        className="ml-3 p-2 hover:bg-gray-200 rounded-lg transition-colors"
                      >
                        {copiedCode === alt.code ? (
                          <Check size={16} className="text-green-600" />
                        ) : (
                          <Copy size={16} className="text-gray-600" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Performance Metrics */}
            {searchMutation.data.timings && (
              <div className="mt-4 pt-4 border-t text-xs text-gray-500">
                Tiempo total: {searchMutation.data.timings.total_time_ms?.toFixed(0)}ms
              </div>
            )}
          </div>
        )}

        {/* Error State */}
        {searchMutation.isError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            Error al realizar la búsqueda. Por favor, intente nuevamente.
          </div>
        )}
      </main>

      {/* History Sidebar */}
      {showHistory && (
        <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-xl z-20 overflow-hidden flex flex-col">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="text-lg font-semibold">Historial de búsquedas</h2>
            <button
              onClick={() => setShowHistory(false)}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <X size={20} />
            </button>
          </div>
          
          <div className="p-4 border-b flex gap-2">
            <button
              onClick={() => exportHistory(false)}
              disabled={!searchHistory.some(item => item.selected)}
              className="flex-1 py-2 px-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm"
            >
              Exportar seleccionados
            </button>
            <button
              onClick={() => exportHistory(true)}
              disabled={searchHistory.length === 0}
              className="flex-1 py-2 px-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm"
            >
              Exportar todo
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {searchHistory.map((item) => (
              <div key={item.id} className="p-4 border-b hover:bg-gray-50">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={item.selected || false}
                    onChange={() => toggleHistorySelection(item.id)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{item.query}</p>
                    <p className="text-sm text-gray-600">{item.result.codigo} - {item.result.descripcion}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {format(item.timestamp, 'dd/MM/yyyy HH:mm')}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteFromHistory(item.id)}
                    className="p-1 hover:bg-gray-200 rounded"
                  >
                    <Trash2 size={16} className="text-gray-500" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
