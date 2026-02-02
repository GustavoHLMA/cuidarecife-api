/**
 * Script para indexar os PDFs de protocolos de saúde
 * Execute: npx ts-node scripts/ingest-protocols.ts
 */

import * as path from 'path';
import { ragService } from '../src/services/RAGService';

async function main() {
  console.log('=== Ingestão de Protocolos de Saúde ===\n');

  const docsFolder = path.resolve(__dirname, '..', 'docs');
  console.log(`Pasta de documentos: ${docsFolder}\n`);

  const startTime = Date.now();
  const result = await ragService.indexFolder(docsFolder);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n=== Resultado ===');
  console.log(`Arquivos processados: ${result.indexed}`);
  console.log(`Chunks com embeddings: ${result.chunks}`);
  console.log(`Tempo: ${elapsed}s`);

  const status = ragService.getStatus();
  console.log(`\nStatus do RAG:`);
  console.log(`- Inicializado: ${status.initialized}`);
  console.log(`- Total de chunks: ${status.documentCount}`);
  console.log(`- Caminho cache: ${status.cachePath}`);

  // Teste de busca
  console.log('\n=== Teste de Busca ===');
  const testQuery = 'glicemia normal de jejum';
  const results = await ragService.search(testQuery, 2);
  console.log(`Query: "${testQuery}"`);
  console.log(`Resultados: ${results.length}`);
  if (results.length > 0) {
    console.log(`\nPrimeiro resultado (${results[0].metadata.source}) - ${(results[0].similarity * 100).toFixed(0)}%:`);
    console.log(results[0].content.substring(0, 200) + '...');
  }
}

main().catch(console.error);
