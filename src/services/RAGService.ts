import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';

// ===== CONFIGURAÇÃO =====
const RAG_CONFIG = {
  embeddingModel: 'text-embedding-004',
  chunkSize: 800,
  cacheFile: 'embeddings-cache.json',
  persistPath: process.env.RAG_PERSIST_PATH || '/var/data/chroma',
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${RAG_CONFIG.embeddingModel}:embedContent`;
const BATCH_URL = `https://generativelanguage.googleapis.com/v1beta/models/${RAG_CONFIG.embeddingModel}:batchEmbedContents`;

// ===== TIPOS =====
interface Document {
  id: string;
  content: string;
  embedding: number[];
  metadata: { source: string; category: string };
}

interface EmbeddingsCache {
  version: string;
  generatedAt: string;
  documents: Document[];
}

// ===== FUNÇÕES DE EMBEDDINGS =====
async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const res = await fetch(`${EMBED_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${RAG_CONFIG.embeddingModel}`,
        content: { parts: [{ text }] },
      }),
    });
    const data = await res.json() as any;
    return data.embedding?.values || null;
  } catch { return null; }
}

async function generateEmbeddingsBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (!GEMINI_API_KEY || !texts.length) return texts.map(() => null);
  try {
    const requests = texts.map(text => ({
      model: `models/${RAG_CONFIG.embeddingModel}`,
      content: { parts: [{ text }] },
    }));
    const res = await fetch(`${BATCH_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });
    const data = await res.json() as any;
    return data.embeddings?.map((e: any) => e.values) || texts.map(() => null);
  } catch { return texts.map(() => null); }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ===== SERVIÇO RAG =====
class RAGService {
  private documents: Document[] = [];
  private isInitialized = false;

  private getCachePath(): string {
    // Em produção usa disco persistente, local usa pasta do projeto
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction && fs.existsSync(RAG_CONFIG.persistPath)) {
      return path.join(RAG_CONFIG.persistPath, RAG_CONFIG.cacheFile);
    }
    return path.join(process.cwd(), RAG_CONFIG.cacheFile);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    const cachePath = this.getCachePath();

    if (fs.existsSync(cachePath)) {
      try {
        const cache: EmbeddingsCache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        this.documents = cache.documents;
        console.log(`[RAG] ✓ Carregado ${cache.documents.length} documentos do cache`);
        console.log(`[RAG] Cache de: ${cache.generatedAt}`);
      } catch (e) {
        console.error('[RAG] Erro ao carregar cache:', e);
      }
    } else {
      console.log('[RAG] Cache não encontrado. Execute indexFolder() para gerar.');
    }

    this.isInitialized = true;
  }

  private chunkText(text: string): string[] {
    const chunks: string[] = [];
    const sentences = text.split(/[.!?]\s+/);
    let current = '';
    for (const s of sentences) {
      if ((current + s).length > RAG_CONFIG.chunkSize && current) {
        chunks.push(current.trim());
        current = s;
      } else {
        current += (current ? '. ' : '') + s;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  private detectCategory(fileName: string): string {
    const n = fileName.toLowerCase();
    if (n.includes('diabetes') || n.includes('glicemia')) return 'diabetes';
    if (n.includes('hipertenso') || n.includes('pressao') || n.includes('has')) return 'hipertensao';
    if (n.includes('idoso')) return 'idoso';
    return 'geral';
  }

  /**
   * Indexa PDFs e salva cache (com embeddings)
   */
  async indexFolder(docsFolder: string): Promise<{ indexed: number; chunks: number }> {
    await this.initialize();

    // Se já tem documentos no cache, não reindexa
    if (this.documents.length > 0) {
      console.log(`[RAG] ✓ ${this.documents.length} chunks já indexados, pulando.`);
      return { indexed: 0, chunks: this.documents.length };
    }

    console.log('[RAG] Iniciando indexação com embeddings...');
    const files = fs.readdirSync(docsFolder).filter(f => f.endsWith('.pdf'));
    const allDocs: Document[] = [];

    for (const file of files) {
      console.log(`[RAG] Processando: ${file}`);
      try {
        const pdfParse = require('pdf-parse');
        const buffer = fs.readFileSync(path.join(docsFolder, file));
        const { text } = await pdfParse(buffer);

        const chunks = this.chunkText(text);
        const category = this.detectCategory(file);

        // Gera embeddings em batches de 50
        for (let i = 0; i < chunks.length; i += 50) {
          const batch = chunks.slice(i, i + 50);
          const embeddings = await generateEmbeddingsBatch(batch);

          for (let j = 0; j < batch.length; j++) {
            if (embeddings[j]) {
              allDocs.push({
                id: `${file}-${i + j}`,
                content: batch[j],
                embedding: embeddings[j]!,
                metadata: { source: file, category },
              });
            }
          }
          console.log(`[RAG] ${file}: ${Math.min(i + 50, chunks.length)}/${chunks.length}`);
        }
      } catch (error) {
        console.error(`[RAG] Erro em ${file}:`, error);
      }
    }

    // Salva cache no disco persistente
    this.documents = allDocs;
    const cache: EmbeddingsCache = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      documents: allDocs,
    };

    const cachePath = this.getCachePath();
    const cacheDir = path.dirname(cachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    fs.writeFileSync(cachePath, JSON.stringify(cache));
    console.log(`[RAG] ✓ Cache salvo: ${allDocs.length} chunks em ${cachePath}`);

    return { indexed: files.length, chunks: allDocs.length };
  }

  async search(query: string, topK = 3): Promise<{ content: string; metadata: any; similarity: number }[]> {
    await this.initialize();

    if (this.documents.length === 0) {
      return [];
    }

    const queryEmb = await generateEmbedding(query);
    if (!queryEmb) {
      return this.searchByKeywords(query, topK);
    }

    const scored = this.documents.map(doc => ({
      doc,
      similarity: cosineSimilarity(queryEmb, doc.embedding),
    }));

    return scored
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK)
      .map(s => ({ content: s.doc.content, metadata: s.doc.metadata, similarity: s.similarity }));
  }

  private searchByKeywords(query: string, topK: number) {
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const scored = this.documents.map(doc => {
      const c = doc.content.toLowerCase();
      const score = words.filter(w => c.includes(w)).length;
      return { doc, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => ({ content: s.doc.content, metadata: s.doc.metadata, similarity: s.score / words.length }));
  }

  async getContext(query: string, maxChunks = 3): Promise<string> {
    const results = await this.search(query, maxChunks);
    if (!results.length) return '';

    return `CONTEXTO DOS PROTOCOLOS DE SAÚDE:\n\n` +
      results.map(r => `[Fonte: ${r.metadata.source}] (${(r.similarity * 100).toFixed(0)}%)\n${r.content}`).join('\n\n---\n\n');
  }

  getStatus() {
    return {
      initialized: this.isInitialized,
      documentCount: this.documents.length,
      cachePath: this.getCachePath(),
    };
  }
}

export const ragService = new RAGService();
