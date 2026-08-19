import { z } from 'zod';
import { carrefourService } from '../services/carrefour.service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerCartTools(server: McpServer): void {
  // Get cart contents
  server.tool(
    'carrefour_get_cart',
    'Get the current shopping cart contents',
    {},
    async () => {
      try {
        const cart = await carrefourService.getCart();

        if (cart.items.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Your cart is empty. Use carrefour_search_products to find products and carrefour_add_to_cart to add them.',
              },
            ],
          };
        }

        const itemList = cart.items
          .map((item, index) => {
            let line = `${index + 1}. ${item.name}`;
            if (item.brand) line += ` - ${item.brand}`;
            line += `\n   Quantity: ${item.quantity} × ${item.price.toFixed(2)}€ = ${item.totalPrice.toFixed(2)}€`;
            line += `\n   ID: ${item.productId}`;
            if (!item.available) line += `\n   ⚠️ Currently unavailable`;
            return line;
          })
          .join('\n\n');

        let summary = `\n${'─'.repeat(40)}\n`;
        summary += `Total items: ${cart.totalItems}\n`;
        if (cart.subtotal !== cart.total) {
          summary += `Subtotal: ${cart.subtotal.toFixed(2)}€\n`;
        }
        if (cart.savings && cart.savings > 0) {
          summary += `Savings: -${cart.savings.toFixed(2)}€\n`;
        }
        summary += `Total: ${cart.total.toFixed(2)}€`;

        return {
          content: [
            {
              type: 'text' as const,
              text: `Shopping Cart:\n\n${itemList}${summary}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error getting cart: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Add to cart
  server.tool(
    'carrefour_add_to_cart',
    'Add a product to the shopping cart',
    {
      productId: z.string().describe('The product ID to add'),
      quantity: z.number().optional().default(1).describe('Quantity to add (default: 1)'),
    },
    async ({ productId, quantity }) => {
      try {
        const cart = await carrefourService.addToCart(productId, quantity);

        const addedItem = cart.items.find((item) => item.productId === productId);

        let message = addedItem
          ? `Added ${quantity}x "${addedItem.name}" to cart.\n`
          : `Product added to cart.\n`;

        message += `\nCart total: ${cart.totalItems} item(s) - ${cart.total.toFixed(2)}€`;

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
              text: `Error adding to cart: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Update cart item quantity
  server.tool(
    'carrefour_update_cart_item',
    'Update the quantity of a product in the cart',
    {
      productId: z.string().describe('The product ID to update'),
      quantity: z.number().describe('New quantity (use 0 to remove)'),
    },
    async ({ productId, quantity }) => {
      try {
        if (quantity <= 0) {
          const cart = await carrefourService.removeFromCart(productId);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Product removed from cart.\n\nCart total: ${cart.totalItems} item(s) - ${cart.total.toFixed(2)}€`,
              },
            ],
          };
        }

        const cart = await carrefourService.updateCartItem(productId, quantity);
        const updatedItem = cart.items.find((item) => item.productId === productId);

        let message = updatedItem
          ? `Updated "${updatedItem.name}" quantity to ${quantity}.\n`
          : `Product quantity updated.\n`;

        message += `\nCart total: ${cart.totalItems} item(s) - ${cart.total.toFixed(2)}€`;

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
              text: `Error updating cart: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Remove from cart
  server.tool(
    'carrefour_remove_from_cart',
    'Remove a product from the cart',
    {
      productId: z.string().describe('The product ID to remove'),
    },
    async ({ productId }) => {
      try {
        const cart = await carrefourService.removeFromCart(productId);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Product removed from cart.\n\nCart total: ${cart.totalItems} item(s) - ${cart.total.toFixed(2)}€`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error removing from cart: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Clear cart
  server.tool(
    'carrefour_clear_cart',
    'Remove all items from the cart',
    {},
    async () => {
      try {
        await carrefourService.clearCart();

        return {
          content: [
            {
              type: 'text' as const,
              text: 'Cart cleared. All items have been removed.',
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error clearing cart: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );
}
