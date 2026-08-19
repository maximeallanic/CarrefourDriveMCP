import { z } from 'zod';
import { carrefourService } from '../services/carrefour.service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerStoreTools(server: McpServer): void {
  // Find stores near postal code
  server.tool(
    'carrefour_find_stores',
    'Find Carrefour Drive stores near a postal code',
    {
      postalCode: z.string().describe('French postal code (e.g., "75001")'),
    },
    async ({ postalCode }) => {
      try {
        const stores = await carrefourService.findStores(postalCode);

        if (stores.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No Carrefour Drive stores found near postal code ${postalCode}.`,
              },
            ],
          };
        }

        const storeList = stores
          .map(
            (store, index) =>
              `${index + 1}. ${store.name}\n   ID: ${store.id}\n   Address: ${store.address}, ${store.postalCode} ${store.city}${store.distance ? `\n   Distance: ${store.distance} km` : ''}`
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `Found ${stores.length} Carrefour Drive store(s) near ${postalCode}:\n\n${storeList}\n\nUse carrefour_select_store with the store ID to select a store.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error finding stores: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Select a store
  server.tool(
    'carrefour_select_store',
    'Select a Carrefour Drive store for shopping',
    {
      storeId: z.string().describe('The store ID (obtained from carrefour_find_stores)'),
    },
    async ({ storeId }) => {
      try {
        const store = await carrefourService.selectStore(storeId);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Store selected successfully!\n\nStore: ${store.name}\nAddress: ${store.address}, ${store.postalCode} ${store.city}\nID: ${store.id}\n\nYou can now search for products and add them to your cart.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error selecting store: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Get selected store
  server.tool(
    'carrefour_get_selected_store',
    'Get the currently selected Carrefour Drive store',
    {},
    async () => {
      try {
        const store = await carrefourService.getSelectedStore();

        if (!store) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No store selected. Use carrefour_find_stores to find stores and carrefour_select_store to select one.',
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Currently selected store:\n\nStore: ${store.name}\nAddress: ${store.address}, ${store.postalCode} ${store.city}\nID: ${store.id}${store.services.length > 0 ? `\nServices: ${store.services.join(', ')}` : ''}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error getting selected store: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );
}
