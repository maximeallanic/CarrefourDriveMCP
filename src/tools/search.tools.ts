import { z } from 'zod';
import { carrefourService } from '../services/carrefour.service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerSearchTools(server: McpServer): void {
  // Search products
  server.tool(
    'carrefour_search_products',
    'Search for products on Carrefour Drive by keyword',
    {
      query: z.string().describe('Search query (e.g., "lait", "pâtes", "coca cola")'),
      page: z.number().optional().default(1).describe('Page number (default: 1)'),
      pageSize: z.number().optional().default(10).describe('Number of results per page (default: 10, max: 50)'),
    },
    async ({ query, page, pageSize }) => {
      try {
        const results = await carrefourService.searchProducts(query, page, Math.min(pageSize, 50));

        if (results.products.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No products found for "${query}". Try a different search term.`,
              },
            ],
          };
        }

        const productList = results.products
          .map((product, index) => {
            let line = `${index + 1}. ${product.name}`;
            if (product.brand) line += ` - ${product.brand}`;
            line += `\n   Price: ${product.price.toFixed(2)}€`;
            if (product.pricePerUnit) line += ` (${product.pricePerUnit})`;
            line += `\n   ID: ${product.id}`;
            line += `\n   Available: ${product.available ? 'Yes' : 'No'}`;
            if (product.promotions && product.promotions.length > 0) {
              line += `\n   Promo: ${product.promotions.map((p) => p.description).join(', ')}`;
            }
            return line;
          })
          .join('\n\n');

        const pagination = `\nPage ${results.page} - Showing ${results.products.length} of ${results.totalCount} results${results.hasMore ? ` (more pages available)` : ''}`;

        return {
          content: [
            {
              type: 'text' as const,
              text: `Search results for "${query}":\n\n${productList}${pagination}\n\nUse carrefour_add_to_cart with a product ID to add to cart.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error searching products: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Get product details
  server.tool(
    'carrefour_get_product',
    'Get detailed information about a specific product',
    {
      productId: z.string().describe('The product ID'),
    },
    async ({ productId }) => {
      try {
        const product = await carrefourService.getProduct(productId);

        let details = `Product Details:\n\n`;
        details += `Name: ${product.name}\n`;
        if (product.brand) details += `Brand: ${product.brand}\n`;
        details += `Price: ${product.price.toFixed(2)}€`;
        if (product.pricePerUnit) details += ` (${product.pricePerUnit})`;
        details += `\n`;
        details += `Available: ${product.available ? 'Yes' : 'No'}\n`;
        details += `ID: ${product.id}\n`;
        if (product.category) details += `Category: ${product.category}\n`;
        if (product.description) details += `\nDescription: ${product.description}\n`;
        if (product.promotions && product.promotions.length > 0) {
          details += `\nPromotions:\n`;
          product.promotions.forEach((promo) => {
            details += `  - ${promo.description}`;
            if (promo.discount) details += ` (${promo.discount}% off)`;
            details += `\n`;
          });
        }

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
              text: `Error getting product: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Get categories
  server.tool(
    'carrefour_get_categories',
    'Get the list of product categories',
    {},
    async () => {
      try {
        const categories = await carrefourService.getCategories();

        if (categories.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No categories found.',
              },
            ],
          };
        }

        const categoryList = categories
          .map((cat) => {
            let line = `- ${cat.name} (ID: ${cat.id})`;
            if (cat.subcategories && cat.subcategories.length > 0) {
              const subs = cat.subcategories
                .slice(0, 5)
                .map((sub) => sub.name)
                .join(', ');
              line += `\n  Subcategories: ${subs}${cat.subcategories.length > 5 ? '...' : ''}`;
            }
            return line;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `Product Categories:\n\n${categoryList}\n\nUse carrefour_browse_category with a category ID to see products.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error getting categories: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Browse category
  server.tool(
    'carrefour_browse_category',
    'Browse products in a specific category',
    {
      categoryId: z.string().describe('The category ID'),
      page: z.number().optional().default(1).describe('Page number (default: 1)'),
      pageSize: z.number().optional().default(10).describe('Number of results per page (default: 10, max: 50)'),
    },
    async ({ categoryId, page, pageSize }) => {
      try {
        const results = await carrefourService.browseCategory(categoryId, page, Math.min(pageSize, 50));

        if (results.products.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No products found in this category.`,
              },
            ],
          };
        }

        const productList = results.products
          .map((product, index) => {
            let line = `${index + 1}. ${product.name}`;
            if (product.brand) line += ` - ${product.brand}`;
            line += `\n   Price: ${product.price.toFixed(2)}€`;
            if (product.pricePerUnit) line += ` (${product.pricePerUnit})`;
            line += `\n   ID: ${product.id}`;
            line += `\n   Available: ${product.available ? 'Yes' : 'No'}`;
            return line;
          })
          .join('\n\n');

        const pagination = `\nPage ${results.page} - Showing ${results.products.length} of ${results.totalCount} products${results.hasMore ? ` (more pages available)` : ''}`;

        return {
          content: [
            {
              type: 'text' as const,
              text: `Category Products:\n\n${productList}${pagination}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error browsing category: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );
}
