import { httpService } from './http.service.js';
import { sessionService } from './session.service.js';
import { logger } from '../utils/logger.js';
import type {
  Store,
  Product,
  SearchResult,
  Category,
  Cart,
  CartItem,
  TimeSlot,
  SlotDay,
  ShoppingList,
  ShoppingListDetail,
  Order,
  OrderDetail,
} from '../types/index.js';

const BASE_URL = 'https://www.carrefour.fr';
const API_URL = 'https://www.carrefour.fr/api';

// API response interfaces (internal)
interface CarrefourStoreResponse {
  data?: {
    stores?: Array<{
      id: string;
      name: string;
      address?: {
        street?: string;
        city?: string;
        postalCode?: string;
      };
      distance?: number;
      services?: string[];
      openingHours?: string;
    }>;
  };
}

interface CarrefourProductData {
  id: string;
  title?: string;
  name?: string;
  brand?: string;
  price?: { price?: number; unitPrice?: string };
  image?: string;
  available?: boolean;
  quantity?: number;
  category?: string;
  description?: string;
  promotions?: Array<{ type?: string; label?: string; discount?: number }>;
}

interface CarrefourProductResponse {
  data?: {
    products?: CarrefourProductData[];
    totalCount?: number;
    pagination?: {
      currentPage?: number;
      pageSize?: number;
      totalPages?: number;
    };
  };
}

interface CarrefourSingleProductResponse {
  data?: CarrefourProductData;
}

interface CarrefourCategoryResponse {
  data?: {
    categories?: Array<{
      id: string;
      name: string;
      parentId?: string;
      image?: string;
      children?: Array<{
        id: string;
        name: string;
        parentId?: string;
        image?: string;
      }>;
    }>;
  };
}

interface CarrefourCartResponse {
  data?: {
    items?: Array<{
      productId?: string;
      id?: string;
      name?: string;
      brand?: string;
      price?: number;
      quantity?: number;
      totalPrice?: number;
      image?: string;
      available?: boolean;
    }>;
    totalItems?: number;
    subtotal?: number;
    total?: number;
    savings?: number;
    storeId?: string;
  };
}

interface CarrefourSlotResponse {
  data?: {
    days?: Array<{
      date: string;
      dayName?: string;
      slots?: Array<{
        id: string;
        startTime?: string;
        endTime?: string;
        available?: boolean;
        price?: number;
        type?: string;
      }>;
    }>;
  };
}

interface CarrefourListResponse {
  data?: {
    lists?: Array<{
      id: string;
      name: string;
      itemCount?: number;
      createdAt?: string;
      updatedAt?: string;
    }>;
  };
}

interface CarrefourListDetailResponse {
  data?: {
    id: string;
    name: string;
    itemCount?: number;
    createdAt?: string;
    updatedAt?: string;
    items?: Array<{
      productId: string;
      name?: string;
      brand?: string;
      quantity?: number;
      image?: string;
    }>;
  };
}

interface CarrefourOrderResponse {
  data?: {
    orders?: Array<{
      id: string;
      orderNumber?: string;
      date?: string;
      status?: string;
      total?: number;
      itemCount?: number;
      storeId?: string;
      storeName?: string;
      slotDate?: string;
      slotTime?: string;
    }>;
  };
}

interface CarrefourOrderDetailResponse {
  data?: {
    id: string;
    orderNumber?: string;
    date?: string;
    status?: string;
    total?: number;
    itemCount?: number;
    storeId?: string;
    storeName?: string;
    slotDate?: string;
    slotTime?: string;
    items?: Array<{
      productId?: string;
      id?: string;
      name?: string;
      brand?: string;
      price?: number;
      quantity?: number;
      totalPrice?: number;
      image?: string;
    }>;
    subtotal?: number;
    savings?: number;
    fees?: number;
  };
}

class CarrefourService {
  // Session validation
  async checkSession(): Promise<{ valid: boolean; message: string }> {
    const hasSession = await sessionService.hasValidSession();
    if (!hasSession) {
      return { valid: false, message: 'No cookies set. Please import cookies first.' };
    }

    const cookies = await sessionService.getCookies();
    if (!cookies) {
      return { valid: false, message: 'No cookies found.' };
    }

    // Check for key Carrefour session cookies
    const hasSessionCookie = cookies['FRONTONE_SESSID'] || cookies['FRONTONE_SESSION_ID'];
    const hasStoreCookie = cookies['FRONTAL_STORE'];

    if (hasSessionCookie) {
      let message = 'Session cookies found.';
      if (hasStoreCookie) {
        message += ` Store ID: ${cookies['FRONTAL_STORE']}`;
      }
      if (cookies['FRONTONE_SLOT']) {
        try {
          const slotData = JSON.parse(Buffer.from(cookies['FRONTONE_SLOT'], 'base64').toString('utf8'));
          message += ` | Slot reserved: ${slotData.dateBegin} to ${slotData.dateEnd}`;
        } catch {
          // Ignore parsing errors
        }
      }
      return { valid: true, message };
    }

    return { valid: false, message: 'Missing key session cookies (FRONTONE_SESSID). Please login to carrefour.fr and re-export cookies.' };
  }

  // Store methods
  async findStores(postalCode: string): Promise<Store[]> {
    try {
      const response = await httpService.get<CarrefourStoreResponse>(
        `${API_URL}/stores?postalCode=${encodeURIComponent(postalCode)}&format=drive`
      );

      const stores = response?.data?.stores || [];
      return stores.map((store) => ({
        id: store.id,
        name: store.name,
        address: store.address?.street || '',
        city: store.address?.city || '',
        postalCode: store.address?.postalCode || '',
        distance: store.distance,
        services: store.services || [],
        openingHours: store.openingHours,
      }));
    } catch (error) {
      logger.error('Failed to find stores:', error);
      throw new Error('Failed to find stores. Please try again.');
    }
  }

  async selectStore(storeId: string): Promise<Store> {
    try {
      // Set store in session
      const response = await httpService.post<CarrefourStoreResponse>(
        `${API_URL}/stores/${storeId}/select`,
        {}
      );

      const store = response?.data?.stores?.[0];
      if (!store) {
        throw new Error('Store not found');
      }

      await sessionService.setStore(storeId, store.name);

      return {
        id: store.id,
        name: store.name,
        address: store.address?.street || '',
        city: store.address?.city || '',
        postalCode: store.address?.postalCode || '',
        services: store.services || [],
      };
    } catch (error) {
      logger.error('Failed to select store:', error);
      throw new Error('Failed to select store. Please try again.');
    }
  }

  async getSelectedStore(): Promise<Store | null> {
    const store = await sessionService.getStore();
    if (!store) {
      return null;
    }

    try {
      const response = await httpService.get<{ data?: CarrefourStoreResponse['data'] }>(
        `${API_URL}/stores/${store.id}`
      );

      const storeData = response?.data?.stores?.[0];
      if (!storeData) {
        return { id: store.id, name: store.name, address: '', city: '', postalCode: '', services: [] };
      }

      return {
        id: storeData.id,
        name: storeData.name,
        address: storeData.address?.street || '',
        city: storeData.address?.city || '',
        postalCode: storeData.address?.postalCode || '',
        services: storeData.services || [],
      };
    } catch (error) {
      logger.error('Failed to get selected store:', error);
      return { id: store.id, name: store.name, address: '', city: '', postalCode: '', services: [] };
    }
  }

  // Product methods
  async searchProducts(query: string, page: number = 1, pageSize: number = 20): Promise<SearchResult> {
    try {
      const response = await httpService.get<CarrefourProductResponse>(
        `${API_URL}/products/search?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`
      );

      const products = (response?.data?.products || []).map((p) => ({
        id: p.id,
        name: p.title || p.name || '',
        brand: p.brand,
        price: p.price?.price || 0,
        pricePerUnit: p.price?.unitPrice,
        imageUrl: p.image,
        available: p.available !== false,
        category: p.category,
        description: p.description,
        promotions: p.promotions?.map((promo) => ({
          type: promo.type || '',
          description: promo.label || '',
          discount: promo.discount,
        })),
      }));

      return {
        products,
        totalCount: response?.data?.totalCount || products.length,
        page: response?.data?.pagination?.currentPage || page,
        pageSize: response?.data?.pagination?.pageSize || pageSize,
        hasMore: (response?.data?.pagination?.totalPages || 1) > page,
      };
    } catch (error) {
      logger.error('Failed to search products:', error);
      throw new Error('Failed to search products. Please try again.');
    }
  }

  async getProduct(productId: string): Promise<Product> {
    try {
      const response = await httpService.get<CarrefourSingleProductResponse>(
        `${API_URL}/products/${productId}`
      );

      const p = response?.data;
      if (!p) {
        throw new Error('Product not found');
      }

      return {
        id: p.id,
        name: p.title || p.name || '',
        brand: p.brand,
        price: p.price?.price || 0,
        pricePerUnit: p.price?.unitPrice,
        imageUrl: p.image,
        available: p.available !== false,
        category: p.category,
        description: p.description,
        promotions: p.promotions?.map((promo) => ({
          type: promo.type || '',
          description: promo.label || '',
          discount: promo.discount,
        })),
      };
    } catch (error) {
      logger.error('Failed to get product:', error);
      throw new Error('Failed to get product details. Please try again.');
    }
  }

  async getCategories(): Promise<Category[]> {
    try {
      const response = await httpService.get<CarrefourCategoryResponse>(
        `${API_URL}/categories`
      );

      return (response?.data?.categories || []).map((cat) => ({
        id: cat.id,
        name: cat.name,
        parentId: cat.parentId,
        imageUrl: cat.image,
        subcategories: cat.children?.map((sub) => ({
          id: sub.id,
          name: sub.name,
          parentId: sub.parentId,
          imageUrl: sub.image,
        })),
      }));
    } catch (error) {
      logger.error('Failed to get categories:', error);
      throw new Error('Failed to get categories. Please try again.');
    }
  }

  async browseCategory(categoryId: string, page: number = 1, pageSize: number = 20): Promise<SearchResult> {
    try {
      const response = await httpService.get<CarrefourProductResponse>(
        `${API_URL}/categories/${categoryId}/products?page=${page}&pageSize=${pageSize}`
      );

      const products = (response?.data?.products || []).map((p) => ({
        id: p.id,
        name: p.title || p.name || '',
        brand: p.brand,
        price: p.price?.price || 0,
        pricePerUnit: p.price?.unitPrice,
        imageUrl: p.image,
        available: p.available !== false,
        category: p.category,
      }));

      return {
        products,
        totalCount: response?.data?.totalCount || products.length,
        page: response?.data?.pagination?.currentPage || page,
        pageSize: response?.data?.pagination?.pageSize || pageSize,
        hasMore: (response?.data?.pagination?.totalPages || 1) > page,
      };
    } catch (error) {
      logger.error('Failed to browse category:', error);
      throw new Error('Failed to browse category. Please try again.');
    }
  }

  // Cart methods
  async getCart(): Promise<Cart> {
    try {
      const response = await httpService.get<CarrefourCartResponse>(`${API_URL}/cart`);

      const data = response?.data;
      return {
        items: (data?.items || []).map((item) => ({
          productId: item.productId || item.id || '',
          name: item.name || '',
          brand: item.brand,
          price: item.price || 0,
          quantity: item.quantity || 0,
          totalPrice: item.totalPrice || 0,
          imageUrl: item.image,
          available: item.available !== false,
        })),
        totalItems: data?.totalItems || 0,
        subtotal: data?.subtotal || 0,
        total: data?.total || 0,
        savings: data?.savings,
        storeId: data?.storeId,
      };
    } catch (error) {
      logger.error('Failed to get cart:', error);
      throw new Error('Failed to get cart. Please try again.');
    }
  }

  async addToCart(productId: string, quantity: number = 1): Promise<Cart> {
    try {
      const response = await httpService.post<CarrefourCartResponse>(
        `${API_URL}/cart/items`,
        { productId, quantity }
      );

      const data = response?.data;
      return {
        items: (data?.items || []).map((item) => ({
          productId: item.productId || item.id || '',
          name: item.name || '',
          brand: item.brand,
          price: item.price || 0,
          quantity: item.quantity || 0,
          totalPrice: item.totalPrice || 0,
          imageUrl: item.image,
          available: item.available !== false,
        })),
        totalItems: data?.totalItems || 0,
        subtotal: data?.subtotal || 0,
        total: data?.total || 0,
        savings: data?.savings,
      };
    } catch (error) {
      logger.error('Failed to add to cart:', error);
      throw new Error('Failed to add product to cart. Please try again.');
    }
  }

  async updateCartItem(productId: string, quantity: number): Promise<Cart> {
    try {
      const response = await httpService.put<CarrefourCartResponse>(
        `${API_URL}/cart/items/${productId}`,
        { quantity }
      );

      const data = response?.data;
      return {
        items: (data?.items || []).map((item) => ({
          productId: item.productId || item.id || '',
          name: item.name || '',
          brand: item.brand,
          price: item.price || 0,
          quantity: item.quantity || 0,
          totalPrice: item.totalPrice || 0,
          imageUrl: item.image,
          available: item.available !== false,
        })),
        totalItems: data?.totalItems || 0,
        subtotal: data?.subtotal || 0,
        total: data?.total || 0,
        savings: data?.savings,
      };
    } catch (error) {
      logger.error('Failed to update cart item:', error);
      throw new Error('Failed to update cart item. Please try again.');
    }
  }

  async removeFromCart(productId: string): Promise<Cart> {
    try {
      const response = await httpService.delete<CarrefourCartResponse>(
        `${API_URL}/cart/items/${productId}`
      );

      const data = response?.data;
      return {
        items: (data?.items || []).map((item) => ({
          productId: item.productId || item.id || '',
          name: item.name || '',
          brand: item.brand,
          price: item.price || 0,
          quantity: item.quantity || 0,
          totalPrice: item.totalPrice || 0,
          imageUrl: item.image,
          available: item.available !== false,
        })),
        totalItems: data?.totalItems || 0,
        subtotal: data?.subtotal || 0,
        total: data?.total || 0,
        savings: data?.savings,
      };
    } catch (error) {
      logger.error('Failed to remove from cart:', error);
      throw new Error('Failed to remove product from cart. Please try again.');
    }
  }

  async clearCart(): Promise<void> {
    try {
      await httpService.delete(`${API_URL}/cart`);
    } catch (error) {
      logger.error('Failed to clear cart:', error);
      throw new Error('Failed to clear cart. Please try again.');
    }
  }

  // Slot methods
  async getSlots(): Promise<SlotDay[]> {
    try {
      const response = await httpService.get<CarrefourSlotResponse>(`${API_URL}/slots`);

      return (response?.data?.days || []).map((day) => ({
        date: day.date,
        dayName: day.dayName || '',
        slots: (day.slots || []).map((slot) => ({
          id: slot.id,
          date: day.date,
          startTime: slot.startTime || '',
          endTime: slot.endTime || '',
          available: slot.available !== false,
          price: slot.price,
          type: (slot.type as 'drive' | 'delivery') || 'drive',
        })),
      }));
    } catch (error) {
      logger.error('Failed to get slots:', error);
      throw new Error('Failed to get available slots. Please try again.');
    }
  }

  async getFirstAvailableSlot(): Promise<TimeSlot | null> {
    const days = await this.getSlots();
    for (const day of days) {
      const availableSlot = day.slots.find((slot) => slot.available);
      if (availableSlot) {
        return availableSlot;
      }
    }
    return null;
  }

  async reserveSlot(slotId: string): Promise<{ success: boolean; message: string }> {
    try {
      await httpService.post(`${API_URL}/slots/${slotId}/reserve`, {});
      return { success: true, message: 'Slot reserved successfully.' };
    } catch (error) {
      logger.error('Failed to reserve slot:', error);
      throw new Error('Failed to reserve slot. Please try again.');
    }
  }

  // Shopping list methods
  async getLists(): Promise<ShoppingList[]> {
    try {
      const response = await httpService.get<CarrefourListResponse>(`${API_URL}/lists`);

      return (response?.data?.lists || []).map((list) => ({
        id: list.id,
        name: list.name,
        itemCount: list.itemCount || 0,
        createdAt: list.createdAt || '',
        updatedAt: list.updatedAt || '',
      }));
    } catch (error) {
      logger.error('Failed to get lists:', error);
      throw new Error('Failed to get shopping lists. Please try again.');
    }
  }

  async getList(listId: string): Promise<ShoppingListDetail> {
    try {
      const response = await httpService.get<CarrefourListDetailResponse>(
        `${API_URL}/lists/${listId}`
      );

      const data = response?.data;
      if (!data) {
        throw new Error('List not found');
      }

      return {
        id: data.id,
        name: data.name,
        itemCount: data.itemCount || 0,
        createdAt: data.createdAt || '',
        updatedAt: data.updatedAt || '',
        items: (data.items || []).map((item) => ({
          productId: item.productId,
          name: item.name || '',
          brand: item.brand,
          quantity: item.quantity || 1,
          imageUrl: item.image,
        })),
      };
    } catch (error) {
      logger.error('Failed to get list:', error);
      throw new Error('Failed to get shopping list. Please try again.');
    }
  }

  async createList(name: string): Promise<ShoppingList> {
    try {
      const response = await httpService.post<CarrefourListDetailResponse>(
        `${API_URL}/lists`,
        { name }
      );

      const data = response?.data;
      if (!data) {
        throw new Error('Failed to create list');
      }

      return {
        id: data.id,
        name: data.name,
        itemCount: 0,
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to create list:', error);
      throw new Error('Failed to create shopping list. Please try again.');
    }
  }

  async addToList(listId: string, productId: string, quantity: number = 1): Promise<ShoppingListDetail> {
    try {
      const response = await httpService.post<CarrefourListDetailResponse>(
        `${API_URL}/lists/${listId}/items`,
        { productId, quantity }
      );

      const data = response?.data;
      if (!data) {
        throw new Error('Failed to add to list');
      }

      return {
        id: data.id,
        name: data.name,
        itemCount: data.itemCount || 0,
        createdAt: data.createdAt || '',
        updatedAt: data.updatedAt || '',
        items: (data.items || []).map((item) => ({
          productId: item.productId,
          name: item.name || '',
          brand: item.brand,
          quantity: item.quantity || 1,
          imageUrl: item.image,
        })),
      };
    } catch (error) {
      logger.error('Failed to add to list:', error);
      throw new Error('Failed to add product to shopping list. Please try again.');
    }
  }

  async addListToCart(listId: string): Promise<Cart> {
    try {
      const response = await httpService.post<CarrefourCartResponse>(
        `${API_URL}/lists/${listId}/add-to-cart`,
        {}
      );

      const data = response?.data;
      return {
        items: (data?.items || []).map((item) => ({
          productId: item.productId || item.id || '',
          name: item.name || '',
          brand: item.brand,
          price: item.price || 0,
          quantity: item.quantity || 0,
          totalPrice: item.totalPrice || 0,
          imageUrl: item.image,
          available: item.available !== false,
        })),
        totalItems: data?.totalItems || 0,
        subtotal: data?.subtotal || 0,
        total: data?.total || 0,
        savings: data?.savings,
      };
    } catch (error) {
      logger.error('Failed to add list to cart:', error);
      throw new Error('Failed to add shopping list to cart. Please try again.');
    }
  }

  // Order history methods
  async getOrders(page: number = 1, pageSize: number = 10): Promise<Order[]> {
    try {
      const response = await httpService.get<CarrefourOrderResponse>(
        `${API_URL}/orders?page=${page}&pageSize=${pageSize}`
      );

      return (response?.data?.orders || []).map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber || '',
        date: order.date || '',
        status: order.status || '',
        total: order.total || 0,
        itemCount: order.itemCount || 0,
        storeId: order.storeId || '',
        storeName: order.storeName || '',
        slotDate: order.slotDate,
        slotTime: order.slotTime,
      }));
    } catch (error) {
      logger.error('Failed to get orders:', error);
      throw new Error('Failed to get order history. Please try again.');
    }
  }

  async getOrder(orderId: string): Promise<OrderDetail> {
    try {
      const response = await httpService.get<CarrefourOrderDetailResponse>(
        `${API_URL}/orders/${orderId}`
      );

      const data = response?.data;
      if (!data) {
        throw new Error('Order not found');
      }

      return {
        id: data.id,
        orderNumber: data.orderNumber || '',
        date: data.date || '',
        status: data.status || '',
        total: data.total || 0,
        itemCount: data.itemCount || 0,
        storeId: data.storeId || '',
        storeName: data.storeName || '',
        slotDate: data.slotDate,
        slotTime: data.slotTime,
        items: (data.items || []).map((item) => ({
          productId: item.productId || item.id || '',
          name: item.name || '',
          brand: item.brand,
          price: item.price || 0,
          quantity: item.quantity || 0,
          totalPrice: item.totalPrice || 0,
          imageUrl: item.image,
        })),
        subtotal: data.subtotal || 0,
        savings: data.savings,
        fees: data.fees,
      };
    } catch (error) {
      logger.error('Failed to get order:', error);
      throw new Error('Failed to get order details. Please try again.');
    }
  }

  async reorder(orderId: string): Promise<Cart> {
    try {
      const response = await httpService.post<CarrefourCartResponse>(
        `${API_URL}/orders/${orderId}/reorder`,
        {}
      );

      const data = response?.data;
      return {
        items: (data?.items || []).map((item) => ({
          productId: item.productId || item.id || '',
          name: item.name || '',
          brand: item.brand,
          price: item.price || 0,
          quantity: item.quantity || 0,
          totalPrice: item.totalPrice || 0,
          imageUrl: item.image,
          available: item.available !== false,
        })),
        totalItems: data?.totalItems || 0,
        subtotal: data?.subtotal || 0,
        total: data?.total || 0,
        savings: data?.savings,
      };
    } catch (error) {
      logger.error('Failed to reorder:', error);
      throw new Error('Failed to reorder. Please try again.');
    }
  }
}

export const carrefourService = new CarrefourService();
