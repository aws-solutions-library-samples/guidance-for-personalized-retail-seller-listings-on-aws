/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { productService, Product } from '../../services/productService';
import ImageCarousel from './ImageCarousel';
import * as config from '../../config/runtime.config.json';

// Get API URL from environment variables or use the relative path for CloudFront distribution
// When using CloudFront with API Gateway as an origin, we can use the relative /api path
// This allows us to make API calls through the same domain, avoiding CORS issues
const API_BASE_URL = config.restApiEndpoint;

export const ProductViewer: React.FC = () => {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  
  const handleBack = () => {
    navigate('/products');
  };
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProduct = async () => {
      if (!productId) {
        setError('Product ID is missing');
        setLoading(false);
        return;
      }
      
      try {
        setLoading(true);
        setError(null);
        const data = await productService.getProduct(productId);
        setProduct(data);
      } catch (err) {
        console.error('Error fetching product:', err);
        setError('Failed to load product data');
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [productId]);
  
  // If productId is undefined (should not happen with proper routing), show an error
  if (!productId) {
    return (
      <div className="w-full mx-auto p-6 bg-white rounded-lg shadow-md">
        <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded mb-4">
          Product ID is missing
        </div>
        <button
          onClick={handleBack}
          className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition duration-200"
        >
          Back to List
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="w-full mx-auto p-6 bg-white rounded-lg shadow-md">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Product: {productId}</h2>
          <button
            onClick={handleBack}
            className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition duration-200"
          >
            Back to List
          </button>
        </div>
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-2">Loading product data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full mx-auto p-6 bg-white rounded-lg shadow-md">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Product: {productId}</h2>
          <button
            onClick={handleBack}
            className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition duration-200"
          >
            Back to List
          </button>
        </div>
        <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded mb-4">
          {error}
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="w-full mx-auto p-6 bg-white rounded-lg shadow-md">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Product: {productId}</h2>
          <button
            onClick={handleBack}
            className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition duration-200"
          >
            Back to List
          </button>
        </div>
        <div className="p-4 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded mb-4">
          Product not found
        </div>
      </div>
    );
  }

  return (
    <div className="w-full mx-auto p-6 bg-white rounded-lg shadow-md">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">{product.name}</h2>
        <button
          onClick={handleBack}
          className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition duration-200"
        >
          Back to List
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <div>
          {product.images && product.images.length > 0 ? (
            <ImageCarousel 
              images={product.images} 
              productId={productId} 
              apiBaseUrl={API_BASE_URL}
            />
          ) : product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="w-full h-auto rounded-lg shadow-md"
            />
          ) : (
            <div className="w-full h-64 bg-gray-200 rounded-lg flex items-center justify-center">
              <span className="text-gray-500">No image available</span>
            </div>
          )}
        </div>

        <div>
          <div className="mb-4">
            <h3 className="text-lg font-medium mb-2">Brand</h3>
            <p>{product.brand || 'Unknown'}</p>
          </div>

          <div className="mb-4">
            <h3 className="text-lg font-medium mb-2">Product ID</h3>
            <p>{productId}</p>
          </div>

          {product.model_number && (
            <div className="mb-4">
              <h3 className="text-lg font-medium mb-2">Model Number</h3>
              <p>{product.model_number}</p>
            </div>
          )}

          <div className="mb-4">
            <h3 className="text-lg font-medium mb-2">Description</h3>
            <p className="text-gray-700">{product.description}</p>
          </div>

          {product.features && product.features.length > 0 && (
            <div className="mb-4">
              <h3 className="text-lg font-medium mb-2">Key Features</h3>
              <ul className="list-disc pl-5 space-y-1">
                {product.features.map((feature, index) => (
                  <li key={index} className="text-gray-700">
                    {typeof feature === 'string' 
                      ? feature 
                      : (
                        <span>
                          {feature.title && feature.description 
                            ? <strong>{feature.title}:</strong> 
                            : null} {feature.description || feature.title}
                        </span>
                      )
                    }
                  </li>
                ))}
              </ul>
            </div>
          )}

          {product.release_date && (
            <div className="mb-4">
              <h3 className="text-lg font-medium mb-2">Release Date</h3>
              <p>{product.release_date}</p>
            </div>
          )}
        </div>
      </div>

      {product.specifications && Object.keys(product.specifications).length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-medium mb-4">Specifications</h3>
          <div className="bg-gray-50 rounded-lg p-4">
            <table className="w-full">
              <tbody>
                {Object.entries(product.specifications).map(([key, value]) => (
                  <tr key={key} className="border-b border-gray-200 last:border-b-0">
                    <td className="py-2 pr-4 font-medium text-gray-600 w-1/3">{key}</td>
                    <td className="py-2">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {product.usage_instructions && (
        <div className="mb-8">
          <h3 className="text-lg font-medium mb-2">Usage Instructions</h3>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-gray-700">{product.usage_instructions}</p>
          </div>
        </div>
      )}

      {product.warranty_info && (
        <div className="mb-8">
          <h3 className="text-lg font-medium mb-2">Warranty Information</h3>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-gray-700">{product.warranty_info}</p>
          </div>
        </div>
      )}

      {product.comparison_table && Object.keys(product.comparison_table).length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-medium mb-4">Comparison Table</h3>
          <div className="bg-gray-50 rounded-lg p-4">
            <table className="w-full">
              <tbody>
                {Object.entries(product.comparison_table).map(([key, value]) => (
                  <tr key={key} className="border-b border-gray-200 last:border-b-0">
                    <td className="py-2 pr-4 font-medium text-gray-600 w-1/3">{key}</td>
                    <td className="py-2">
                      {typeof value === 'object' && value !== null ? (
                        <div className="space-y-1">
                          {Object.entries(value).map(([subKey, subValue]) => (
                            <div key={subKey} className="flex justify-between">
                              <span className="font-medium text-gray-700">{subKey}:</span>
                              <span className="text-gray-600">{String(subValue)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        String(value)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        {product.categories && product.categories.length > 0 && (
          <div>
            <h3 className="text-lg font-medium mb-2">Categories</h3>
            <div className="flex flex-wrap gap-2">
              {product.categories.map((category, index) => (
                <span
                  key={index}
                  className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm"
                >
                  {category}
                </span>
              ))}
            </div>
          </div>
        )}

        {product.keywords && product.keywords.length > 0 && (
          <div>
            <h3 className="text-lg font-medium mb-2">Keywords</h3>
            <div className="flex flex-wrap gap-2">
              {product.keywords.map((keyword, index) => (
                <span
                  key={index}
                  className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                >
                  {keyword}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {product.target_audience && (
        <div className="mb-8">
          <h3 className="text-lg font-medium mb-2">Target Audience</h3>
          <p className="text-gray-700">{product.target_audience}</p>
        </div>
      )}
    </div>
  );
};
