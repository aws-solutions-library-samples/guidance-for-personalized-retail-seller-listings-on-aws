/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import { authService } from './authService';
import * as config from '../config/runtime.config.json';

// Get API URL from environment variables or use the relative path for CloudFront distribution
// When using CloudFront with API Gateway as an origin, we can use the relative /api path
// This allows us to make API calls through the same domain, avoiding CORS issues
const API_BASE_URL = config.restApiEndpoint;
export interface ProductFeature {
  title: string;
  description: string;
  icon?: string;
}

export interface ProductImage {
  id: string;
  filename?: string;
  path?: string;
  contentType?: string;
  description?: string;
  uploadedAt?: string;
}

export interface Product {
  id: string;
  name: string;
  brand?: string;
  model_number?: string;
  description: string;
  imageUrl?: string;
  images?: ProductImage[];
  features?: string[] | ProductFeature[];
  specifications?: Record<string, string>;
  keywords?: string[];
  dimensions?: string;
  weight?: string;
  power_requirements?: string;
  materials?: string;
  connectivity?: string;
  additional_specs?: string;
  usage_instructions?: string;
  warranty_info?: string;
  categories?: string[];
  target_audience?: string;
  release_date?: string;
  comparison_table?: Record<string, string>;
}

/**
 * Service for handling product data
*/
export const productService = {
  /**
   * Delete a product by ID
   * @param productId - The ID of the product to delete
   * @returns Promise<boolean> - True if deletion was successful
   */
  deleteProduct: async (productId: string): Promise<boolean> => {
    const token = await authService.getToken();
    const headers: HeadersInit = {};
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(`${API_BASE_URL}/products/${productId}`, { 
      method: 'DELETE',
      headers 
    });
    
    if (!response.ok) {
      throw new Error(`Failed to delete product: ${response.statusText}`);
    }
    
    return true;
  },
  /**
   * Get a product by ID
   * @param productId - The ID of the product to fetch
  */
 getProduct: async (productId: string): Promise<Product> => {
   const token = await authService.getToken();
   const headers: HeadersInit = {};
   
   if (token) {
     headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(`${API_BASE_URL}/products/${productId}`, { headers, cache: 'no-store' });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch product: ${response.statusText}`);
    }
    
    return await response.json();
  },
  
  /**
   * Get all products
  */
 getAllProducts: async (): Promise<Product[]> => {
   const token = await authService.getToken();
   const headers: HeadersInit = {};
   console.log(API_BASE_URL);
   
   if (token) {
     headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(`${API_BASE_URL}/products`, { headers, cache: 'no-store' });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch products: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Check if the response has a products array (from the Lambda function)
    if (data && data.products && Array.isArray(data.products)) {
      // Check if the products array contains objects with product details
      if (data.products.length > 0 && typeof data.products[0] === 'object') {
        // The Lambda is now returning product details directly
        return data.products;
      } else {
        // If we just have product IDs, we need to fetch each product
        const productPromises = data.products.map(async (productId: string) => {
          try {
            return await productService.getProduct(productId);
          } catch (error) {
            console.error(`Error fetching product ${productId}:`, error);
            // Return a minimal product object if fetch fails
            return {
              id: productId,
              name: `Product ${productId}`,
              description: 'Product details could not be loaded.'
            };
          }
        });
        
        return await Promise.all(productPromises);
      }
    } else if (Array.isArray(data)) {
      // If the response is already an array of products
      return data;
    } else {
      console.error('Unexpected response format:', data);
      throw new Error('Unexpected response format from API');
    }
  },
};

// No demo products or fallbacks - using real API data only
