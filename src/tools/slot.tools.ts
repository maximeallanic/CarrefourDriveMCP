import { z } from 'zod';
import { carrefourService } from '../services/carrefour.service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerSlotTools(server: McpServer): void {
  // Get available slots
  server.tool(
    'carrefour_get_slots',
    'Get available pickup time slots for the selected store',
    {},
    async () => {
      try {
        const days = await carrefourService.getSlots();

        if (days.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No pickup slots available. Make sure you have selected a store first.',
              },
            ],
          };
        }

        const slotList = days
          .map((day) => {
            const availableSlots = day.slots.filter((s) => s.available);
            const unavailableCount = day.slots.length - availableSlots.length;

            let dayStr = `📅 ${day.dayName} (${day.date})\n`;

            if (availableSlots.length === 0) {
              dayStr += `   No available slots`;
            } else {
              dayStr += availableSlots
                .map((slot) => {
                  let slotStr = `   • ${slot.startTime} - ${slot.endTime}`;
                  if (slot.price !== undefined && slot.price > 0) {
                    slotStr += ` (${slot.price.toFixed(2)}€)`;
                  } else {
                    slotStr += ` (Free)`;
                  }
                  slotStr += `\n     ID: ${slot.id}`;
                  return slotStr;
                })
                .join('\n');
            }

            if (unavailableCount > 0) {
              dayStr += `\n   (${unavailableCount} slot(s) full)`;
            }

            return dayStr;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `Available Pickup Slots:\n\n${slotList}\n\nUse carrefour_reserve_slot with a slot ID to reserve.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error getting slots: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Get first available slot
  server.tool(
    'carrefour_get_first_available_slot',
    'Get the first available pickup slot',
    {},
    async () => {
      try {
        const slot = await carrefourService.getFirstAvailableSlot();

        if (!slot) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No available slots found. Please check back later or try a different store.',
              },
            ],
          };
        }

        let message = `First Available Slot:\n\n`;
        message += `📅 ${slot.date}\n`;
        message += `🕐 ${slot.startTime} - ${slot.endTime}\n`;
        if (slot.price !== undefined && slot.price > 0) {
          message += `💰 ${slot.price.toFixed(2)}€\n`;
        } else {
          message += `💰 Free\n`;
        }
        message += `📍 Type: ${slot.type === 'drive' ? 'Drive (pickup)' : 'Delivery'}\n`;
        message += `\nSlot ID: ${slot.id}\n`;
        message += `\nUse carrefour_reserve_slot with this ID to reserve this slot.`;

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
              text: `Error getting slot: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Reserve slot
  server.tool(
    'carrefour_reserve_slot',
    'Reserve a pickup time slot',
    {
      slotId: z.string().describe('The slot ID to reserve'),
    },
    async ({ slotId }) => {
      try {
        const result = await carrefourService.reserveSlot(slotId);

        return {
          content: [
            {
              type: 'text' as const,
              text: result.success
                ? `✅ Slot reserved successfully!\n\n${result.message}\n\nNote: To complete your order, you will need to finalize payment on the Carrefour website.`
                : `❌ Failed to reserve slot: ${result.message}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error reserving slot: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );
}
