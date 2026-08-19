// Session types
export interface SessionCookies {
  [key: string]: string;
}

export interface StoredSession {
  cookies: SessionCookies;
  storeId?: string;
  storeName?: string;
  createdAt: string;
  lastUsed: string;
}

// Store types
export interface Store {
  id: string;
  name: string;
  address: string;
  city: string;
  postalCode: string;
  distance?: number;
  services: string[];
  openingHours?: string;
}

// Product types
export interface Product {
  id: string;
  name: string;
  brand?: string;
  price: number;
  pricePerUnit?: string;
  imageUrl?: string;
  available: boolean;
  quantity?: number;
  category?: string;
  description?: string;
  promotions?: Promotion[];
}

export interface Promotion {
  type: string;
  description: string;
  discount?: number;
}

export interface SearchResult {
  products: Product[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// Category types
export interface Category {
  id: string;
  name: string;
  parentId?: string;
  imageUrl?: string;
  subcategories?: Category[];
}

// Cart types
export interface CartItem {
  productId: string;
  name: string;
  brand?: string;
  price: number;
  quantity: number;
  totalPrice: number;
  imageUrl?: string;
  available: boolean;
}

export interface Cart {
  items: CartItem[];
  totalItems: number;
  subtotal: number;
  total: number;
  savings?: number;
  storeId?: string;
}

// Slot types
export interface TimeSlot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  available: boolean;
  price?: number;
  type: 'drive' | 'delivery';
}

export interface SlotDay {
  date: string;
  dayName: string;
  slots: TimeSlot[];
}

// Shopping list types
export interface ShoppingList {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingListItem {
  productId: string;
  name: string;
  brand?: string;
  quantity: number;
  imageUrl?: string;
}

export interface ShoppingListDetail extends ShoppingList {
  items: ShoppingListItem[];
}

// Order types
export interface Order {
  id: string;
  orderNumber: string;
  date: string;
  status: string;
  total: number;
  itemCount: number;
  storeId: string;
  storeName: string;
  slotDate?: string;
  slotTime?: string;
}

export interface OrderDetail extends Order {
  items: OrderItem[];
  subtotal: number;
  savings?: number;
  fees?: number;
}

export interface OrderItem {
  productId: string;
  name: string;
  brand?: string;
  price: number;
  quantity: number;
  totalPrice: number;
  imageUrl?: string;
}

// API Response types
export interface CarrefourApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

// HTTP types
export interface HttpRequestConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}
