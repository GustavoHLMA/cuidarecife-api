import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Calcula distância entre dois pontos usando fórmula de Haversine
 * Retorna distância em quilômetros
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Raio da Terra em km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export class PharmacyController {
  /**
   * Lista farmácias ordenadas por proximidade
   * GET /pharmacies?lat=-8.05&lng=-34.90
   */
  async listPharmacies(req: Request, res: Response) {
    try {
      const { lat, lng } = req.query;
      const userLat = lat ? parseFloat(String(lat)) : null;
      const userLng = lng ? parseFloat(String(lng)) : null;

      const pharmacies = await prisma.pharmacy.findMany({
        where: {
          latitude: { not: null },
          longitude: { not: null },
        },
      });

      // Mapear farmácias com distância calculada
      const pharmaciesWithDistance = pharmacies.map(p => {
        let distance: number | null = null;

        if (userLat && userLng && p.latitude && p.longitude) {
          distance = calculateDistance(userLat, userLng, p.latitude, p.longitude);
        }

        return {
          id: p.id,
          name: p.name,
          address: `${p.street}${p.number ? ', ' + p.number : ''}${p.complement ? ' - ' + p.complement : ''}`,
          neighborhood: p.neighborhood,
          cep: p.cep,
          phone: p.phone,
          latitude: p.latitude,
          longitude: p.longitude,
          distance, // distância em km (null se não tiver coordenadas do usuário)
          fullAddress: `${p.street}, ${p.number || 'S/N'} - ${p.neighborhood}, Recife - PE${p.cep ? ', ' + p.cep : ''}`,
        };
      });

      // Ordenar por distância se tiver coordenadas do usuário
      if (userLat && userLng) {
        pharmaciesWithDistance.sort((a, b) => {
          if (a.distance === null) return 1;
          if (b.distance === null) return -1;
          return a.distance - b.distance;
        });
      } else {
        // Sem coordenadas, ordenar por bairro
        pharmaciesWithDistance.sort((a, b) => a.neighborhood.localeCompare(b.neighborhood));
      }

      return res.json({
        success: true,
        count: pharmaciesWithDistance.length,
        hasUserLocation: !!(userLat && userLng),
        data: pharmaciesWithDistance,
      });
    } catch (error) {
      console.error('[PharmacyController] Erro ao listar farmácias:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar farmácias',
      });
    }
  }

  /**
   * Lista bairros disponíveis (para filtro)
   * GET /pharmacies/neighborhoods
   */
  async listNeighborhoods(req: Request, res: Response) {
    try {
      const pharmacies = await prisma.pharmacy.findMany({
        select: { neighborhood: true },
        distinct: ['neighborhood'],
        orderBy: { neighborhood: 'asc' },
      });

      const neighborhoods = pharmacies.map(p => p.neighborhood);

      return res.json({
        success: true,
        count: neighborhoods.length,
        data: neighborhoods,
      });
    } catch (error) {
      console.error('[PharmacyController] Erro ao listar bairros:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar bairros',
      });
    }
  }
}

export const pharmacyController = new PharmacyController();
