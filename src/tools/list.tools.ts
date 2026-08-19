import { z } from 'zod';
import { carrefourService } from '../services/carrefour.service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerListTools(server: McpServer): void {
  // Get all shopping lists
  server.tool(
    'carrefour_get_lists',
    'Get all your Carrefour shopping lists',
    {},
    async () => {
      try {
        const lists = await carrefourService.getLists();

        if (lists.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'You have no shopping lists. Use carrefour_create_list to create one.',
              },
            ],
          };
        }

        const listDisplay = lists
          .map((list, index) => {
            let line = `${index + 1}. ${list.name}`;
            line += `\n   Items: ${list.itemCount}`;
            line += `\n   ID: ${list.id}`;
            line += `\n   Updated: ${new Date(list.updatedAt).toLocaleDateString('fr-FR')}`;
            return line;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `Your Shopping Lists:\n\n${listDisplay}\n\nUse carrefour_get_list with a list ID to see its contents.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error getting lists: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Get a specific list
  server.tool(
    'carrefour_get_list',
    'Get the contents of a specific shopping list',
    {
      listId: z.string().describe('The list ID'),
    },
    async ({ listId }) => {
      try {
        const list = await carrefourService.getList(listId);

        if (list.items.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Shopping List: ${list.name}\n\nThis list is empty. Use carrefour_add_to_list to add products.`,
              },
            ],
          };
        }

        const itemList = list.items
          .map((item, index) => {
            let line = `${index + 1}. ${item.name}`;
            if (item.brand) line += ` - ${item.brand}`;
            line += `\n   Quantity: ${item.quantity}`;
            line += `\n   Product ID: ${item.productId}`;
            return line;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `Shopping List: ${list.name}\n(${list.itemCount} items)\n\n${itemList}\n\nUse carrefour_add_list_to_cart to add all items to your cart.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error getting list: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Create a new list
  server.tool(
    'carrefour_create_list',
    'Create a new shopping list',
    {
      name: z.string().describe('Name for the new list'),
    },
    async ({ name }) => {
      try {
        const list = await carrefourService.createList(name);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Shopping list "${list.name}" created successfully!\n\nList ID: ${list.id}\n\nUse carrefour_add_to_list to add products to this list.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error creating list: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Add product to list
  server.tool(
    'carrefour_add_to_list',
    'Add a product to a shopping list',
    {
      listId: z.string().describe('The list ID'),
      productId: z.string().describe('The product ID to add'),
      quantity: z.number().optional().default(1).describe('Quantity to add (default: 1)'),
    },
    async ({ listId, productId, quantity }) => {
      try {
        const list = await carrefourService.addToList(listId, productId, quantity);

        const addedItem = list.items.find((item) => item.productId === productId);

        let message = addedItem
          ? `Added ${quantity}x "${addedItem.name}" to list "${list.name}".`
          : `Product added to list "${list.name}".`;

        message += `\n\nList now has ${list.itemCount} item(s).`;

        return {
          content: [
            {
              type: 'text' as const,
              text: message,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error adding to list: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Add entire list to cart
  server.tool(
    'carrefour_add_list_to_cart',
    'Add all items from a shopping list to your cart',
    {
      listId: z.string().describe('The list ID'),
    },
    async ({ listId }) => {
      try {
        const cart = await carrefourService.addListToCart(listId);

        return {
          content: [
            {
              type: 'text' as const,
              text: `All items from the list have been added to your cart!\n\nCart total: ${cart.totalItems} item(s) - ${cart.total.toFixed(2)}€\n\nUse carrefour_get_cart to see your cart contents.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error adding list to cart: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );
}
