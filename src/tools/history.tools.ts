import { z } from 'zod';
import { carrefourService } from '../services/carrefour.service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerHistoryTools(server: McpServer): void {
  // Get order history
  server.tool(
    'carrefour_get_orders',
    'Get your Carrefour order history',
    {
      page: z.number().optional().default(1).describe('Page number (default: 1)'),
      pageSize: z.number().optional().default(10).describe('Number of orders per page (default: 10)'),
    },
    async ({ page, pageSize }) => {
      try {
        const orders = await carrefourService.getOrders(page, pageSize);

        if (orders.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No orders found in your history.',
              },
            ],
          };
        }

        const orderList = orders
          .map((order, index) => {
            let line = `${index + 1}. Order #${order.orderNumber}`;
            line += `\n   Date: ${new Date(order.date).toLocaleDateString('fr-FR')}`;
            line += `\n   Status: ${order.status}`;
            line += `\n   Total: ${order.total.toFixed(2)}€ (${order.itemCount} items)`;
            line += `\n   Store: ${order.storeName}`;
            if (order.slotDate && order.slotTime) {
              line += `\n   Pickup: ${order.slotDate} ${order.slotTime}`;
            }
            line += `\n   ID: ${order.id}`;
            return line;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `Order History (Page ${page}):\n\n${orderList}\n\nUse carrefour_get_order with an order ID for details, or carrefour_reorder to re-order.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error getting orders: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Get order details
  server.tool(
    'carrefour_get_order',
    'Get details of a specific order',
    {
      orderId: z.string().describe('The order ID'),
    },
    async ({ orderId }) => {
      try {
        const order = await carrefourService.getOrder(orderId);

        let details = `Order #${order.orderNumber}\n`;
        details += `${'═'.repeat(40)}\n\n`;
        details += `Date: ${new Date(order.date).toLocaleDateString('fr-FR')}\n`;
        details += `Status: ${order.status}\n`;
        details += `Store: ${order.storeName}\n`;
        if (order.slotDate && order.slotTime) {
          details += `Pickup: ${order.slotDate} ${order.slotTime}\n`;
        }
        details += `\nItems:\n${'─'.repeat(40)}\n`;

        details += order.items
          .map((item, index) => {
            let line = `${index + 1}. ${item.name}`;
            if (item.brand) line += ` - ${item.brand}`;
            line += `\n   ${item.quantity}x ${item.price.toFixed(2)}€ = ${item.totalPrice.toFixed(2)}€`;
            return line;
          })
          .join('\n\n');

        details += `\n\n${'─'.repeat(40)}\n`;
        if (order.subtotal !== order.total) {
          details += `Subtotal: ${order.subtotal.toFixed(2)}€\n`;
        }
        if (order.savings && order.savings > 0) {
          details += `Savings: -${order.savings.toFixed(2)}€\n`;
        }
        if (order.fees && order.fees > 0) {
          details += `Fees: ${order.fees.toFixed(2)}€\n`;
        }
        details += `Total: ${order.total.toFixed(2)}€`;

        return {
          content: [
            {
              type: 'text' as const,
              text: details,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error getting order: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Reorder from previous order
  server.tool(
    'carrefour_reorder',
    'Add all products from a previous order to your cart',
    {
      orderId: z.string().describe('The order ID to reorder'),
    },
    async ({ orderId }) => {
      try {
        const cart = await carrefourService.reorder(orderId);

        const unavailableItems = cart.items.filter((item) => !item.available);

        let message = `Products from the order have been added to your cart!\n\n`;
        message += `Cart total: ${cart.totalItems} item(s) - ${cart.total.toFixed(2)}€`;

        if (unavailableItems.length > 0) {
          message += `\n\n⚠️ Note: ${unavailableItems.length} product(s) are currently unavailable:\n`;
          message += unavailableItems.map((item) => `  - ${item.name}`).join('\n');
        }

        message += `\n\nUse carrefour_get_cart to review your cart.`;

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
              text: `Error reordering: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );
}
